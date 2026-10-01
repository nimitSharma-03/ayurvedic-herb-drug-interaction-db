"""Collect PubMed abstracts for herb-drug pairs via NCBI Entrez (Biopython).

Builds a herb x drug search grid from data/reference/herbs.csv and
data/reference/drug_classes.csv, queries PubMed for each pair, and saves
title/abstract records for manual curation downstream.

Do not edit data/raw/raw_abstracts.json by hand once it exists (see docs/PROJECT_SCOPE.md);
all cleaning happens on a copy.
"""

import argparse
import csv
import json
import os
import socket
import sys
import time
from contextlib import contextmanager
from pathlib import Path

import certifi

os.environ.setdefault("SSL_CERT_FILE", certifi.where())

from Bio import Entrez
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
HERBS_CSV = ROOT / "data" / "reference" / "herbs.csv"
DRUG_CLASSES_CSV = ROOT / "data" / "reference" / "drug_classes.csv"
OUTPUT_PATH = ROOT / "data" / "raw" / "raw_abstracts.json"
PROGRESS_PATH = ROOT / "data" / "raw" / "raw_abstracts.progress.json"

MIN_SYNONYM_LENGTH = 5
MAX_PMIDS_PER_PAIR = 50
MAX_RETRIES = 3
INITIAL_BACKOFF_SECONDS = 2
ENTREZ_TIMEOUT_SECONDS = 15


@contextmanager
def entrez_timeout():
    """Bound every socket operation Entrez performs so a call can never hang forever.

    Bio.Entrez.esearch/efetch forward unknown keywords straight into the NCBI
    query string, so passing timeout= to them would not set a real timeout --
    it has to be applied via the socket default instead.
    """
    previous = socket.getdefaulttimeout()
    socket.setdefaulttimeout(ENTREZ_TIMEOUT_SECONDS)
    try:
        yield
    finally:
        socket.setdefaulttimeout(previous)


def load_herbs(path):
    herbs = []
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            botanical_name = row["botanical_name"].strip()
            synonyms_raw = row.get("synonyms", "") or ""
            synonyms = [s.strip() for s in synonyms_raw.split(";") if s.strip()]
            reliable_synonyms = [s for s in synonyms if len(s) >= MIN_SYNONYM_LENGTH]
            search_terms = [botanical_name] + reliable_synonyms
            herbs.append(
                {
                    "herb_name": row["herb_name"].strip(),
                    "botanical_name": botanical_name,
                    "search_terms": search_terms,
                }
            )
    return herbs


def load_drug_classes(path):
    pairs = []
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            drug_class = row["drug_class"].strip()
            drugs_raw = row.get("example_drugs", "") or ""
            drugs = [d.strip() for d in drugs_raw.split(";") if d.strip()]
            for drug in drugs:
                pairs.append({"drug_name": drug, "drug_class": drug_class})
    return pairs


def build_query(herb_terms, drug_name):
    herb_clause = " OR ".join(f'"{term}"[Title/Abstract]' for term in herb_terms)
    drug_clause = f'"{drug_name}"[Title/Abstract]'
    return f"({herb_clause}) AND ({drug_clause})"


def with_retries(fn, description):
    backoff = INITIAL_BACKOFF_SECONDS
    last_error = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            return fn()
        except Exception as exc:
            last_error = exc
            if attempt == MAX_RETRIES:
                break
            print(
                f"    ! {description} failed (attempt {attempt}/{MAX_RETRIES}): {exc}"
                f" -- retrying in {backoff}s"
            )
            time.sleep(backoff)
            backoff *= 2
    raise RuntimeError(f"{description} failed after {MAX_RETRIES} attempts") from last_error


def esearch_pmids(query, min_interval):
    def _do():
        with entrez_timeout():
            handle = Entrez.esearch(db="pubmed", term=query, retmax=MAX_PMIDS_PER_PAIR)
            try:
                record = Entrez.read(handle)
            finally:
                handle.close()
        return record.get("IdList", [])

    pmids = with_retries(_do, f"esearch({query!r})")
    time.sleep(min_interval)
    return pmids


def efetch_records(pmids, min_interval):
    if not pmids:
        return {}

    def _do():
        with entrez_timeout():
            handle = Entrez.efetch(
                db="pubmed", id=",".join(pmids), rettype="abstract", retmode="xml"
            )
            try:
                records = Entrez.read(handle)
            finally:
                handle.close()
        return records

    records = with_retries(_do, f"efetch({len(pmids)} pmids)")
    time.sleep(min_interval)

    results = {}
    for article in records.get("PubmedArticle", []):
        try:
            pmid = str(article["MedlineCitation"]["PMID"])
            medline_article = article["MedlineCitation"]["Article"]
            title = str(medline_article.get("ArticleTitle", ""))
            abstract_parts = medline_article.get("Abstract", {}).get("AbstractText", [])
            abstract = " ".join(str(part) for part in abstract_parts)
        except (KeyError, IndexError):
            continue
        results[pmid] = {"title": title, "abstract": abstract}
    return results


def pair_key(herb, drug):
    return (herb["herb_name"], drug["drug_name"])


def load_existing_records(path):
    if not path.exists():
        return []
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def load_progress(path):
    if not path.exists():
        return {"completed_pairs": [], "zero_result_pairs": []}
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def save_progress(path, completed_pairs, zero_result_pairs):
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "completed_pairs": [list(pair) for pair in completed_pairs],
        "zero_result_pairs": [list(pair) for pair in zero_result_pairs],
    }
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)


def save_records(path, all_records):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(all_records, f, indent=2, ensure_ascii=False)


def collect_pair(herb, drug, min_interval):
    query = build_query(herb["search_terms"], drug["drug_name"])
    print(f'  Searching: {herb["herb_name"]} + {drug["drug_name"]} ... ', end="", flush=True)

    pmids = esearch_pmids(query, min_interval)
    print(f"{len(pmids)} PMIDs found")

    if not pmids:
        return [], query

    fetched = efetch_records(pmids, min_interval)

    records = []
    seen_pmids = set()
    for pmid in pmids:
        if pmid in seen_pmids:
            continue
        info = fetched.get(pmid)
        if info is None:
            continue
        seen_pmids.add(pmid)
        records.append(
            {
                "herb_name": herb["herb_name"],
                "drug_name": drug["drug_name"],
                "drug_class": drug["drug_class"],
                "pmid": pmid,
                "title": info["title"],
                "abstract": info["abstract"],
                "query_used": query,
            }
        )
    return records, query


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--test",
        action="store_true",
        help="Run only the first 3 herb-drug pairs and print results instead of saving.",
    )
    parser.add_argument(
        "--resume",
        action="store_true",
        help=(
            "Skip herb-drug pairs already completed in a previous run (tracked in "
            "raw_abstracts.json and raw_abstracts.progress.json) and continue from "
            "where it left off."
        ),
    )
    args = parser.parse_args()

    load_dotenv(ROOT / ".env")
    email = os.environ.get("NCBI_EMAIL", "").strip()
    api_key = os.environ.get("NCBI_API_KEY", "").strip()

    if not email:
        print("ERROR: NCBI_EMAIL is not set in .env", file=sys.stderr)
        sys.exit(1)

    Entrez.email = email
    if api_key:
        Entrez.api_key = api_key
        min_interval = 1 / 10
        print("Using NCBI API key: rate limit 10 req/s")
    else:
        min_interval = 1 / 3
        print("No NCBI API key: rate limit 3 req/s")

    herbs = load_herbs(HERBS_CSV)
    drugs = load_drug_classes(DRUG_CLASSES_CSV)

    all_pairs = [(herb, drug) for herb in herbs for drug in drugs]
    print(f"Total herb-drug pairs: {len(all_pairs)}")

    all_records = []
    completed_pairs = set()
    zero_result_pairs = []

    if args.resume:
        all_records = load_existing_records(OUTPUT_PATH)
        progress = load_progress(PROGRESS_PATH)
        completed_pairs.update(tuple(pair) for pair in progress["completed_pairs"])
        zero_result_pairs = [tuple(pair) for pair in progress["zero_result_pairs"]]
        # Fall back to whatever raw_abstracts.json already has, in case the
        # progress file is missing but a prior (non-resumed) run left records.
        completed_pairs.update((r["herb_name"], r["drug_name"]) for r in all_records)

        pairs = [(h, d) for h, d in all_pairs if pair_key(h, d) not in completed_pairs]
        print(
            f"--resume: {len(completed_pairs)} pairs already completed, "
            f"{len(pairs)} remaining"
        )
    else:
        pairs = all_pairs

    if args.test:
        pairs = pairs[:3]
        print(f"--test: running only the first {len(pairs)} pairs\n")

    for i, (herb, drug) in enumerate(pairs, start=1):
        print(f"[{i}/{len(pairs)}]", end=" ")
        try:
            records, query = collect_pair(herb, drug, min_interval)
        except RuntimeError as exc:
            print(f"    ! Giving up on this pair: {exc}")
            # Not marked completed: a future --resume run will retry it.
            continue

        key = pair_key(herb, drug)
        if not records:
            zero_result_pairs.append((herb["herb_name"], drug["drug_name"], drug["drug_class"]))
        all_records.extend(records)
        completed_pairs.add(key)

        if not args.test:
            save_records(OUTPUT_PATH, all_records)
            save_progress(PROGRESS_PATH, completed_pairs, zero_result_pairs)

    print("\n--- Summary ---")
    print(f"Pairs searched this run: {len(pairs)}")
    print(f"Total records collected: {len(all_records)}")
    print(f"Total pairs with zero results: {len(zero_result_pairs)}")
    if zero_result_pairs:
        print("Zero-result pairs:")
        for herb_name, drug_name, drug_class in zero_result_pairs:
            print(f"  - {herb_name} + {drug_name} ({drug_class})")

    if args.test:
        print("\n--- Records (test mode, not saved) ---")
        print(json.dumps(all_records, indent=2, ensure_ascii=False))
        return

    print(f"\nSaved {len(all_records)} records to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
