"""SQLite connection handling and the shared evidence vocabulary.

Storage note: the project's authoritative data stays in CSV/JSON (that is a
deliberate design choice recorded in notes/reference_systems_review.md). This
module owns a derived read model in SQLite instead of querying those files
directly, for two reasons the API needs: real indexes on the fields searches
hit, and parameterized queries, so no user-supplied string is ever
concatenated into SQL.
"""

import json
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = ROOT / "data" / "processed" / "hdi.db"
SCHEMA_PATH = Path(__file__).resolve().parent / "schema.sql"

# Result states for an interaction lookup.
#
# The distinction between the last three is the whole point of this layer:
# "we looked and found nothing" is not "this combination is safe", and
# "we have no information" is not "we found nothing".
STATUS_INTERACTION_FOUND = "interaction_found"
STATUS_NO_DOCUMENTED_INTERACTION = "no_documented_interaction"
STATUS_INSUFFICIENT_EVIDENCE = "insufficient_evidence"
STATUS_MEDICINE_NOT_FOUND = "medicine_not_found"

SEVERITY_MAJOR = "major"
SEVERITY_MODERATE = "moderate"
SEVERITY_MINOR = "minor"
SEVERITY_NONE_DOCUMENTED = "none_documented"
SEVERITY_INSUFFICIENT = "insufficient_evidence"

EVIDENCE_LEVELS = ("strong", "moderate", "limited", "traditional", "insufficient")

# Maps the project's own curated trigger-group taxonomy onto a severity band.
#
# This is a derivation, not a clinical severity rating: the groups already
# carry an explicit severity ordering in this repo (hdi.curate.SEVERITY_ORDER,
# documented in docs/CURATION_GUIDE.md as "trigger severity, most severe
# first"), and the four groups treated as clinically actionable there
# (hdi.curate.PRIORITY_SEVERITIES) are the ones banded above 'minor' here.
# Every row records severity_basis so a consumer can see it was derived this
# way rather than read off a pharmacopoeia.
TRIGGER_GROUP_SEVERITY = {
    "contraindication": SEVERITY_MAJOR,
    "antagonism": SEVERITY_MODERATE,
    "risk_increase": SEVERITY_MODERATE,
    "pharmacokinetic": SEVERITY_MODERATE,
    "potentiation": SEVERITY_MINOR,
    "general_interaction": SEVERITY_MINOR,
}

_SEVERITY_RANK = {SEVERITY_MAJOR: 0, SEVERITY_MODERATE: 1, SEVERITY_MINOR: 2}

SEVERITY_BASIS_DERIVED = "derived_from_curated_trigger_group"

# A curator-confirmed finding rests on primary-literature abstracts, which is
# 'limited' evidence -- not a systematic review. Independent corroboration
# across several abstracts raises it to 'moderate'. Nothing in this project
# supports 'strong'.
MULTI_SOURCE_PMID_THRESHOLD = 3


AYURVEDIC_CATEGORIES = ("ayurvedic", "herbal")
ALLOPATHIC_CATEGORIES = ("allopathic", "conventional")


def pair_kind(category_a, category_b):
    """Classify a medicine pair as ayurvedic/allopathic in either combination."""
    a_herb = category_a in AYURVEDIC_CATEGORIES
    b_herb = category_b in AYURVEDIC_CATEGORIES
    if a_herb and b_herb:
        return "ayurvedic_ayurvedic"
    if a_herb or b_herb:
        return "ayurvedic_allopathic"
    return "allopathic_allopathic"


def most_severe(severities):
    """Highest-severity band among the given values, or None if there are none."""
    ranked = [s for s in severities if s in _SEVERITY_RANK]
    if not ranked:
        return None
    return min(ranked, key=lambda s: _SEVERITY_RANK[s])


def pubmed_url(pmid):
    """Canonical PubMed resolver URL for a PMID already present in our corpus.

    Constructed from the identifier, not looked up or guessed: every PMID here
    came back from a live NCBI E-utilities query in
    scripts/collect_abstracts.py.
    """
    return f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/"


def connect(db_path=DB_PATH, read_only=False):
    """Open a connection with row access by name and foreign keys enforced."""
    db_path = Path(db_path)
    if read_only:
        if not db_path.exists():
            raise FileNotFoundError(
                f"{db_path} does not exist; build it with `python -m hdi.seed`"
            )
        conn = sqlite3.connect(f"file:{db_path.as_posix()}?mode=ro", uri=True)
    else:
        db_path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def apply_schema(conn):
    conn.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
    conn.commit()


def json_list(value):
    """Decode a JSON-array column into a list, mapping NULL to []."""
    if not value:
        return []
    decoded = json.loads(value)
    return decoded if isinstance(decoded, list) else [decoded]


def dump_list(values):
    """Encode a list for storage, storing NULL rather than '[]' when empty.

    Keeping "not documented" as NULL rather than an empty array means the
    absence is visible in the database itself, not just in the API layer.
    """
    return json.dumps(list(values), ensure_ascii=False) if values else None
