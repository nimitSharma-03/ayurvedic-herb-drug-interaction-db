# Reference data notes

Provenance for the knowledge files added for `POST /recommend`, the rows that
were deliberately **left out**, and what a human has to check before any of this
is used for real.

Nothing here has been reviewed by a clinician. Every row in `herb_uses.csv` and
`drug_indications.csv` carries `reviewed=false`, and `hdi/validate_reference.py`
fails the build if any row claims otherwise.

## Where each row came from

`source_type` is on every row. Counts as shipped:

| `source_type` | Rows | Meaning |
|---|---|---|
| `fetched_source` | 19 | Written from an openFDA drug label this project actually retrieved. |
| `repo_abstract` | 21 | Written from PubMed abstracts already in `data/raw/raw_abstracts.json`, cited by PMID. |
| `general_knowledge` | 8 | Written from established pharmacology or classical Ayurvedic materia medica, with no source file behind it. |
| **Total** | **48** | |

### `fetched_source` (19 rows, all in `drug_indications.csv`)

`scripts/fetch_drug_labels.py` queried the openFDA label API
(`https://api.fda.gov/drug/label.json`) for all 13 drugs and stored the sections
it read in `data/raw/openfda_labels.json`. Each row's `source_note` names the SPL
`set_id` and effective date it was written from, so any claim can be traced back
to a specific label version.

The label text itself is **not** copied into the CSV. Labels are full of brand
names and dosing, and neither may appear in an API response, so each row is a
hand-written plain-language reduction of what the label says. That rewriting is
the step a reviewer most needs to check.

Labels retrieved:

| Drug | SPL `set_id` | Effective |
|---|---|---|
| Warfarin | `0cbce382-9c88-4f58-ae0f-532a841e8f95` | 2025-06-17 |
| Heparin | `02fb700d-a28c-4d45-b78d-382dc0d5986c` | 2025-09-26 |
| Aspirin | `0058175f-3474-40c3-a046-6cfaec86d84b` | 2024-04-16 |
| Clopidogrel | `0078fb3d-3595-4ae1-a059-1d5e81c879cf` | 2024-05-17 |
| Metformin | `011de1a5-1ac0-4831-9e8d-26ec79ba2205` | 2024-08-21 |
| Glimepiride | `0003458f-352a-46fa-9d99-230daa76ae29` | 2024-11-13 |
| Insulin | `b60e8dd0-1d48-4dc9-87fd-e14675255e8c` | 2026-07-01 |
| Pioglitazone | `0331400c-b163-4856-bfb0-965470247cb3` | 2025-05-17 |
| Digoxin | `03612934-62f4-4002-85af-6c66cd172acb` | 2024-09-04 |
| Atenolol | `09b21985-1818-449d-9b29-98f733cf7b9f` | 2024-11-26 |
| Metoprolol | `00940cc5-d2eb-4841-9138-de97d7b1c674` | 2026-07-27 |
| Amlodipine | `003dd1ec-16f8-4f96-b6a8-c4689d35892a` | 2026-04-20 |
| Losartan | `021cd76a-b093-4704-8410-5e7d01e20a54` | 2026-08-27 |

Two of these needed care:

- **Aspirin** is the one drug whose row is `general_knowledge` despite a label
  being fetched. Every US openFDA label for aspirin is an over-the-counter
  analgesic monograph: its stated use is "temporary relief of minor aches and
  pains", and the cardiovascular use that puts aspirin in this project's
  Anticoagulants class is not on the label at all. Writing the antiplatelet
  indication as `fetched_source` would have cited a label that does not say it.
  The fetched label was read for its warnings only.
- **Insulin** first matched a homeopathic product whose label makes no glycemic
  claim. The query is now pinned to a subcutaneous human-insulin label
  (`SEARCH_OVERRIDES` in `scripts/fetch_drug_labels.py`). The label that matched
  is a concentrated product; its indication, contraindications and adverse
  reactions are representative of insulin, but the specific product is not.

### `repo_abstract` (21 rows, all in `herb_uses.csv`)

Written from abstracts already harvested into `data/raw/raw_abstracts.json`.
Every PMID cited in a `source_note` is checked against that file by
`tests/test_reference_data.py`, so a citation cannot be a plausible-looking
number that was never retrieved.

The strongest of these:

| Herb | Condition | PMID | What the abstract is |
|---|---|---|---|
| Aloe vera | Type 2 diabetes | 22198821 | Randomised double-blind placebo-controlled trial |
| Cinnamon | Type 2 diabetes | 19930003 | Review of randomised controlled trials |
| Karela | Type 2 diabetes | 15521566 | Human study in NIDDM patients |
| Arjuna | Heart failure, secondary prevention | 9505018 | Patients with post-infarction angina and ischaemic cardiomyopathy |
| Amla | Type 2 diabetes (antiplatelet tag) | 24291054 | Human study alongside clopidogrel and aspirin |

Two rows are honestly mixed and say so in `source_note`:

- **Giloy / type 2 diabetes** cites PMID 1529024 and 19520137 for the glycaemic
  effect, but its `hepatotoxic_risk` tag rests on published Indian case series
  that are **not** in this corpus. The tag is kept because leaving it off would
  suppress a liver-injury caution that matters.
- **Garlic** and **Turmeric** rows reference the interaction PMIDs this project
  curated itself (`data/processed/verified_interactions.json`) alongside their
  use PMIDs.

### `general_knowledge` (8 rows)

Seven herb rows and one drug row with no file in this repository behind them.
Each `source_note` states what the basis is and that the corpus holds nothing:

| Row | Basis |
|---|---|
| Sarpagandha / hypertension | Classical materia medica for *Rauvolfia serpentina* plus its well-established pharmacology. The corpus holds no study of it. |
| Punarnava / hypertension, heart failure | Classical use of *Boerhavia diffusa* in shotha (fluid swelling). No cardiovascular study in the corpus. |
| Jatamansi / hypertension, atrial fibrillation | Classical use of *Nardostachys jatamansi*. No cardiovascular or rhythm study in the corpus. |
| Arjuna / atrial fibrillation | Classical indication hridroga, which covers palpitation. No atrial fibrillation study anywhere in the corpus. |
| Guggul / secondary prevention | Classical use of *Commiphora wightii* in medoroga. The corpus holds only a multi-herb formulation abstract (PMID 13678230), not a guggul trial. |
| Aspirin / secondary prevention | Established pharmacology; see the aspirin note above. |

## Aliases

`medicine_aliases.csv` holds 74 rows for the 13 drugs and a few herb
transliteration variants. 49 are `alias_type=brand_name`.

**Brand names are matching-only.** They are recorded so a user can type what is
printed on their strip, and `hdi.catalog.PRIVATE_ALIAS_TYPES` keeps them out of
every response body — including `/medicines/{id}`, which previously returned all
aliases. `tests/test_recommend.py` asserts no brand name appears in any
`/recommend` response or in the medicine detail projection.

Generic synonyms marked `fetched_source` (warfarin sodium, metformin
hydrochloride, losartan potassium and so on) are confirmed by the
`openfda.generic_name` field of the fetched labels. Brand names are
`general_knowledge`: Indian trade names are not in openFDA at all.

Insulin analogue brands (Lantus, Humalog, NovoRapid, Basalog, Glaritus) map to
the single generic `Insulin` row. Glargine, lispro and aspart are distinct
molecules, so this is a deliberate over-match: not resolving them would mean
missing a hypoglycaemic interaction for a user who names their pen, which is the
worse failure. `source_note` records the molecule in each case.

`class_aliases.csv` (31 rows) maps lay and Hinglish names for a whole drug class
("blood thinner", "sugar ki dawa", "bp medicine"). These cannot live in
`medicine_aliases.csv`, whose loader requires an existing medicine: a class term
names a group, and recording it against one member would assert an identity that
is not there.

## What was deliberately left out

Skipping a link was preferred to inventing one throughout.

### Herb-condition links not recorded

| Herb | Condition considered | Why not |
|---|---|---|
| Ashwagandha | Hypertension | Its record is as an adaptogen for stress. Any blood-pressure effect is indirect, and stress is not a supported condition. Ashwagandha therefore has no rows at all. |
| Tulsi | Hypertension | Preclinical cardiovascular data exist but the traditional indication is respiratory and metabolic. Not confident enough. |
| Kalmegh | Type 2 diabetes | Some preclinical antihyperglycaemic data, but the plant's established use is immune and febrile. |
| Haritaki, Bibhitaki | Type 2 diabetes | Preclinical antihyperglycaemic data as part of Triphala, not as single herbs. |
| Guggul | Venous thromboembolism | Antiplatelet activity is reported, but only within a multi-herb formulation in this corpus. |
| Fenugreek | antiplatelet **tag** | Fenugreek appears on most "herbs that increase bleeding risk" lists, but the only platelet-related abstracts in this corpus do not establish it for fenugreek. The bleeding caution is written into the row's `cautions` text instead, so the warning is not lost even though no mechanism rule fires on it. |
| Brahmi, Shankhpushpi, Vacha, Bhringraj, Manjistha, Kutki, Vasaka, Kantakari, Ashoka, Shatavari, Senna, Psyllium, Bhumi Amla, Vidanga, Boswellia, Black pepper, Moringa (clot), Neem (BP) | various | No genuine traditional or research basis for any of the six supported conditions. 23 of the 40 herbs have no rows. |

### Conditions not supported

The supported set is derived from what the 13 drugs and 3 classes are recorded
for. Two candidates were dropped:

- **Angina / stable coronary artery disease** is a labelled indication of
  atenolol, metoprolol and amlodipine, but every lay description of it mentions
  chest pain, which is a red flag that short-circuits to an emergency response
  before the classifier runs. A condition class that could never fire from free
  text would be dead weight, so angina is folded into
  `secondary_cardiovascular_prevention` and chest pain always routes to
  emergency care. This is deliberate over-triage.
- **High cholesterol / dyslipidaemia** is not an indication of any of the 13
  drugs, so it is out of scope even though Guggul is traditionally used for it.

### Drug-condition links not recorded

- **Metoprolol and atenolol for atrial fibrillation.** Rate control in atrial
  fibrillation is standard practice but is not on the immediate-release labels
  that were fetched, so it is not recorded. Atrial fibrillation is still
  answerable through warfarin, heparin and digoxin.
- **Losartan for stroke risk reduction** is on the label but as primary
  prevention in hypertension with left ventricular hypertrophy, which is not what
  `secondary_cardiovascular_prevention` means here.
- **Amlodipine for angina** — see the angina note above.
- **Losartan for diabetic nephropathy** is on the label, but kidney disease is
  not a supported condition.

### Red-flag patterns deliberately omitted

`red_flags.json` does not match bare `stroke` or `heart attack`, so a user giving
their history ("a heart attack last year") is classified rather than sent to an
emergency room. Stroke detection relies on acute-sign wording instead (face
drooping, slurred speech, sudden one-sided weakness, lakwa, falij).

Conversely, the patterns are written to **over**-trigger where the cost is
asymmetric: a false alarm costs a wasted referral, a miss costs a delayed
emergency. "Feeling faint", any mention of difficulty breathing, and anything
combining confusion with blood sugar all escalate.

## What a human must review before this is used for real

In rough order of risk:

1. **Every `pros`, `cons` and `cautions` string.** 48 rows of plain-language text
   written by reduction from labels, abstracts and classical sources. Automated
   checks catch dosing, brand names and safety claims; they cannot catch a
   clinically misleading summary.
2. **The 8 `general_knowledge` rows.** These have no source file at all. Either
   source them or remove them.
3. **The herb rows for atrial fibrillation.** Arjuna and Jatamansi are offered on
   a classical indication for palpitation, with no rhythm data of any kind.
   Atrial fibrillation carries a stroke risk that no herb addresses, and the
   `cautions` text says so, but a reviewer should decide whether offering
   anything here is appropriate at all.
4. **`combination_rules.csv` (36 rules).** Each is plausible pharmacology, and
   every result is labelled "Mechanism-based caution (not literature-verified)".
   A pharmacologist should confirm the tag pairs and the one-sentence reasons,
   and say which are missing.
5. **Tag assignments.** A wrong tag silently changes which cautions fire. The
   `cyp_inducer` tag on Garlic and Guggul, `hepatotoxic_risk` on Giloy, and
   `potassium_affecting` on Aloe vera and Punarnava are the judgement calls.
6. **`red_flags.json` coverage.** 9 categories, 109 patterns, English and
   Hinglish. A clinician should check for missing presentations; the current set
   was not reviewed by one.
7. **The condition classifier.** Trained entirely on synthetic phrasings
   (`ml/make_dataset.py`). `ml/reports/eval.md` states the real macro-F1 and says
   plainly that the figure overstates real-world performance.
8. **The insulin label substitution** and the **insulin analogue brand mapping**
   described above.
