# Ayurveda Herb–Drug Interaction Database

A literature-grounded herb–drug interaction database for Ayurvedic herbs, built using
NLP-assisted curation of PubMed abstracts.

## Overview

This project collects and structures evidence of interactions between Ayurvedic herbs
and conventional drug classes. Candidate interactions are identified from PubMed
abstracts using NLP-assisted extraction, then curated against a fixed set of reference
herbs and drug classes so that every entry in the database can be traced back to its
source literature.

## Scope

The reference set is frozen at 40 Ayurvedic herbs, 3 conventional drug classes, and
13 example drugs across those classes (see `data/reference/herbs.csv` and
`data/reference/drug_classes.csv`).

## Project Structure

- `data/reference/` — curated reference tables (herbs, drug classes, conditions,
  uses, tags, combination rules, aliases, red flags)
- `data/raw/` — raw, unmodified data pulled from external sources (PubMed
  abstracts, openFDA labels)
- `data/processed/` — extraction output, curation sheet, verified interactions
- `scripts/` — data collection scripts
- `hdi/` — extraction, curation, and the backend data/API layer
- `ml/` — condition-classifier dataset, training, evaluation and artifacts
- `docs/` — curation guide and backend API reference
- `tests/` — extraction, backend, reference-data, recommendation and classifier suites
- `notes/` — working notes and curation logs
- `web/` — the front end: browsing, lookup and the recommendation interface

## Setup

1. Create and activate a Python 3.11 virtual environment:
   ```
   python -m venv venv
   venv\Scripts\activate      # Windows
   source venv/bin/activate   # macOS/Linux
   ```
2. Install dependencies:
   ```
   pip install -r requirements.txt
   ```
3. Copy `.env.example` to `.env` and fill in your NCBI API key and email.
4. Build the query database and serve the API:
   ```
   python -m hdi.seed
   python -m hdi.api
   ```
5. Run the tests:
   ```
   python -m unittest discover -s tests
   ```

## Data Sourcing

Literature data is retrieved from PubMed via NCBI E-utilities (using Biopython) and
requires an NCBI API key and a registered email address, configured through
environment variables (see `.env.example`).

Drug indication, contraindication and adverse-reaction data is retrieved from the
openFDA drug label API (`https://api.fda.gov/drug/label.json`), which needs no
key. Each row records the SPL `set_id` and effective date it was written from.
Provenance for everything else, including the rows deliberately left out, is in
[data/reference/DATA_NOTES.md](data/reference/DATA_NOTES.md).

## Pipeline

| Stage | Command | Output |
|---|---|---|
| Harvest abstracts | `python scripts/collect_abstracts.py [--resume]` | `data/raw/raw_abstracts.json` |
| Extract candidates | `python -m hdi.extract` | `data/processed/candidates.json` |
| Build curation sheet | `python -m hdi.curate` | `data/processed/curation_sheet.csv` |
| Ingest verdicts | `python -m hdi.curate ingest` | `data/processed/verified_interactions.json` |
| Fetch drug labels | `python scripts/fetch_drug_labels.py` | `data/raw/openfda_labels.json` |
| Validate reference files | `python -m hdi.validate_reference` | exits non-zero on a problem |
| Build query database | `python -m hdi.seed` | `data/processed/hdi.db` |
| Serve the API | `python -m hdi.api` | `http://127.0.0.1:8000` |
| Serve the front end | `cd web && npm run dev` | `http://localhost:3000` |

Condition classifier (training only; the API does not need these):

| Stage | Command | Output |
|---|---|---|
| Install training deps | `python -m pip install -r requirements-ml.txt` | |
| Build the dataset | `python ml/make_dataset.py` | `ml/data/train.jsonl`, `test.jsonl` |
| Train and export | `python ml/train.py` | `ml/artifacts/condition_classifier.json` |
| Evaluate | `python ml/evaluate.py` | `ml/reports/eval.md`, confusion matrix |

`python -m hdi.curate` (without `ingest`) overwrites the curation sheet and discards
recorded verdicts — see [docs/CURATION_GUIDE.md](docs/CURATION_GUIDE.md).

## Backend API

A read-only JSON API serves medicine information and interaction checks:

```
python -m hdi.seed          # build the query database from the curated files
python -m hdi.api           # serve on http://127.0.0.1:8000
```

```
GET  /medicines/search?q=ashwagandha
GET  /medicines/{id}
GET  /medicines/{id}/interactions?category=allopathic
GET  /interactions/check?medicine_a=Garlic&medicine_b=Warfarin
GET  /health-topics/lookup?topic=sugar
GET  /conditions
GET  /stats
POST /recommend
```

Interaction checks are order-independent and resolve aliases, and they
distinguish a documented interaction from "no documented interaction found in
the available sources" from "insufficient evidence" — the middle one is never
reported as safety. Fields this project has no source for are returned as null
rather than filled in.

Full reference: [docs/BACKEND_API.md](docs/BACKEND_API.md).

## Recommendation endpoint

`POST /recommend` takes a health problem described in plain text (English or
Hinglish) and returns Ayurvedic options from the 40 herbs, conventional options
from the 13 drugs, the pros and cons of each, and the combinations that should
not be taken together — both among the options offered and against anything the
user says they already take.

```
python -m hdi.seed
python -m hdi.api

curl -s -X POST http://127.0.0.1:8000/recommend \
  -H "Content-Type: application/json" \
  -d '{"text": "my sugar is high", "current_medicines": ["Glycomet"]}'
```

It is informational only and never a prescription. Red-flag text (chest pain,
trouble breathing, stroke signs, suicidal thoughts and others, in English and
Hinglish) short-circuits to an emergency response with no options listed. No
dose, no brand name and no safety claim appears in any response. Only pairs the
curated literature marks documented are labelled "Literature-verified";
everything derived from pharmacological tags is labelled "Mechanism-based caution
(not literature-verified)".

Conditions are identified by a classifier trained offline and exported to JSON,
which `hdi/classify.py` evaluates using the standard library — so serving still
needs no dependencies, no API key and no network access.

Full reference, including the real classifier metrics and what still needs expert
review: [docs/RECOMMEND_API.md](docs/RECOMMEND_API.md).

## Front end

A browsing and lookup interface over the API, in `web/`. It holds no medical
content of its own: every medicine name, use, caution, interaction, count and
score it shows was read out of an API response, and its tests fail the build if
any of them is written into a source file.

Two terminals, because they are two services.

```
python -m hdi.seed          # once, or after changing a reference file
python -m hdi.api           # terminal 1: http://127.0.0.1:8000
```

```
cd web
npm install                 # once
npm run dev                 # terminal 2: http://localhost:3000
```

For a production build, `npm run build` then `npm run start`. The API reads
`HOST`, `PORT` and `ALLOWED_ORIGINS` from the environment; the front end reads
`NEXT_PUBLIC_API_URL`, which defaults to `http://127.0.0.1:8000`.

```
cd web
npm run lint          # ESLint
npm run typecheck     # tsc --noEmit
npm test              # unit tests
npm run build         # production build
npm run e2e           # end-to-end, against a running backend
```

The end-to-end suite drives a browser against the real API and the real
database; nothing is stubbed. Install its browser once with
`npx playwright install chromium`.

Structure, design tokens, environment variables, decisions and limitations:
[docs/FRONTEND.md](docs/FRONTEND.md). Deploying both services:
[docs/DEPLOY.md](docs/DEPLOY.md).

## Tests

```
python -m unittest tests.test_normalize tests.test_backend   # backend, ~1s
python -m unittest tests.test_recommend                      # /recommend, ~2s
python -m unittest discover -s tests                         # everything, ~20s
```

The full run loads the scispaCy NER model, so it is slower than the backend-only
run. The scikit-learn parity tests in `tests/test_classifier.py` skip cleanly if
`requirements-ml.txt` is not installed, since the API does not need it.

See [docs/PROJECT_SCOPE.md](docs/PROJECT_SCOPE.md) for curation rules and constraints
that apply to this project's data and any contributions.

## Data

The herb, drug, and interaction data in this repository is research-grade: it is
drawn and extracted from PubMed abstracts and drug labels and has **not** been
reviewed by a clinician. Every knowledge row reports `reviewed: false`, and
[docs/RECOMMEND_API.md](docs/RECOMMEND_API.md) lists what an expert must check
before any of it is used for real.

## Disclaimer

This project is for informational and research purposes only and is not medical
advice. Do not use it to make treatment decisions; consult a qualified healthcare
provider about any herb–drug interaction.
