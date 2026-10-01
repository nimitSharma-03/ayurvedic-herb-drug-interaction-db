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

- `data/reference/` — curated reference tables (e.g. herbs, drug classes)
- `data/raw/` — raw, unmodified data pulled from external sources (e.g. PubMed abstracts)
- `data/processed/` — extraction output, curation sheet, verified interactions
- `scripts/` — data collection scripts
- `hdi/` — extraction, curation, and the backend data/API layer
- `docs/` — curation guide and backend API reference
- `tests/` — extraction and backend test suites
- `notes/` — working notes and curation logs
- `web/` — front-end for browsing the database (added later)

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

## Pipeline

| Stage | Command | Output |
|---|---|---|
| Harvest abstracts | `python scripts/collect_abstracts.py [--resume]` | `data/raw/raw_abstracts.json` |
| Extract candidates | `python -m hdi.extract` | `data/processed/candidates.json` |
| Build curation sheet | `python -m hdi.curate` | `data/processed/curation_sheet.csv` |
| Ingest verdicts | `python -m hdi.curate ingest` | `data/processed/verified_interactions.json` |
| Build query database | `python -m hdi.seed` | `data/processed/hdi.db` |
| Serve the API | `python -m hdi.api` | `http://127.0.0.1:8000` |

`python -m hdi.curate` (without `ingest`) overwrites the curation sheet and discards
recorded verdicts — see [docs/CURATION_GUIDE.md](docs/CURATION_GUIDE.md).

## Backend API

A read-only JSON API serves medicine information and interaction checks:

```
python -m hdi.seed          # build the query database from the curated files
python -m hdi.api           # serve on http://127.0.0.1:8000
```

```
GET /medicines/search?q=ashwagandha
GET /medicines/{id}
GET /medicines/{id}/interactions?category=allopathic
GET /interactions/check?medicine_a=Garlic&medicine_b=Warfarin
```

Interaction checks are order-independent and resolve aliases, and they
distinguish a documented interaction from "no documented interaction found in
the available sources" from "insufficient evidence" — the middle one is never
reported as safety. Fields this project has no source for are returned as null
rather than filled in.

Full reference: [docs/BACKEND_API.md](docs/BACKEND_API.md).

## Tests

```
python -m unittest tests.test_normalize tests.test_backend   # backend, ~1s
python -m unittest discover -s tests                         # everything, ~10s
```

The full run loads the scispaCy NER model, so it is slower than the backend-only run.

See [docs/PROJECT_SCOPE.md](docs/PROJECT_SCOPE.md) for curation rules and constraints
that apply to this project's data and any contributions.

## Data

The herb, drug, and interaction data in this repository is research-grade: it is
drawn and extracted from PubMed abstracts and has not been reviewed by a clinician.

## Disclaimer

This project is for informational and research purposes only and is not medical
advice. Do not use it to make treatment decisions; consult a qualified healthcare
provider about any herb–drug interaction.
