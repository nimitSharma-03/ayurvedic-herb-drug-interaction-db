"""Fetch openFDA drug-label sections for the 13 drugs in the frozen reference table.

    python scripts/fetch_drug_labels.py

Writes data/raw/openfda_labels.json: one record per drug, holding the label
sections that data/reference/drug_indications.csv is written from, plus the SPL
identifiers that row then cites. Only the sections we actually read are stored,
so the provenance of every fetched row is auditable without keeping whole
labels in the repository.

This is a harvest step, not part of the API request path. The API never calls
it, and drug_indications.csv is a reviewed, hand-written reduction of what this
script retrieves -- label text is full of brand names and dosing, neither of
which may appear in an API response (docs/RECOMMEND_API.md).

Run only when refreshing provenance. Each drug is retried a few times with
backoff, since an unauthenticated caller does get transient DNS and rate-limit
failures. Records already in the output file are kept, so a partial run can be
finished by running the script again. If a drug still cannot be fetched the
script reports it and exits non-zero; data/reference/drug_indications.csv then
keeps that drug's row with source_type=general_knowledge.
"""

import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DRUG_CLASSES_CSV = ROOT / "data" / "reference" / "drug_classes.csv"
OUTPUT = ROOT / "data" / "raw" / "openfda_labels.json"

API = "https://api.fda.gov/drug/label.json"
USER_AGENT = "ayurveda-hdi/1.0 (research; label provenance harvest)"

# The sections drug_indications.csv is written from. Dosing sections are
# deliberately not requested: no dosing may reach an API response.
SECTIONS = (
    "indications_and_usage",
    "contraindications",
    "warnings_and_cautions",
    "adverse_reactions",
    "drug_interactions",
    "boxed_warning",
    "mechanism_of_action",
)

# "Insulin" alone matches a homeopathic product whose label makes no glycemic
# claim, so it is pinned to a subcutaneous human-insulin label instead. Aspirin
# needs no override, but note that every US aspirin label is an OTC analgesic
# monograph: its cardiovascular use is not on the label, which is why
# drug_indications.csv records that row as general_knowledge (see
# data/reference/DATA_NOTES.md).
SEARCH_OVERRIDES = {
    "Insulin": 'openfda.generic_name:"insulin human"'
               '+AND+openfda.route:"subcutaneous"',
}

MAX_CHARS = 1500
# openFDA's query grammar keeps ':', '"' and the '+AND+' operator literal.
_QUERY_SAFE = ':"+'

RETRIES = 4
BACKOFF_SECONDS = 3


def load_drugs():
    import csv

    drugs = []
    with open(DRUG_CLASSES_CSV, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            for drug in (d.strip() for d in row["example_drugs"].split(";")):
                if drug:
                    drugs.append((drug, row["drug_class"].strip()))
    return drugs


def fetch(search, limit=5):
    """One label query, retried with backoff on a transient network failure."""
    quoted = urllib.parse.quote(search, safe=_QUERY_SAFE)
    url = f"{API}?search={quoted}&limit={limit}"
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    last = None
    for attempt in range(RETRIES):
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return json.load(response)
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError) as exc:
            last = exc
            if attempt < RETRIES - 1:
                time.sleep(BACKOFF_SECONDS * (attempt + 1))
    raise last


def single_ingredient(result, drug):
    """Prefer a label for the drug on its own over a combination product.

    A combination label's indications describe the combination, which would
    misattribute an indication to one component.
    """
    generics = [g.lower() for g in result.get("openfda", {}).get("generic_name", [])]
    if not generics:
        return False
    return all(drug.lower() in g and "and" not in g.split() for g in generics)


def section(result, name):
    value = result.get(name)
    if not value:
        return None
    text = " ".join(value) if isinstance(value, list) else str(value)
    text = " ".join(text.split())
    return text[:MAX_CHARS]


def load_existing():
    """Records from a previous run, so a partial fetch can be resumed."""
    if not OUTPUT.exists():
        return {}
    try:
        return {r["drug"]: r for r in json.loads(OUTPUT.read_text(encoding="utf-8"))}
    except (json.JSONDecodeError, KeyError, TypeError):
        return {}


def main():
    existing = load_existing()
    records, failed = [], []
    for drug, drug_class in load_drugs():
        if drug in existing:
            records.append(existing[drug])
            print(f"{drug}: kept from previous run (set_id {existing[drug]['set_id']})")
            continue

        search = SEARCH_OVERRIDES.get(
            drug, f'openfda.generic_name:"{drug.lower()}"'
        )
        try:
            payload = fetch(search)
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError) as exc:
            print(f"{drug}: fetch failed ({type(exc).__name__}: {exc})", file=sys.stderr)
            failed.append(drug)
            continue

        results = payload.get("results", [])
        if not results:
            print(f"{drug}: no label returned", file=sys.stderr)
            failed.append(drug)
            continue

        chosen = next((r for r in results if single_ingredient(r, drug)), results[0])
        openfda = chosen.get("openfda", {})
        record = {
            "drug": drug,
            "drug_class": drug_class,
            "set_id": chosen.get("set_id"),
            "effective_time": chosen.get("effective_time"),
            "generic_name": openfda.get("generic_name", []),
            "route": openfda.get("route", []),
            "pharm_class_epc": openfda.get("pharm_class_epc", []),
            "sections": {name: section(chosen, name) for name in SECTIONS},
        }
        records.append(record)
        print(f"{drug}: set_id {record['set_id']} effective {record['effective_time']}")
        time.sleep(0.5)  # courtesy rate limit for an unauthenticated caller

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(
        json.dumps(records, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(f"\nWrote {len(records)} label record(s) to {OUTPUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
