"""Medicine catalog: name resolution, search and detail projection.

Two different lookup modes live here, and keeping them apart matters:

  resolve_medicine()  exact match on a name or an explicitly declared alias.
                      Used by the interaction checker, where a wrong match
                      would attribute one substance's evidence to another.

  search_medicines()  ranked fuzzy-ish match (exact, then prefix, then
                      substring) for browse/typeahead. Never used to decide
                      which record an interaction query meant.

Every query is parameterized; user input never reaches SQL as text.
"""

from hdi import db
from hdi.normalize import normalize_name

# Columns exposed by the detail projection, in response order. Internal
# columns (normalized_name, pair_key, storage ordering) are deliberately left
# out of the public shape.
_DETAIL_FIELDS = (
    "id", "name", "category", "medicine_type", "generic_name", "scientific_name",
    "drug_class", "description", "evidence_level", "pregnancy_information",
    "breastfeeding_information",
)
_LIST_FIELDS = (
    "common_uses", "traditional_uses", "side_effects", "contraindications", "precautions",
)

# Fields a consumer is likely to render; reported as documented/undocumented so
# a NULL is never mistaken for a negative finding ("no known side effects").
_COMPLETENESS_FIELDS = (
    "description", "common_uses", "traditional_uses", "side_effects",
    "contraindications", "precautions", "pregnancy_information",
    "breastfeeding_information", "active_ingredients", "evidence_level",
)

_MATCH_EXACT_NAME = 0
_MATCH_EXACT_ALIAS = 1
_MATCH_PREFIX_NAME = 2
_MATCH_PREFIX_ALIAS = 3
_MATCH_SUBSTRING_NAME = 4
_MATCH_SUBSTRING_ALIAS = 5

_MATCH_LABELS = {
    _MATCH_EXACT_NAME: "exact_name",
    _MATCH_EXACT_ALIAS: "exact_alias",
    _MATCH_PREFIX_NAME: "name_prefix",
    _MATCH_PREFIX_ALIAS: "alias_prefix",
    _MATCH_SUBSTRING_NAME: "name_substring",
    _MATCH_SUBSTRING_ALIAS: "alias_substring",
}

CATEGORY_FILTERS = {
    "ayurvedic": ("ayurvedic", "herbal"),
    "herbal": ("ayurvedic", "herbal"),
    "allopathic": ("allopathic", "conventional"),
    "conventional": ("allopathic", "conventional"),
    "all": None,
}

MAX_SEARCH_LIMIT = 100
DEFAULT_SEARCH_LIMIT = 20

# Alias types that resolve an input but are never echoed back.
#
# Brand names are recorded so a user can type what is printed on their strip
# (data/reference/medicine_aliases.csv), but printing one would name a
# commercial product in a health answer, which docs/RECOMMEND_API.md forbids
# outright. Resolution and search still use them -- only the public projection
# drops them, so a brand query returns the medicine without the brand string.
PRIVATE_ALIAS_TYPES = ("brand_name",)


def _like_pattern(value, mode):
    """Build a LIKE pattern with user wildcards escaped.

    Without this, a query of "%" would match every row.
    """
    escaped = value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"{escaped}%" if mode == "prefix" else f"%{escaped}%"


def aliases_for(conn, medicine_id, include_private=False):
    """Public alias list for a medicine.

    Brand names are excluded unless explicitly asked for, so no response body
    carries one (see PRIVATE_ALIAS_TYPES). include_private exists for the
    resolver's own diagnostics and for tests, not for a route.
    """
    sql = (
        "SELECT alias, alias_type FROM medicine_aliases WHERE medicine_id = ?"
    )
    params = [medicine_id]
    if not include_private:
        sql += f" AND alias_type NOT IN ({', '.join('?' * len(PRIVATE_ALIAS_TYPES))})"
        params += list(PRIVATE_ALIAS_TYPES)
    sql += " ORDER BY alias_type, alias"
    return [
        {"alias": r["alias"], "alias_type": r["alias_type"]}
        for r in conn.execute(sql, params)
    ]


def resolve_medicine(conn, query):
    """Resolve a name or alias to exactly one medicine.

    Accepts a medicine id, a name, or a declared alias, in that precedence --
    ids are the stable handles this API hands out, so a caller must be able to
    feed one straight back in.

    Returns (medicine_id, error) where error is None on success,
    "empty_query", "medicine_not_found", or ("ambiguous", [ids]) when a single
    alias legitimately points at more than one substance. Similarity is never
    used here -- only ids, names and explicitly declared aliases resolve.
    """
    normalized = normalize_name(query)
    if not normalized:
        return None, "empty_query"

    row = conn.execute(
        "SELECT id FROM medicines WHERE id = ?", (str(query).strip().lower(),)
    ).fetchone()
    if row:
        return row["id"], None

    row = conn.execute(
        "SELECT id FROM medicines WHERE normalized_name = ?", (normalized,)
    ).fetchone()
    if row:
        return row["id"], None

    matches = [
        r["medicine_id"]
        for r in conn.execute(
            "SELECT DISTINCT medicine_id FROM medicine_aliases WHERE normalized_alias = ? "
            "ORDER BY medicine_id",
            (normalized,),
        )
    ]
    if len(matches) == 1:
        return matches[0], None
    if len(matches) > 1:
        return None, ("ambiguous", matches)
    return None, "medicine_not_found"


def resolve_drug_class(conn, query):
    """Resolve a lay or Hinglish class name to a drug class, or None.

    "blood thinner" and "sugar ki dawa" name a whole class rather than one
    medicine, so they cannot resolve through medicine_aliases. Tried only after
    resolve_medicine has failed, so a real medicine name is never downgraded to
    its class.
    """
    normalized = normalize_name(query)
    if not normalized:
        return None
    matches = [
        r["drug_class"]
        for r in conn.execute(
            "SELECT DISTINCT drug_class FROM class_aliases WHERE normalized_alias = ? "
            "ORDER BY drug_class",
            (normalized,),
        )
    ]
    if len(matches) == 1:
        return matches[0]
    row = conn.execute(
        "SELECT DISTINCT drug_class FROM medicines WHERE drug_class IS NOT NULL "
        "AND LOWER(drug_class) = ?",
        (normalized,),
    ).fetchone()
    return row["drug_class"] if row else None


def medicines_in_class(conn, drug_class):
    return [
        r["id"]
        for r in conn.execute(
            "SELECT id FROM medicines WHERE drug_class = ? ORDER BY name", (drug_class,)
        )
    ]


def search_medicines(conn, query, category="all", limit=DEFAULT_SEARCH_LIMIT):
    """Ranked search across name, generic name, active ingredient, scientific name and aliases.

    Ordering is by match quality first (exact before prefix before substring,
    name before alias), then alphabetically, so an exact hit is never buried
    under a longer substring match.

    Every field other than the medicine's own name is reached through
    medicine_aliases, where the seeder stores generic names, scientific names
    and active ingredients alongside synonyms. That keeps matching on the
    indexed, normalization-consistent `normalized_alias` column: comparing
    against a raw column instead would miss "Trigonella foenum-graecum" for a
    query of "trigonella foenum graecum", since normalization folds the hyphen
    to a space but the stored text keeps it.
    """
    normalized = normalize_name(query)
    if not normalized:
        return []

    categories = CATEGORY_FILTERS.get(category, None)
    best = {}

    def consider(medicine_id, rank, matched_on):
        current = best.get(medicine_id)
        if current is None or rank < current[0]:
            best[medicine_id] = (rank, matched_on)

    for row in conn.execute(
        "SELECT id FROM medicines WHERE normalized_name = ?", (normalized,)
    ):
        consider(row["id"], _MATCH_EXACT_NAME, "name")

    for row in conn.execute(
        "SELECT DISTINCT medicine_id FROM medicine_aliases WHERE normalized_alias = ?",
        (normalized,),
    ):
        consider(row["medicine_id"], _MATCH_EXACT_ALIAS, "alias")

    for mode, name_rank, alias_rank in (
        ("prefix", _MATCH_PREFIX_NAME, _MATCH_PREFIX_ALIAS),
        ("substring", _MATCH_SUBSTRING_NAME, _MATCH_SUBSTRING_ALIAS),
    ):
        pattern = _like_pattern(normalized, mode)
        for row in conn.execute(
            "SELECT id FROM medicines WHERE normalized_name LIKE ? ESCAPE '\\'", (pattern,)
        ):
            consider(row["id"], name_rank, "name")
        for row in conn.execute(
            "SELECT DISTINCT medicine_id FROM medicine_aliases "
            "WHERE normalized_alias LIKE ? ESCAPE '\\'",
            (pattern,),
        ):
            consider(row["medicine_id"], alias_rank, "alias")

    if not best:
        return []

    placeholders = ", ".join("?" * len(best))
    sql = (
        f"SELECT id, name, category, medicine_type, generic_name, scientific_name, "
        f"drug_class, evidence_level, source, source_url, last_verified "
        f"FROM medicines WHERE id IN ({placeholders})"
    )
    params = list(best)
    if categories:
        sql += f" AND category IN ({', '.join('?' * len(categories))})"
        params += list(categories)

    results = []
    for row in conn.execute(sql, params):
        rank, matched_on = best[row["id"]]
        results.append(
            {
                "id": row["id"],
                "name": row["name"],
                "category": row["category"],
                "medicine_type": row["medicine_type"],
                "generic_name": row["generic_name"],
                "scientific_name": row["scientific_name"],
                "drug_class": row["drug_class"],
                "evidence_level": row["evidence_level"],
                "matched_on": _MATCH_LABELS[rank],
                "_rank": rank,
            }
        )

    results.sort(key=lambda r: (r["_rank"], r["name"].lower()))
    for r in results:
        del r["_rank"]
    return results[: max(1, min(limit, MAX_SEARCH_LIMIT))]


def medicine_summary(conn, medicine_id):
    """Compact medicine shape, used when embedding one inside another response."""
    row = conn.execute(
        "SELECT id, name, category, medicine_type, generic_name, scientific_name, drug_class "
        "FROM medicines WHERE id = ?",
        (medicine_id,),
    ).fetchone()
    if row is None:
        return None
    return dict(row)


def medicine_detail(conn, medicine_id):
    """Full public projection for one medicine, or None when the id is unknown."""
    row = conn.execute("SELECT * FROM medicines WHERE id = ?", (medicine_id,)).fetchone()
    if row is None:
        return None

    detail = {field: row[field] for field in _DETAIL_FIELDS}
    detail["active_ingredients"] = db.json_list(row["active_ingredients"])
    for field in _LIST_FIELDS:
        detail[field] = db.json_list(row[field])
    detail["aliases"] = aliases_for(conn, medicine_id)

    detail["sources"] = [
        {
            "source": row["source"],
            "source_url": row["source_url"],
            "last_verified": row["last_verified"],
        }
    ]

    undocumented = []
    for field in _COMPLETENESS_FIELDS:
        value = detail.get(field)
        if value in (None, "", []):
            undocumented.append(field)
    detail["data_completeness"] = {
        "documented_fields": [f for f in _COMPLETENESS_FIELDS if f not in undocumented],
        "undocumented_fields": undocumented,
        # Spelled out because the difference is clinically important: an empty
        # contraindication list here means this project holds no sourced
        # contraindication data, not that the medicine has none.
        "note": (
            "Undocumented fields are absent from this project's sources. An empty value "
            "means no information was available, not a negative finding."
        ),
    }

    counts = conn.execute(
        "SELECT status, COUNT(*) AS n FROM interactions "
        "WHERE medicine_a_id = ? OR medicine_b_id = ? GROUP BY status",
        (medicine_id, medicine_id),
    )
    detail["interaction_summary"] = {r["status"]: r["n"] for r in counts}
    return detail


def list_medicines(conn, category="all", limit=MAX_SEARCH_LIMIT, offset=0):
    categories = CATEGORY_FILTERS.get(category, None)
    sql = (
        "SELECT id, name, category, medicine_type, generic_name, scientific_name, drug_class "
        "FROM medicines"
    )
    params = []
    if categories:
        sql += f" WHERE category IN ({', '.join('?' * len(categories))})"
        params += list(categories)
    sql += " ORDER BY name LIMIT ? OFFSET ?"
    params += [max(1, min(limit, MAX_SEARCH_LIMIT)), max(0, offset)]
    return [dict(r) for r in conn.execute(sql, params)]


def total_medicines(conn, category="all"):
    categories = CATEGORY_FILTERS.get(category, None)
    sql = "SELECT COUNT(*) AS n FROM medicines"
    params = []
    if categories:
        sql += f" WHERE category IN ({', '.join('?' * len(categories))})"
        params += list(categories)
    return conn.execute(sql, params).fetchone()["n"]
