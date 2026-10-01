# Recommendation API — `POST /recommend`

A user describes a health problem in plain text. The backend returns Ayurvedic
options from the project's 40 herbs, conventional options from its 13 drugs, the
pros and cons of each, and the combinations that should not be taken together —
both among the options it just offered and against anything the user says they
already take.

**It is informational only. It is never a prescription.** Every response carries
the disclaimer, nothing in it has been reviewed by a clinician, and every option
reports `reviewed: false` so a consumer cannot mistake it for vetted content.

Read [PROJECT_SCOPE.md](PROJECT_SCOPE.md) and [BACKEND_API.md](BACKEND_API.md)
first; the rules there apply here unchanged.

## Pipeline

```
validate -> red-flag screen -> classify -> look up options -> check combinations
```

The order is the point. Red-flag screening runs **before** the classifier and
before any database read, so someone describing a heart attack never reaches the
code that would offer them a herb.

| Stage | Where | Notes |
|---|---|---|
| Request validation | `hdi/api.py`, `hdi/recommend.py` | The route checks the body shape; the service checks field values, so the same rules apply however it is called. |
| Red-flag screen | `hdi/safety.py` | Patterns from `data/reference/red_flags.json`. A match short-circuits. |
| Classification | `hdi/classify.py` | Pure-Python inference over the exported artifact. Skipped entirely when `condition_ids` is supplied. |
| Option lookup | `hdi/knowledge.py` | Parameterized reads of `medicine_uses`. |
| Combination check | `hdi/recommend.py` | Reuses `hdi.interactions.check_pair`, then `combination_rules`. |

No LLM, no API key, no network call and no model runtime is on this path. The
classifier is a JSON file of coefficients, not a pickle.
`tests/test_recommend.py::ServiceIsolationTest` reads the source of every service
module and asserts that none of them imports anything outside the standard
library, and that two identical requests return byte-identical answers.

## Quick start

```
python -m pip install -r requirements.txt     # standard library only for serving
python -m hdi.seed                            # build the query database
python -m hdi.api                             # serve on http://127.0.0.1:8000
```

```
curl -s -X POST http://127.0.0.1:8000/recommend \
  -H "Content-Type: application/json" \
  -d '{"text": "my sugar is high", "current_medicines": ["Glycomet"]}'
```

PowerShell:

```powershell
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8000/recommend `
  -ContentType 'application/json' `
  -Body '{"text":"my sugar is high","current_medicines":["Glycomet"]}'
```

## Request

```json
{
  "text": "sugar high hai, metformin leta hoon",
  "current_medicines": ["Glycomet", "Haldi", "blood thinner"],
  "cautions": {"pregnant_or_breastfeeding": false, "under_18": false,
               "kidney_or_liver_disease": true},
  "condition_ids": ["type_2_diabetes"]
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `text` | string, ≤ 500 chars | yes, unless `condition_ids` is given | Free text. English, Hinglish, typos. |
| `current_medicines` | array of strings, ≤ 20 | no | Medicine ids, names, synonyms, brand names, or a lay class name. |
| `cautions` | object of booleans | no | `pregnant_or_breastfeeding`, `under_18`, `kidney_or_liver_disease`. Only ever adds notes. |
| `condition_ids` | array of strings, ≤ 10 | no | Skips the classifier. Use this to act on a `low_confidence` answer. |

An unknown field is a 400 rather than ignored, so a typo in a client is caught
rather than silently changing behaviour. An unknown *caution flag* is accepted and
echoed back in `ignored_caution_flags`, so an older server still answers a newer
client.

`text` is still screened for red flags when `condition_ids` is supplied:
supplying a condition skips the classifier, never the safety check.

## Response

Four values of `status`, and they are deliberately distinct:

| `status` | Meaning | Options listed |
|---|---|---|
| `emergency` | A red flag matched. | None at all |
| `results` | One or more supported conditions were identified. | Yes |
| `low_confidence` | Nothing could be matched confidently. | None; `supported_conditions` instead |
| `out_of_scope` | What was described is outside the 13 drugs' indications. | None; `supported_conditions` instead |

All four are HTTP 200. The status is the answer, not an error.

### `results`

Abridged — one option of each kind and two warnings shown:

```json
{
  "status": "results",
  "detected_conditions": [
    {"condition_id": "type_2_diabetes", "confidence": 0.9957,
     "source": "classifier", "name": "Type 2 diabetes"}
  ],
  "ayurvedic_options": [
    {
      "medicine_id": "herb-aloe-vera",
      "name": "Aloe vera",
      "category": "ayurvedic",
      "medicine_type": "herb",
      "scientific_name": "Aloe vera",
      "use_kind": "traditional_use",
      "uses": "Traditional use of ghritakumari gel for digestion, skin and metabolic complaints.",
      "evidence_level": "clinical",
      "pros": "A randomised placebo-controlled trial reported lower blood glucose and cholesterol.",
      "cons": "One small trial only; the bitter latex is a harsh laxative; gel quality varies widely.",
      "cautions": "Laxative latex can lower potassium; the gel adds to sugar-lowering medicines.",
      "common_side_effects": [],
      "tags": ["hypoglycemic", "potassium_affecting"],
      "source_type": "repo_abstract",
      "source_note": "PMID 22198821 (randomised double-blind placebo-controlled trial in type 2 diabetes)",
      "reviewed": false,
      "condition_id": "type_2_diabetes",
      "condition_name": "Type 2 diabetes"
    }
  ],
  "allopathic_options": [
    {
      "medicine_id": "drug-glimepiride",
      "name": "Glimepiride",
      "category": "allopathic",
      "medicine_type": "drug",
      "drug_class": "Antidiabetics",
      "use_kind": "conventional_use",
      "uses": "Prompting the pancreas to release more insulin in type 2 diabetes.",
      "evidence_level": "clinical",
      "pros": "Lowers blood sugar quickly and is inexpensive.",
      "cons": "Real risk of low blood sugar, especially if meals are missed; can add weight.",
      "cautions": "Not for type 1 diabetes; skipping meals can cause dangerous low blood sugar.",
      "common_side_effects": ["low blood sugar", "weight gain", "nausea",
                              "rarely a drop in red blood cells"],
      "tags": ["hypoglycemic", "cyp_substrate"],
      "source_type": "fetched_source",
      "source_note": "openFDA SPL label, set_id 0003458f-... effective 20241113",
      "reviewed": false,
      "condition_id": "type_2_diabetes",
      "condition_name": "Type 2 diabetes"
    }
  ],
  "combination_warnings": [
    {
      "level": "literature_verified",
      "label": "Literature-verified",
      "medicine_a": "Amla",
      "medicine_b": "Metformin",
      "reason": "Curated PubMed evidence records general_interaction interaction language for Amla and Metformin in 1 abstract(s) (PMID 29518605), each confirmed by manual curator review.",
      "severity": "minor",
      "against_current_medicine": true,
      "citations": [
        {"pmid": "29518605",
         "evidence_sentence": "Herb-drug interaction of Nisha Amalaki and Curcuminoids with metformin ...",
         "source_url": "https://pubmed.ncbi.nlm.nih.gov/29518605/"}
      ],
      "rules": []
    },
    {
      "level": "mechanism_based",
      "label": "Mechanism-based caution (not literature-verified)",
      "medicine_a": "Gymnema",
      "medicine_b": "Metformin",
      "reason": "Both lower blood sugar, so taken together they can push it lower than intended.",
      "severity": null,
      "caution_level": "high",
      "against_current_medicine": true,
      "citations": [],
      "rules": [{"rule_id": "rule-001",
                 "tags": ["hypoglycemic", "hypoglycemic"], "level": "high"}]
    }
  ],
  "combination_summary": {
    "pairs_checked": 58,
    "warnings_listed": 58,
    "pairs_with_no_finding_not_listed": 0,
    "note": "Checked: every suggested herb against every suggested drug, and every suggestion against each medicine you said you already take. ..."
  },
  "caution_notes": [
    "You have said there is kidney or liver disease. ...",
    "Metformin is listed as an option below and you have said you already take it. ...",
    "Conditions were detected by a classifier trained on synthetic phrasings, ..."
  ],
  "current_medicines": {
    "resolved": [{"query": "Glycomet", "medicine_id": "drug-metformin",
                  "name": "Metformin", "medicine_type": "drug",
                  "category": "allopathic", "drug_class": "Antidiabetics",
                  "resolved_as": "medicine"}],
    "drug_classes": [],
    "unresolved": [],
    "ambiguous": []
  },
  "evidence_note": "Every option here is unreviewed research data: ...",
  "disclaimer": "This is information, not medical advice. ..."
}
```

### `emergency`

```json
{
  "status": "emergency",
  "red_flags": [{"category": "chest_pain", "label": "Chest pain or chest pressure",
                 "message": "Chest pain or chest pressure can be a heart attack and needs emergency care now."}],
  "message": "What you described may be a medical emergency. This is not the place to look for options right now.",
  "actions": [
    "Call 112 now (National emergency number (India)), or get to the nearest emergency department.",
    "Do not wait to look up herbs or medicines, and do not change any prescribed medicine on your own."
  ],
  "detected_conditions": [], "ayurvedic_options": [], "allopathic_options": [],
  "combination_warnings": [], "caution_notes": [],
  "disclaimer": "..."
}
```

For suicidal ideation an extra action names **Tele-MANAS, 14416**.

### `out_of_scope` and `low_confidence`

Both carry empty option lists plus `supported_conditions`, so a client can let
the user pick one and re-send it as `condition_ids`.

```json
{
  "status": "out_of_scope",
  "note": "This database only covers the conditions its 40 Ayurvedic herbs and 13 conventional drugs are recorded for. ...",
  "supported_conditions": [
    {"condition_id": "type_2_diabetes", "name": "Type 2 diabetes",
     "drug_classes": ["Antidiabetics"]}
  ],
  "detected_conditions": [], "ayurvedic_options": [], "allopathic_options": [],
  "combination_warnings": [], "caution_notes": [], "disclaimer": "..."
}
```

## Warning levels

Each warning carries one `level` and a human-readable `label`. **Only the first
may say "literature-verified"** — `docs/PROJECT_SCOPE.md` requires that, and
`tests/test_recommend.py` checks every warning across every condition against the
curated interaction table.

| `level` | `label` | Source | Citations |
|---|---|---|---|
| `literature_verified` | Literature-verified | The curated interaction table marks the pair documented. | PMID + evidence sentence |
| `mechanism_based` | Mechanism-based caution (not literature-verified) | A tag-pair rule in `combination_rules.csv` fired. | None, ever |
| `no_documented_interaction` | No documented interaction in this database | The pair is in the harvested corpus; nothing was found. | None |
| `insufficient_evidence` | Insufficient evidence | The pair was never harvested and no rule applies. | None |

A pair with no record reads exactly:

> No documented interaction in this database. This does not mean the combination
> is safe.

A mechanism-based warning carries no citation by construction. It is reasoning,
not a finding, and attaching a PMID to it would be inventing a source.

### Which pairs are checked

- Every **suggested herb × suggested drug** pair.
- Every **suggestion × current medicine** pair, in both directions and across all
  pair kinds.
- Pairs between two medicines the user already takes are **not** checked. That is
  a prescribing decision already made by whoever prescribed them.

Herb+herb and drug+drug pairs return `insufficient_evidence` unless a rule
applies: the harvested corpus only covers herb × drug.

Suggestion-to-suggestion pairs with no finding are counted in
`combination_summary` rather than listed. Enumerating "no documented interaction"
for every herb pair in a diabetes answer would bury the handful that matter.
Nothing is hidden — the counts always reconcile, and
`tests/test_recommend.py` asserts that.

### Ordering

`combination_warnings` is sorted:

1. conflicts with a medicine the user already takes, first;
2. then by level (`literature_verified` → `mechanism_based` → `no_documented_interaction` → `insufficient_evidence`);
3. then by rule caution level, then alphabetically.

Options are ordered by evidence level and then alphabetically. **This project
does not rank medicines against each other** and must not look as though it does.

## Resolving `current_medicines`

Three outcomes, all reported so the response says plainly what it understood:

| Outcome | Field | Example |
|---|---|---|
| A specific medicine | `resolved` | `"Glycomet"` → Metformin, `"Haldi"` → Turmeric, `"Acetylsalicylic acid"` → Aspirin |
| A whole drug class | `drug_classes` | `"blood thinner"`, `"sugar ki dawa"`, `"khoon patla karne ki dawa"` |
| Nothing in scope | `unresolved` | `"Paracetamol"` — outside the frozen 53, so not guessed at |

A name matching more than one medicine lands in `ambiguous` and is not checked;
the response says to send a medicine id instead.

**Brand names resolve but are never printed.** They exist in
`data/reference/medicine_aliases.csv` so a user can type what is on their strip.
`hdi.catalog.PRIVATE_ALIAS_TYPES` strips them from every response — including
`/medicines/{id}`, which previously returned all aliases. The only place a brand
appears in a response is the `query` field echoing what the caller sent.

A class-level match uses the tags shared by **every** drug in that class, not
their union, so a caution raised against "blood thinner" holds whichever one the
user actually takes.

## Errors

Follows the existing conventions in [BACKEND_API.md](BACKEND_API.md):
`{"error": {"code": ..., "message": ...}}`, no stack traces, no SQL, no paths.

| Status | Code | When |
|---|---|---|
| 400 | `missing_parameter` | No `text` and no `condition_ids` |
| 400 | `invalid_parameter` | Wrong type, `text` over 500 chars, blank `text`, too many entries, unknown `condition_ids` |
| 400 | `invalid_body` | Body is not an object, or carries an unknown field |
| 404 | `not_found` | Unknown route |
| 405 | `method_not_allowed` | `GET /recommend` |
| 500 | `internal_error` | Logged server-side, generic to the client |
| 503 | `classifier_unavailable` | The exported artifact is missing — a deployment problem, not a bad request |
| 503 | `knowledge_unavailable` | The knowledge tables are empty; run `python -m hdi.seed` |
| 503 | `database_unavailable` | The database has not been built |

An unknown `condition_ids` 400 includes `supported_conditions` in the error body,
so a client can recover without a second round trip.

## Output rules

Enforced by `hdi/validate_reference.py` on the files and by
`tests/test_recommend.py` on every string of every response shape:

- **No dosing.** No number next to a unit, no frequency, no dosing abbreviation.
  This project has no sourced dose for anything, and a number reads as
  instruction however it was meant.
- **No brand names.**
- **No safety claims.** The word "safe" may appear only in a negated sentence.
  It cannot simply be banned, because the required no-record wording contains it
  ("This does not mean the combination is safe"), and the warnings about a narrow
  safety margin need it too. What is forbidden is an *unnegated claim* that
  something is safe. `tests/test_recommend.py::test_the_safety_scan_itself_is_calibrated`
  pins the scan's calibration in both directions.
- **Never "safe to take"**, in any framing.
- **No invented citations.** Every PMID cited in `herb_uses.csv` is checked
  against `data/raw/raw_abstracts.json` by `tests/test_reference_data.py`.

## Safety

### Red flags

`data/reference/red_flags.json`: 9 categories, 109 English and Hinglish patterns,
checked before anything else. A match returns `emergency` with no options.

| Category | Examples matched |
|---|---|
| `chest_pain` | chest pain, seene me dard, chest tightness |
| `trouble_breathing` | can't breathe, saans nahi aa rahi, dam ghutna |
| `fainting` | fainted, passed out, behosh, chakkar aakar girna |
| `stroke_signs` | face drooping, slurred speech, lakwa, falij, munh tedha |
| `severe_bleeding` | bleeding won't stop, khoon band nahi ho raha |
| `vomiting_blood` | vomiting blood, khoon ki ulti |
| `black_stools` | black tarry stools, kala pakhana, pakhane me khoon |
| `glycemic_emergency` | sugar with confusion, ketoacidosis, sugar above 400 |
| `suicidal_thoughts` | suicidal, jeene ka man nahi, khudkhushi |

Patterns err towards triggering: a false alarm costs a wasted referral, a miss
costs a delayed emergency. They deliberately do **not** match bare "stroke" or
"heart attack", so a user giving their history is classified rather than
escalated.

Emergency numbers are India's: **112** for all categories, plus **Tele-MANAS
14416** for suicidal ideation.

### Caution flags

`pregnant_or_breastfeeding`, `under_18`, `kidney_or_liver_disease` add notes and
nothing else. They never change the status and never remove an option: deciding a
herb is unsuitable in pregnancy is a clinical judgement this project has no
sourced basis for, so it reports the caution and leaves the decision where it
belongs.

## The condition classifier

Free text → zero or more of the 6 supported conditions.

- **Model:** TF-IDF (word 1–2 grams, lowercase, `[a-z0-9]+`, sublinear tf, l2) +
  one-vs-rest logistic regression with balanced class weights.
- **Trained by** `ml/train.py` (needs `requirements-ml.txt`).
- **Served by** `hdi/classify.py`, pure standard library, reading
  `ml/artifacts/condition_classifier.json` (vocabulary, idf, coefficients,
  intercepts, classes, threshold).
- **Parity:** `tests/test_classifier.py` asserts the two agree within `1e-4` on
  45 inputs, and that the analyzer produces the identical feature multiset.
  Measured worst-case difference is ~3e-16. Tests skip cleanly without
  scikit-learn.

There is no `out_of_scope` coefficient vector. `out_of_scope` is what it means
when no condition clears the threshold:

| Best score | Status |
|---|---|
| ≥ threshold (0.29) | `results` |
| ≥ floor (0.21), < threshold | `low_confidence` |
| < floor | `out_of_scope` |

The threshold is tuned on validation data by `ml/train.py`. The low-confidence
floor is `max(threshold − 0.08, 0.20)` — a margin below the threshold rather than
a fraction of it, because a fraction of a low threshold lands inside the noise
where unrelated complaints score. Both are product decisions, and neither can
turn a rejected guess into a reported condition.

### Real metrics

From `ml/reports/eval.md`, on the held-out test set (384 rows):

| Class | Precision | Recall | F1 | Support |
|---|---|---|---|---|
| `type_2_diabetes` | 0.886 | 0.984 | 0.932 | 63 |
| `hypertension` | 0.871 | 0.938 | 0.904 | 65 |
| `heart_failure` | 0.779 | 0.957 | 0.859 | 70 |
| `atrial_fibrillation` | 0.909 | 0.833 | 0.870 | 60 |
| `venous_thromboembolism` | 0.865 | 1.000 | 0.928 | 64 |
| `secondary_cardiovascular_prevention` | 0.726 | 0.984 | 0.836 | 62 |
| `out_of_scope` | 0.897 | 0.729 | 0.805 | 48 |

**Macro-F1: 0.8760** (target was 0.85). Validation macro-F1 was 0.7352 — lower
than test, because validation holds back whole *phrases* while the test set
reuses none of the training wordings at all.

Multi-condition rows (48): both conditions found in 35, one of two in 13, neither
in 0.

**The test set is synthetic and these numbers overstate real-world
performance.** Both splits were written by hand in `ml/make_dataset.py` from
template and phrase pools that share no identical string, so the score measures
generalization from one set of invented phrasings to another. Nobody in this
repository is a real user describing a real problem.

### Training and evaluation

```
python -m pip install -r requirements-ml.txt
python ml/make_dataset.py      # -> ml/data/train.jsonl, ml/data/test.jsonl
python ml/train.py             # -> ml/artifacts/condition_classifier.{json,joblib}
python ml/evaluate.py          # -> ml/reports/eval.md, metrics.json, confusion matrix
```

All three use fixed seeds, so the chain is reproducible from a clean checkout;
`tests/test_classifier.py` regenerates the dataset and asserts the files come
back byte-identical. `ml/evaluate.py` exits non-zero if macro-F1 falls below
0.85.

## Data and provenance

Full provenance, including every row that was deliberately **left out**, is in
[../data/reference/DATA_NOTES.md](../data/reference/DATA_NOTES.md).

| File | Rows | What |
|---|---|---|
| `conditions.csv` | 6 | Supported conditions, lay and Hinglish synonyms, related drug class |
| `tag_vocabulary.csv` | 16 | The closed tag vocabulary |
| `herb_uses.csv` | 28 | Herb → condition, with pros, cons, cautions, tags, provenance |
| `drug_indications.csv` | 20 | Drug → condition, same shape plus side effects |
| `combination_rules.csv` | 36 | Tag-pair mechanism cautions |
| `medicine_aliases.csv` | 74 | Drug synonyms and brand names (49), herb variants |
| `class_aliases.csv` | 31 | Lay and Hinglish class names |
| `red_flags.json` | 9 categories, 109 patterns | Emergency screening |

Knowledge rows by `source_type`:

| `source_type` | Rows |
|---|---|
| `fetched_source` (openFDA labels actually retrieved) | 19 |
| `repo_abstract` (PubMed abstracts in this repo, cited by PMID) | 21 |
| `general_knowledge` (established pharmacology or classical sources) | 8 |
| **Total** | **48** |

Every row carries `source_type`, `source_note` and `reviewed=false`. The loader
**rejects** a row claiming `reviewed=true`.

### Supported conditions

Derived from what the 13 drugs and 3 classes are recorded for. `GET /conditions`
returns the live list.

| `condition_id` | Name | Classes |
|---|---|---|
| `type_2_diabetes` | Type 2 diabetes | Antidiabetics |
| `hypertension` | High blood pressure | Cardiovascular |
| `heart_failure` | Heart failure | Cardiovascular |
| `atrial_fibrillation` | Atrial fibrillation (irregular heartbeat) | Cardiovascular, Anticoagulants |
| `venous_thromboembolism` | Blood clot in a vein (DVT or pulmonary embolism) | Anticoagulants |
| `secondary_cardiovascular_prevention` | Prevention of a further heart attack or stroke | Anticoagulants, Cardiovascular |

Angina is *not* a separate condition: every lay description of it mentions chest
pain, which always routes to emergency care. See `DATA_NOTES.md`.

## How to add data

The scope of herbs and drugs is frozen (`PROJECT_SCOPE.md`). Within it:

**A herb-condition use:** add a row to `data/reference/herb_uses.csv` with
`evidence_level` (`traditional` | `preclinical` | `clinical`), pros and cons at
most 20 words each, tags from `tag_vocabulary.csv`, a `source_type`, a
`source_note` that names the actual source, and `reviewed=false`. A
`repo_abstract` row must cite a PMID present in `data/raw/raw_abstracts.json`.

**A drug indication:** same, in `data/reference/drug_indications.csv`. Refresh the
labels first with `python scripts/fetch_drug_labels.py`, which is resumable and
retries transient failures. Write your own plain-language text from the label —
do not paste label text, which carries brand names and dosing.

**A combination rule:** add a row to `data/reference/combination_rules.csv` with
both tags in the vocabulary, an `applies_to`, a one-sentence reason and a level.
Matching is symmetric, so write each pair once.

**A new condition:** add it to `data/reference/conditions.csv` with lay synonyms
and a real drug class, add at least one `drug_indications.csv` row for it (the
validator fails otherwise), then add phrase pools to `ml/make_dataset.py` and
retrain.

**An alias:** add it to `medicine_aliases.csv` (use `alias_type=brand_name` for a
trade name, which keeps it out of responses) or `class_aliases.csv` for a class
term.

Then, always:

```
python -m hdi.validate_reference      # catches scope, tag, wording and output problems
python -m hdi.seed                    # rebuild
python -m unittest discover -s tests
```

## Needs expert review before real use

Nothing here is fit for clinical use yet. In rough order of risk:

1. **Every `pros`, `cons` and `cautions` string** — 48 rows of plain-language text
   reduced by hand from labels, abstracts and classical sources. The automated
   checks catch dosing, brand names and safety claims; they cannot catch a
   clinically misleading summary.
2. **The 8 `general_knowledge` rows** — no source file behind them at all.
3. **The atrial fibrillation herb rows** — Arjuna and Jatamansi are offered on a
   classical indication for palpitation with no rhythm data of any kind. Atrial
   fibrillation carries a stroke risk no herb addresses. A reviewer should decide
   whether to offer anything here.
4. **`combination_rules.csv`** — 36 plausible rules that a pharmacologist should
   confirm, and more importantly say what is missing.
5. **Tag assignments** — a wrong tag silently changes which cautions fire.
   `cyp_inducer` on Garlic and Guggul, `hepatotoxic_risk` on Giloy, and
   `potassium_affecting` on Aloe vera and Punarnava are the judgement calls.
6. **`red_flags.json`** — a clinician should check for missing presentations and
   for Hinglish phrasings that were not thought of.
7. **The classifier** — synthetic training data, and a macro-F1 that overstates
   real performance. It has never seen a real user's words.
8. **The insulin label substitution and insulin analogue brand mapping** — see
   `DATA_NOTES.md`.
9. **Whether offering conventional drug options at all is appropriate** for a
   consumer-facing tool, given that all 13 are prescription-only in practice.

## Decisions taken by default

Recorded so they can be overruled rather than discovered.

| Decision | Why |
|---|---|
| 6 supported conditions, angina excluded | Chest pain must always route to emergency care, so an angina class could never fire from free text. |
| Class aliases in their own file, not `medicine_aliases.csv` | A class term names a group; recording it against one member would assert an identity that is not there, and the existing loader requires an existing medicine. |
| Brand names stored but filtered from all output | A user needs to type what is on their strip; a response must not name a product. |
| Class-level tags are the intersection, not the union | A caution raised against a class must hold for whichever member the user takes. |
| Suggestion × suggestion limited to herb × drug | The realistic risk is adding a herb to a prescribed drug. Every herb pair would repeat one sentence dozens of times. |
| No-finding suggestion pairs counted, not listed | Keeps the actionable warnings readable; the counts reconcile so nothing is hidden. |
| `clinical` evidence maps to `limited` in the topic table | The clinical rows rest on single small trials, which is what `limited` means elsewhere in this project. |
| `preclinical` maps to `insufficient` | Animal work is not grounds for a human claim. |
| Low-confidence floor is a margin below the threshold | A fraction of a low threshold lands inside the noise band. |
| Pairs between two current medicines are not checked | Already a prescribing decision; the service was not asked about them. |
| Insulin analogue brands map to the generic Insulin row | Missing a hypoglycaemic interaction for someone who names their pen is the worse failure. |
