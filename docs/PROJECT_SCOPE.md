# Project Rules

These rules apply to all contributions to this repository.

- Scope is frozen once `herbs.csv` and `drug_classes.csv` are written; do not add herbs
  or drug classes beyond what those files already define.
- Never edit `data/raw/raw_abstracts.json`; do all cleaning and transformation on a copy.
- Every interaction record must cite a PMID.
- Never mark auto-extracted rows as verified.
- Never commit `.env` or API keys.
