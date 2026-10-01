"""Medicine name normalization and identifier slugging.

Normalization is deliberately conservative: it folds case, unicode accents,
punctuation and whitespace, and nothing else. It never stems, never strips
plurals, and never collapses two names because they merely look similar --
"Amla" and "Bhumi Amla" are different plants, and "Black pepper" and "False
Black Pepper" are different reference rows.

Cross-name identity is therefore expressed only through explicit alias rows
(see hdi.seed), never inferred here. hdi.matching's stem fallback exists for
free-text abstract mining, where a missed mention costs recall; it is
deliberately NOT reused for medicine resolution, where a wrong merge would
attribute one substance's interaction evidence to another.
"""

import re
import unicodedata

_NON_ALNUM_RE = re.compile(r"[^a-z0-9]+")
_SLUG_TRIM_RE = re.compile(r"(^-+|-+$)")


def normalize_name(value):
    """Fold a medicine name to its comparison key.

    Lowercases, strips accents, and reduces any run of non-alphanumeric
    characters to a single space:

        "Paracetamol" / "paracetamol" / "  PARACETAMOL " -> "paracetamol"
        "Trigonella foenum-graecum"                      -> "trigonella foenum graecum"

    Returns "" for input that holds no alphanumeric characters at all, which
    callers treat as an empty query rather than as a lookup miss.
    """
    if value is None:
        return ""
    decomposed = unicodedata.normalize("NFKD", str(value).lower())
    stripped = "".join(ch for ch in decomposed if not unicodedata.combining(ch))
    return _NON_ALNUM_RE.sub(" ", stripped).strip()


def slugify(value):
    """Hyphenated, URL-safe form of a name, used to build stable medicine ids."""
    return _SLUG_TRIM_RE.sub("", _NON_ALNUM_RE.sub("-", normalize_name(value)))


def medicine_id(medicine_type, name):
    """Stable public id for a medicine, e.g. "herb-ashwagandha", "drug-warfarin".

    Derived from the frozen reference tables, so re-running the seed against
    unchanged reference data always reproduces the same ids.
    """
    return f"{slugify(medicine_type)}-{slugify(name)}"


def pair_key(medicine_a_id, medicine_b_id):
    """Order-independent key for a medicine pair.

    Sorting the two ids means "Ashwagandha + Warfarin" and
    "Warfarin + Ashwagandha" produce one identical key, which is what lets a
    UNIQUE constraint on this column make reversed duplicate interaction rows
    impossible to insert (see hdi/schema.sql).
    """
    return "|".join(sorted([medicine_a_id, medicine_b_id]))
