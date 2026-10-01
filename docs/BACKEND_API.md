# Backend API — medicine information and interaction checking

Read-only JSON API over the project's curated herb–drug interaction data. It
answers four kinds of question:

- what is this medicine? (Ayurvedic/herbal and allopathic/conventional)
- do these two medicines have a documented interaction?
- what interacts with this medicine?
- how much evidence is behind all of this? (`GET /stats`)
- given a health problem described in plain text, what options exist and what
  should not be combined? (`POST /recommend` — see
  [RECOMMEND_API.md](RECOMMEND_API.md))

Everything it serves is derived from files already in this repository. The
backend adds no medical content of its own: see
[What is and is not populated](#what-is-and-is-not-populated).

## Quick start

```
python -m hdi.seed          # build the query database (a few seconds)
python -m hdi.api           # serve on http://127.0.0.1:8000
```

Tests:

```
python -m unittest tests.test_normalize tests.test_backend    # backend, ~1s
python -m unittest tests.test_recommend                       # /recommend, ~2s
python -m unittest discover -s tests                          # everything, ~20s
```

Validate the reference files on their own, before seeding:

```
python -m hdi.validate_reference
```

No new dependencies: the backend uses only the standard library (`sqlite3`,
`http.server`). `requirements.txt` is unchanged. The condition classifier behind
`/recommend` is trained offline (`requirements-ml.txt`) and exported to JSON;
`hdi/classify.py` evaluates it with the standard library, so serving still needs
nothing installed.

## Architecture

```
data/reference/*.csv          authoritative, frozen scope
data/processed/*.json|csv     authoritative, curator-reviewed
        |
        |  python -m hdi.seed        (derive; never writes back)
        v
data/processed/hdi.db         disposable read model, indexed
        |
        v
hdi/catalog.py  hdi/interactions.py  hdi/topics.py     service layer
hdi/knowledge.py  hdi/safety.py  hdi/recommend.py
        |
        |  ml/artifacts/condition_classifier.json      (read by hdi/classify.py)
        v
hdi/api.py                    routes: validate -> service -> JSON
```

The CSV/JSON files stay the source of truth, which is the storage choice
recorded in `notes/reference_systems_review.md`. SQLite is layered on top only
for what the API needs from it: indexes on the fields searches hit, and
parameterized queries. `hdi.db` is gitignored and can be deleted and rebuilt at
any time.

Query lookups are pure database reads. No network call or LLM sits on the
request path, and `tests.test_backend.SecurityTest` plus
`tests.test_recommend.ServiceIsolationTest` assert that. `/recommend` evaluates
one exported model — a JSON file of TF-IDF weights and logistic-regression
coefficients, read by `hdi/classify.py` using the standard library. There is no
pickle, no model runtime and nothing to download at startup.

## Data model

### `medicines`

53 rows: 40 Ayurvedic herbs and 13 conventional drugs, exactly the frozen scope
of `data/reference/herbs.csv` and `data/reference/drug_classes.csv` (`docs/PROJECT_SCOPE.md`
freezes that scope; the backend does not extend it).

| Column | Notes |
|---|---|
| `id` | stable slug, `herb-ashwagandha` / `drug-warfarin` |
| `name`, `normalized_name` | `normalized_name` is indexed and internal |
| `category` | `ayurvedic` \| `herbal` \| `allopathic` \| `conventional` |
| `medicine_type` | `herb` \| `drug` |
| `generic_name`, `active_ingredients` | populated for drugs |
| `scientific_name` | botanical name, populated for herbs |
| `drug_class` | Anticoagulants / Antidiabetics / Cardiovascular |
| `description`, `common_uses`, `traditional_uses` | NULL — no source |
| `evidence_level` | NULL — no use data to grade |
| `side_effects`, `contraindications`, `precautions` | NULL — no source |
| `pregnancy_information`, `breastfeeding_information` | NULL — no source |
| `source`, `source_url`, `last_verified` | provenance of the row |

`traditional_uses` and `common_uses` are separate columns by design, so a
traditional Ayurvedic claim can never be read back as a clinically established
one. Populating one never populates the other.

### `medicine_aliases`

208 rows: 134 from the reference tables (every herb's botanical name and every
listed synonym — `Ashwagandha` ← `Withania somnifera`, `Indian Ginseng`, `Winter
Cherry`, `Asgandh`) plus 74 from `data/reference/medicine_aliases.csv`, which
holds the drugs' generic synonyms and 49 brand names.

Brand names carry `alias_type = 'brand_name'` and are **matching-only**. They are
recorded so a user can type what is printed on their strip, and
`hdi.catalog.PRIVATE_ALIAS_TYPES` strips them from every response body, including
this endpoint's `aliases` list. Naming a commercial product in a health answer is
a step towards recommending one, so resolution uses them and output never does.

Identity between two names is **only** ever expressed here, never inferred.
`hdi.normalize.normalize_name` folds case, accents and punctuation and nothing
else, so `Amla` and `Bhumi Amla`, or `Black pepper` and `False Black Pepper`,
stay distinct records. To declare that two names are one substance (the
`Paracetamol` / `Acetaminophen` case), add a row to
`data/reference/medicine_aliases.csv` and re-seed.

### `interactions`

520 rows, one per herb × drug pair in the harvested corpus. Order-independence
is enforced by the schema, not by convention:

```sql
pair_key TEXT NOT NULL UNIQUE          -- sorted "<a>|<b>"
CHECK (medicine_a_id < medicine_b_id)  -- canonical direction
```

A reversed duplicate is therefore impossible to insert, and a lookup finds the
one stored row whichever way round it is asked. Responses echo the order the
*caller* used.

| Column | Notes |
|---|---|
| `status` | see [Result states](#result-states) |
| `pair_kind` | `ayurvedic_allopathic` \| `ayurvedic_ayurvedic` \| `allopathic_allopathic` |
| `interaction_type` | the curated trigger group that fired |
| `severity` | see [Severity](#severity) |
| `severity_basis` | how severity was arrived at |
| `description` | factual statement of what the record holds |
| `mechanism` | NULL — abstract-level mining does not establish it |
| `clinical_significance` | NULL — only ever set from an explicit source |
| `recommended_action` | NULL — this database issues no clinical advice |
| `evidence_level`, `evidence_basis` | see [Evidence levels](#evidence-levels) |
| `source`, `source_url`, `last_verified` | provenance |

### `interaction_evidence`

84 rows — every curated candidate sentence, including the 52 a curator
*rejected*, because what was examined and dismissed is part of why a pair reads
`no_documented_interaction`. Each row carries a PMID (required by `docs/PROJECT_SCOPE.md`)
and a `source_url` built from it.

`confidence` is `human_verified` only for the 28 curator-confirmed rows.
Rejected and unclear rows stay `auto_extracted` however carefully they were
reviewed, because `docs/PROJECT_SCOPE.md` forbids marking auto-extracted rows as verified
and a rejection is not verification of an interaction.

### `health_topic_map`

Topic → medicine associations, tagged `conventional_use`, `traditional_use` or
`evidence_supported_use`, each with its own evidence level and source.

48 rows, one topic per supported condition, derived by `hdi/seed.py` from
`medicine_uses`. Nothing is invented: every row restates a `medicine_uses` row and
carries that row's provenance. Which bucket a row lands in is decided by its
evidence, so a traditional claim can never be read back as a conventional
indication:

| Source row | `use_type` | `evidence_level` |
|---|---|---|
| a drug's labelled indication | `conventional_use` | `limited` |
| a herb use with no study behind it | `traditional_use` | `traditional` |
| a herb use with animal work behind it | `evidence_supported_use` | `insufficient` |
| a herb use with human work behind it | `evidence_supported_use` | `limited` |

`preclinical` maps to `insufficient` because animal work is not grounds for a
human claim, however clean the experiment. `clinical` maps to `limited`, not
`moderate`, because the clinical rows here rest on single small trials — which is
what `limited` means everywhere else in this project.

A lookup resolves lay wordings through `condition_synonyms`, so `topic=sugar` and
`topic=sugar ki bimari` both reach the type 2 diabetes rows. Extra hand-written
rows can still be added to `data/reference/health_topics.csv`; an exact match on
one of those wins over a condition synonym.

With no knowledge files present the table is empty and a lookup returns
`no_topic_data` with instructions, rather than empty lists that would read as
"nothing applies to this topic". `tests.test_backend.EmptyTopicDataTest` covers
that path.

### `conditions`, `condition_synonyms`

The 6 supported conditions and their 102 lay and Hinglish wordings, from
`data/reference/conditions.csv`. Derived from what the 13 drugs and 3 classes are
recorded for; anything outside this table is out of scope. `GET /conditions`
returns the list.

### `tag_vocabulary`, `medicine_tags`

16 pharmacological tags (`hypoglycemic`, `antiplatelet`, `cyp_inhibitor`,
`narrow_therapeutic_index`, …) and their assignment to medicines. A medicine's
tags are the **union** across all of its recorded uses, because a tag describes
the substance, not the use it was written beside.

The vocabulary is closed: `hdi/validate_reference.py` fails the build on a tag
that is not in it. A misspelled tag is worse than a missing one — the rule it was
meant to trigger would never fire and nothing would complain.

### `medicine_uses`

48 rows: 28 herb-condition and 20 drug-condition, from
`data/reference/herb_uses.csv` and `data/reference/drug_indications.csv`. Each
carries pros, cons, cautions, tags, `source_type`, `source_note` and
`reviewed`.

`reviewed` has a `CHECK (reviewed = 0)` constraint. Nothing in this project has
had clinical review, and `docs/PROJECT_SCOPE.md` forbids marking unreviewed data
as reviewed, so the schema makes it impossible rather than merely discouraged.

### `combination_rules`

36 tag-pair rules from `data/reference/combination_rules.csv`, each with an
`applies_to` (`herb+drug` | `herb+herb` | `drug+drug`), a one-sentence reason and
a level. Matching is symmetric. A rule result is **always** labelled
"Mechanism-based caution (not literature-verified)".

### `class_aliases`

31 lay and Hinglish names for a whole drug class ("blood thinner", "sugar ki
dawa"). These resolve to a class rather than a medicine, so they cannot live in
`medicine_aliases` without asserting an identity that is not there.

## Result states

The four states are deliberately distinct. Collapsing any two of them would
misrepresent the evidence.

| State | Meaning | HTTP |
|---|---|---|
| `interaction_found` | documented in our curated sources | 200 |
| `no_documented_interaction` | we looked in our sources and found nothing | 200 |
| `insufficient_evidence` | we have no adequate basis to answer | 200 |
| `medicine_not_found` | at least one name did not resolve | 404 |

`interaction_found` in the response body is `true`, `false`, or **`null`** for
`insufficient_evidence` — neither yes nor no, because the question cannot be
answered.

`no_documented_interaction` is **never** phrased as safety. The response says
"No documented interaction was found in the available sources", and the
disclaimer states that absence of a documented interaction is not evidence of
safety. Nothing in this project's evidence base supports a safety claim.

Where each state comes from, all of it from real curator decisions:

| Count | State | Basis |
|---|---|---|
| 10 | `interaction_found` | curator confirmed the evidence |
| 3 | `insufficient_evidence` | curator marked the evidence unclear |
| 18 | `no_documented_interaction` | curator reviewed candidates and rejected them |
| 145 | `no_documented_interaction` | abstracts screened, no interaction language found |
| 344 | `no_documented_interaction` | PubMed search returned no abstracts |

Pairs outside the 520-pair corpus — every herb+herb and drug+drug combination —
return `insufficient_evidence`, with `evidence_basis` explaining that the pair
was never harvested. Those pair kinds are fully supported by the schema and the
API; the corpus simply holds no evidence for them yet, and saying so is the
honest answer.

## Severity

`major` · `moderate` · `minor` · `none_documented` · `insufficient_evidence`

For a documented interaction, severity is derived from the project's own curated
trigger-group taxonomy, which already carries an explicit severity ordering in
`hdi.curate.SEVERITY_ORDER` (documented in `CURATION_GUIDE.md` as "trigger
severity, most severe first"):

| Trigger group | Severity |
|---|---|
| `contraindication` | `major` |
| `antagonism`, `risk_increase`, `pharmacokinetic` | `moderate` |
| `potentiation`, `general_interaction` | `minor` |

This is a **derivation, not a clinical severity rating**, which is why every row
records `severity_basis: derived_from_curated_trigger_group`. No LLM is involved.
Un-negated sentences are preferred when banding a pair; a pair resting entirely
on negation-flagged sentences says so in `severity_basis`.

## Evidence levels

`strong` · `moderate` · `limited` · `traditional` · `insufficient`

| Level | When |
|---|---|
| `moderate` | curator-confirmed across ≥ 3 distinct PMIDs |
| `limited` | curator-confirmed, fewer than 3 PMIDs; or literature screened with no finding |
| `insufficient` | curator marked unclear, no abstracts retrieved, or pair not in corpus |

`strong` is unused: nothing in this project rests on systematic review, and
`traditional` awaits sourced traditional-use data. A curator-confirmed finding
is `limited` by default because it rests on primary-literature abstracts.

## What is and is not populated

This is a health-information system, so the distinction matters more than
completeness.

**Populated, with provenance:** medicine names, categories, botanical names,
herb synonyms, drug generic names and classes, interaction pairs and their
result states, severity bands, evidence levels, PMIDs, evidence sentences,
curator verdicts, source files and verification dates.

**Deliberately NULL:** medicine descriptions, uses (conventional and
traditional), side effects, contraindications, precautions, pregnancy and
breastfeeding information, interaction mechanisms, clinical significance,
recommended actions, health-topic associations.

Those are NULL because no file in this repository sources them, and inventing
medical content is prohibited. A NULL means **"not documented in our sources"**,
never a negative finding. The medicine detail endpoint makes this explicit
rather than leaving a consumer to guess:

```json
"data_completeness": {
  "documented_fields": [],
  "undocumented_fields": ["description", "side_effects", "contraindications", "..."],
  "note": "Undocumented fields are absent from this project's sources. An empty
           value means no information was available, not a negative finding."
}
```

To populate any of them, add a sourced reference file and extend `hdi/seed.py`.

## Endpoints

### `GET /health`

Service and database provenance: row counts, build time, and the verification
date of each reference file.

### `GET /medicines`

`category` (`ayurvedic` | `allopathic` | `all`, default `all`), `limit` (1–100),
`offset`.

### `GET /medicines/search?q=`

Searches name, normalized name, generic name, active ingredient, scientific name
and aliases. Results are ranked by match quality — exact name, exact alias, name
prefix, alias prefix, name substring, alias substring — then alphabetically, and
each carries `matched_on` saying which applied.

```
GET /medicines/search?q=ashwagandha
GET /medicines/search?q=Indian%20Ginseng      -> Ashwagandha (exact_alias)
GET /medicines/search?q=Withania%20somnifera  -> Ashwagandha
GET /medicines/search?q=Metformin&category=allopathic
```

Parameters: `q` (required), `category`, `limit` (1–100, default 20).

A query with no match returns `count: 0`. `q=Paracetamol` returns nothing,
because Paracetamol is outside the frozen reference scope — an empty result, not
a fabricated record.

### `GET /medicines/{id}`

Full detail: identity, aliases, category, generic/active ingredient, scientific
name, drug class, uses (conventional and traditional, separately), evidence
level, safety fields, sources, `data_completeness`, and an interaction count by
status. Internal columns are not exposed.

It also returns `recorded_uses`: the rows from `medicine_uses` for this
medicine, each with its condition, evidence level, pros, cons, cautions,
`source_type`, `source_note` and `reviewed`. The detail columns above are NULL
for every medicine by design, so these are the only sourced uses this project
holds, and a client showing a medicine needs both. An empty list means no file
here sources a use for it.

404 with `code: medicine_not_found` for an unknown id.

### `GET /medicines/{id}/interactions`

Every stored interaction involving the medicine. `category` filters the **other**
side of the pair, which is what answers both directions of the question:

```
GET /medicines/drug-warfarin/interactions?category=ayurvedic&status=interaction_found
    -> Garlic, Pippali
GET /medicines/herb-ashwagandha/interactions?category=allopathic
```

Parameters: `category`, `status` (one of the three interaction states),
`include_evidence` (default false), `limit`, `offset`. Documented interactions
sort first, then by severity.

### `GET /interactions/check?medicine_a=&medicine_b=`

The direct pair check. Accepts an id, a name or a declared alias on either side,
in any order.

```
GET /interactions/check?medicine_a=Garlic&medicine_b=Warfarin
GET /interactions/check?medicine_a=Warfarin&medicine_b=Garlic   # same record
GET /interactions/check?medicine_a=Lashuna&medicine_b=Warfarin  # alias, same record
POST /interactions/check  {"medicine_a": "Haldi", "medicine_b": "Digoxin"}
```

Returns one of the four result states, with `medicine_a`/`medicine_b`,
`severity`, `evidence_level`, `description`, the citation list, and the
disclaimer.

Errors: 400 `missing_parameter`, 400 `identical_medicine` (both sides resolve to
one substance, including via alias), 404 `medicine_not_found` (with `side`
naming which input failed), 409 `ambiguous_medicine` (a name matching more than
one medicine, with candidate ids — the checker will not guess).

### `GET /interactions/documented`

All pairs with a documented interaction. `pair_kind` filters by combination
type; `limit` (1–1000, default 100).

### `GET /health-topics` · `GET /health-topics/lookup?topic=`

Topic associations grouped into `conventional_use`, `traditional_use` and
`evidence_supported_use`. Informational only: no ranking, no recommendation, no
dosage, no diagnosis.

```
GET /health-topics/lookup?topic=Type%202%20diabetes
GET /health-topics/lookup?topic=sugar              # lay wording, same rows
GET /health-topics/lookup?topic=sugar%20ki%20bimari
```

Three states stay distinct: `topic_found`, `topic_not_found` (we hold topic data
and this is not in it), and `no_topic_data` (we hold none at all, with
instructions). The last is deliberately not an empty result, which would imply
"nothing applies to this topic".

### `GET /conditions`

The supported conditions for `/recommend`, with each one's related drug classes.
Derived from the frozen reference tables; anything else is out of scope.

### `GET /stats`

Counted facts about the pipeline, the scope, the knowledge rows and the
classifier, for a client that wants to display real numbers.

Every figure is a `COUNT(*)` or the length of a list in a file on disk, computed
on each request by `hdi/stats.py`. Nothing is written down twice, so a count
here cannot drift from the data it describes.

```json
{
  "literature": {
    "pairs_searched": 520, "abstracts_harvested": 1240,
    "distinct_pmids_harvested": 988, "candidate_sentences": 84,
    "evidence_rows": 84,
    "verdicts": {"confirmed": 28, "rejected": 52, "unclear": 4},
    "documented_pairs": 10,
    "result_states": {"interaction_found": 10, "...": 0},
    "no_finding_basis": {"abstracts_screened_nothing_found": 145, "...": 0},
    "distinct_pmids_cited": 29
  },
  "scope": {"medicines": 53, "herbs": 40, "drugs": 13, "drug_classes": 3, "...": 0},
  "knowledge": {"rows": 48, "by_source_type": [], "reviewed_rows": 0, "...": 0},
  "classifier": {"macro_f1_test": 0.876, "per_class": [], "...": 0},
  "classifier_note": null,
  "database": {"built_at": "...", "...": "..."},
  "note": "Every count here is read from this repository's own files ..."
}
```

`classifier` is read from `ml/reports/metrics.json`, which `ml/evaluate.py`
writes in the same pass as `eval.md` so the two cannot disagree. In a checkout
where the evaluation has not been run it is `null` and `classifier_note` says
what to run — which is a different answer from a zero, and deliberately so.

The two raw files it reads are a few megabytes between them, so they are parsed
once and cached against their size and modification time. A file that is absent
is reported as `null` rather than as a count of nothing.

### `POST /recommend`

Free-text health problem in; Ayurvedic and conventional options, pros and cons,
and combination warnings out. Red-flag screening runs before anything else and
short-circuits to an emergency response.

```
POST /recommend  {"text": "my sugar is high", "current_medicines": ["Glycomet"]}
```

Full reference, including the request and response shapes, the four statuses, the
four warning levels, the output rules, the real classifier metrics and what still
needs expert review: **[RECOMMEND_API.md](RECOMMEND_API.md)**.

## Validation and errors

Errors use `{"error": {"code": ..., "message": ...}}`.

| Status | Codes |
|---|---|
| 400 | `missing_parameter`, `invalid_parameter`, `identical_medicine`, `invalid_body` |
| 404 | `medicine_not_found`, `not_found` |
| 405 | `method_not_allowed` |
| 409 | `ambiguous_medicine` |
| 500 | `internal_error` |
| 503 | `database_unavailable` (database not built), `classifier_unavailable`, `knowledge_unavailable` |

Validated: missing and blank required parameters, non-integer and out-of-range
`limit`/`offset`, unknown `category` / `status` / `pair_kind`, unknown medicine,
unknown route, wrong method, malformed JSON body, and both sides resolving to
the same medicine. A blank *optional* parameter means "not supplied" and falls
back to its default; a blank *required* one is a 400.

An unexpected exception is logged server-side and returned as a generic 500. No
traceback, SQL, or file path reaches the client.

## Security

- Every query is parameterized; no user input is concatenated into SQL.
- `LIKE` patterns escape `%`, `_` and `\`. Normalization also strips them before
  they reach a query, so a wildcard cannot broaden a search.
- The API opens SQLite read-only (`mode=ro`); no request can write.
- Internal exception details are never returned.
- Secrets stay in environment variables (`.env`, gitignored). The backend needs
  none: only `scripts/collect_abstracts.py` uses `NCBI_EMAIL` / `NCBI_API_KEY`.
- No LLM on the request path, so no prompt can override these rules. If one is
  ever added for phrasing, it must summarize retrieved records only, and an
  `insufficient_evidence` result must stay `insufficient_evidence`.
- The classifier `/recommend` uses is a JSON file of numbers, not a pickle or a
  saved object graph, so loading it cannot execute code.
- `tests.test_recommend.ServiceIsolationTest` walks the imports of every service
  module and fails on anything outside the standard library, and asserts that two
  identical requests produce byte-identical answers.
- No response may carry a dose, a brand name or an unnegated safety claim;
  `hdi/validate_reference.py` enforces that on the files and
  `tests.test_recommend.ForbiddenOutputTest` on every string of every response.

## Indexes

`medicines`: `normalized_name`, `generic_name`, `scientific_name`, `category`,
`medicine_type`, `drug_class`.
`medicine_aliases`: `normalized_alias`.
`interactions`: `medicine_a_id`, `medicine_b_id`, `pair_key` (unique), `status`,
`severity`, `pair_kind`.
`interaction_evidence`: `pmid`, `confidence`.
`health_topic_map`: `normalized_topic`, `medicine_id`.

Search hits two of these: `idx_medicines_normalized_name` for a medicine's own
name, and `idx_aliases_normalized` for every other name it is known by. There is
deliberately no index on `active_ingredients`: it stores a JSON array, so a plain
column index cannot serve a containment query. Ingredient search instead goes
through `medicine_aliases` (`alias_type = 'active_ingredient'`), where it is
indexed and normalization-consistent.

## Seeding

```
python -m hdi.seed [--db PATH] [--quiet]
```

Reproducible by construction: it only reads, derives every id from the reference
tables, and drops and recreates every table, so two runs over unchanged inputs
produce identical content (asserted by
`tests.test_backend.SeedTest.test_seeding_is_reproducible`). It never writes to
`data/raw/raw_abstracts.json` or `data/processed/candidates.json`, per
`docs/PROJECT_SCOPE.md`.

It also reports problems rather than hiding them: unknown medicine names in the
optional CSVs, aliases that resolve to more than one medicine, and any
disagreement between `curation_sheet.csv` and `verified_interactions.json`.

Re-seed after changing any reference or curated file.

> `python -m hdi.curate` (without `ingest`) regenerates `curation_sheet.csv`
> from `candidates.json` and **discards recorded verdicts** — see
> `CURATION_GUIDE.md`. The seeder never calls it.

## Environment variables

The backend requires none; all three below have working defaults.

| Variable | Default | What it does |
|---|---|---|
| `HOST` | `127.0.0.1` | Listen address. A host that expects `0.0.0.0` sets this. |
| `PORT` | `8000` | Listen port. A host that assigns a port sets this; a value that is not a number falls back and says so on stderr. |
| `ALLOWED_ORIGINS` | `http://localhost:3000` | Comma-separated browser origins allowed to call this API. |

`--host` and `--port` still win over the environment.

`scripts/collect_abstracts.py` (the harvest stage, not on the API path) reads
`NCBI_EMAIL` and `NCBI_API_KEY` from `.env`; see `.env.example`.

### CORS

An origin on `ALLOWED_ORIGINS` gets `Access-Control-Allow-Origin` back; an
origin that is not on it gets no such header, so the browser refuses the
response itself. The list is never reflected blindly and `*` is not the default,
though `*` on the list does allow any origin — this API serves nothing per-user
and carries no credential, so that is a configuration choice rather than a hole.

`Vary: Origin` is always sent, so a cache in front of this cannot hand one
origin's allowed response to another. `OPTIONS` is answered with 204 for any
path, without touching the database: a preflight asks whether the browser may
send the real request, and the real request is the one that gets routed and
validated. Error responses carry the CORS headers too — otherwise a browser
would hide a 400 and the client would see a network failure instead of the
message the API actually sent.

## Module map

| File | Role |
|---|---|
| `hdi/schema.sql` | DDL, constraints and indexes |
| `hdi/db.py` | connections, result-state and severity vocabulary |
| `hdi/normalize.py` | name normalization, ids, order-independent pair keys |
| `hdi/seed.py` | reproducible build from reference and curated files |
| `hdi/validate_reference.py` | checks the reference CSVs before they are seeded |
| `hdi/catalog.py` | medicine and class resolution, search, detail projection |
| `hdi/interactions.py` | pair checks, per-medicine listings, result states |
| `hdi/topics.py` | health-topic mapping |
| `hdi/knowledge.py` | conditions, uses and combination rules |
| `hdi/safety.py` | red-flag screening and caution flags |
| `hdi/classify.py` | condition classifier inference, standard library only |
| `hdi/recommend.py` | the recommendation service |
| `hdi/stats.py` | counted facts about the pipeline, the scope and the classifier |
| `hdi/api.py` | routing, validation, CORS, JSON responses, HTTP server |
| `ml/make_dataset.py` | builds the synthetic classifier dataset |
| `ml/train.py` | trains and exports the classifier |
| `ml/evaluate.py` | per-class metrics, macro-F1, confusion matrix, report |
| `scripts/fetch_drug_labels.py` | retrieves openFDA labels for provenance |
| `tests/test_normalize.py` | normalization unit tests |
| `tests/test_backend.py` | seeding, catalog, interactions, topics, API, security, end-to-end |
| `tests/test_reference_data.py` | reference validation, seeded knowledge, topics |
| `tests/test_recommend.py` | `/recommend` scenarios, output rules, service isolation |
| `tests/test_classifier.py` | dataset hygiene, artifact shape, scikit-learn parity |
| `tests/test_stats_and_cors.py` | `/stats`, CORS, `HOST`/`PORT`, `recorded_uses` |
