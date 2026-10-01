"""Real counts for the pipeline, the scope and the classifier.

Everything `GET /stats` serves is counted, here and now, from two places:

  the read model          data/processed/hdi.db, built by hdi.seed
  the repo's own files    data/raw/raw_abstracts.json, data/processed/candidates.json,
                          ml/reports/metrics.json

Nothing is written down twice. A number in this module is either a `COUNT(*)`
or the length of a list in a file on disk, so it cannot drift away from the
data it describes the way a hardcoded figure would. A front end displaying
"520 pairs searched" is displaying the 520 rows that exist.

The classifier block is read straight out of `ml/reports/metrics.json`, which
`ml/evaluate.py` writes in the same pass as `eval.md`. This module does not
re-derive a score, and it does not parse the prose report. When the file is
absent -- a checkout that has not run the evaluation -- `classifier` is null and
`classifier_note` says why, which is a different answer from a zero.

The two raw files are a few megabytes between them, so they are parsed once and
cached against their (size, mtime). Re-seeding or re-harvesting invalidates the
cache by changing the mtime.
"""

import json

from hdi import db

ABSTRACTS_PATH = db.ROOT / "data" / "raw" / "raw_abstracts.json"
CANDIDATES_PATH = db.ROOT / "data" / "processed" / "candidates.json"
VERIFIED_PATH = db.ROOT / "data" / "processed" / "verified_interactions.json"
METRICS_PATH = db.ROOT / "ml" / "reports" / "metrics.json"

CLASSIFIER_MISSING_NOTE = (
    "Classifier metrics have not been generated in this checkout. Run "
    "`python ml/evaluate.py` to write ml/reports/metrics.json."
)

# Why each 'no documented interaction' row reads the way it does. The seeder
# writes one of these strings into interactions.evidence_basis; naming them here
# lets /stats report the breakdown without a consumer having to match on prose.
BASIS_SCREENED = "abstracts_screened_no_interaction_language_found"
BASIS_NO_ABSTRACTS = "pubmed_search_returned_no_abstracts"
BASIS_REJECTED = "curator_reviewed_and_rejected_candidate_evidence"
BASIS_UNCLEAR = "curator_reviewed_and_marked_unclear"

_cache = {}


def _load_json_list(path):
    """Parse a JSON list from disk, cached against the file's size and mtime.

    Returns None when the file is absent, which callers report as absent rather
    than as zero: this project has no source for the difference being hidden.
    """
    try:
        stat = path.stat()
    except OSError:
        return None
    key = (str(path), stat.st_size, stat.st_mtime_ns)
    cached = _cache.get(str(path))
    if cached is not None and cached[0] == key:
        return cached[1]
    with open(path, encoding="utf-8") as handle:
        data = json.load(handle)
    _cache[str(path)] = (key, data)
    return data


def _counts(conn, sql, params=()):
    return {row[0]: row[1] for row in conn.execute(sql, params)}


def _scalar(conn, sql, params=()):
    return conn.execute(sql, params).fetchone()[0]


def literature(conn):
    """What the literature pipeline actually searched, read and kept.

    `pairs_searched` is the size of the harvested corpus -- one row per
    herb x drug pair the search covered -- not a count of pairs that returned
    something. `pairs_with_no_abstracts` says how many of them came back empty,
    and that is the honest shape of this stage.
    """
    abstracts = _load_json_list(ABSTRACTS_PATH)
    candidates = _load_json_list(CANDIDATES_PATH)
    verified = _load_json_list(VERIFIED_PATH)
    basis = _counts(
        conn,
        "SELECT evidence_basis, COUNT(*) FROM interactions "
        "WHERE evidence_basis IS NOT NULL GROUP BY evidence_basis",
    )
    verdicts = _counts(
        conn, "SELECT verdict, COUNT(*) FROM interaction_evidence GROUP BY verdict"
    )
    statuses = _counts(conn, "SELECT status, COUNT(*) FROM interactions GROUP BY status")

    return {
        "pairs_searched": _scalar(conn, "SELECT COUNT(*) FROM interactions"),
        "abstracts_harvested": None if abstracts is None else len(abstracts),
        "distinct_pmids_harvested": (
            None if abstracts is None else len({row["pmid"] for row in abstracts})
        ),
        "candidate_sentences": None if candidates is None else len(candidates),
        "evidence_rows": _scalar(conn, "SELECT COUNT(*) FROM interaction_evidence"),
        "verdicts": {
            "confirmed": verdicts.get("confirmed", 0),
            "rejected": verdicts.get("rejected", 0),
            "unclear": verdicts.get("unclear", 0),
        },
        "documented_pairs": statuses.get(db.STATUS_INTERACTION_FOUND, 0),
        "verified_interaction_records": None if verified is None else len(verified),
        "result_states": {
            db.STATUS_INTERACTION_FOUND: statuses.get(db.STATUS_INTERACTION_FOUND, 0),
            db.STATUS_NO_DOCUMENTED_INTERACTION: statuses.get(
                db.STATUS_NO_DOCUMENTED_INTERACTION, 0
            ),
            db.STATUS_INSUFFICIENT_EVIDENCE: statuses.get(
                db.STATUS_INSUFFICIENT_EVIDENCE, 0
            ),
        },
        "no_finding_basis": {
            "abstracts_screened_nothing_found": basis.get(BASIS_SCREENED, 0),
            "search_returned_no_abstracts": basis.get(BASIS_NO_ABSTRACTS, 0),
            "curator_rejected_the_candidates": basis.get(BASIS_REJECTED, 0),
            "curator_marked_it_unclear": basis.get(BASIS_UNCLEAR, 0),
        },
        "distinct_pmids_cited": _scalar(
            conn, "SELECT COUNT(DISTINCT pmid) FROM interaction_evidence"
        ),
    }


def scope(conn):
    """The frozen reference scope, counted from the rows it produced."""
    by_type = _counts(
        conn, "SELECT medicine_type, COUNT(*) FROM medicines GROUP BY medicine_type"
    )
    classes = [
        {"drug_class": row[0], "drugs": row[1]}
        for row in conn.execute(
            "SELECT drug_class, COUNT(*) FROM medicines "
            "WHERE drug_class IS NOT NULL GROUP BY drug_class ORDER BY drug_class"
        )
    ]
    return {
        "medicines": _scalar(conn, "SELECT COUNT(*) FROM medicines"),
        "herbs": by_type.get("herb", 0),
        "drugs": by_type.get("drug", 0),
        "drug_classes": len(classes),
        "drug_classes_detail": classes,
        "conditions": _scalar(conn, "SELECT COUNT(*) FROM conditions"),
        "condition_synonyms": _scalar(conn, "SELECT COUNT(*) FROM condition_synonyms"),
        "aliases": _scalar(conn, "SELECT COUNT(*) FROM medicine_aliases"),
        "class_aliases": _scalar(conn, "SELECT COUNT(*) FROM class_aliases"),
    }


def knowledge(conn):
    """The use rows behind every option, grouped by where each one came from."""
    by_source = _counts(
        conn, "SELECT source_type, COUNT(*) FROM medicine_uses GROUP BY source_type"
    )
    by_kind = _counts(
        conn, "SELECT use_kind, COUNT(*) FROM medicine_uses GROUP BY use_kind"
    )
    by_evidence = _counts(
        conn,
        "SELECT evidence_level, COUNT(*) FROM medicine_uses GROUP BY evidence_level",
    )
    return {
        "rows": _scalar(conn, "SELECT COUNT(*) FROM medicine_uses"),
        "by_source_type": [
            {"source_type": source_type, "rows": by_source[source_type]}
            for source_type in sorted(by_source)
        ],
        "by_use_kind": [
            {"use_kind": kind, "rows": by_kind[kind]} for kind in sorted(by_kind)
        ],
        "by_evidence_level": [
            {"evidence_level": level, "rows": by_evidence[level]}
            for level in sorted(by_evidence)
        ],
        # A CHECK constraint makes a reviewed row impossible to insert, so this
        # is zero by construction. It is reported anyway: a consumer should be
        # able to read the number rather than take the claim on trust.
        "reviewed_rows": _scalar(
            conn, "SELECT COUNT(*) FROM medicine_uses WHERE reviewed = 1"
        ),
        "combination_rules": _scalar(conn, "SELECT COUNT(*) FROM combination_rules"),
        "tags": _scalar(conn, "SELECT COUNT(*) FROM tag_vocabulary"),
        "health_topic_rows": _scalar(conn, "SELECT COUNT(*) FROM health_topic_map"),
    }


def classifier():
    """The scores ml/evaluate.py measured, or None when it has not been run."""
    return _load_json_list(METRICS_PATH)


def stats(conn):
    """Everything above, in one response.

    `database` echoes hdi.seed's own metadata, so a consumer can see when the
    read model was built and which reference files were current when it was.
    """
    metrics = classifier()
    return {
        "literature": literature(conn),
        "scope": scope(conn),
        "knowledge": knowledge(conn),
        "classifier": metrics,
        "classifier_note": None if metrics else CLASSIFIER_MISSING_NOTE,
        "database": {
            row["key"]: row["value"]
            for row in conn.execute("SELECT key, value FROM seed_metadata")
        },
        "note": (
            "Every count here is read from this repository's own files and from the "
            "database hdi.seed builds from them. Nothing has been reviewed by a "
            "clinician, and the classifier was measured on synthetic text."
        ),
    }
