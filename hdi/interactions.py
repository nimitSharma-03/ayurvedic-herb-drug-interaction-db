"""Interaction lookup: order-independent pair checks and per-medicine listings.

The four result states this module can return are deliberately distinct, and
the distinction is the reason this layer exists rather than a boolean:

  interaction_found          documented in our curated sources
  no_documented_interaction  we looked in our sources and found nothing
  insufficient_evidence      we have no adequate basis to answer
  medicine_not_found         at least one name did not resolve

The second is never phrased as safety. "No documented interaction was found in
the available sources" is a statement about our sources; "this combination is
safe" would be a clinical claim, and nothing in this project's evidence base
supports one. The third is never collapsed into the second.
"""

from hdi import db
from hdi.catalog import CATEGORY_FILTERS, medicine_summary, resolve_medicine
from hdi.normalize import pair_key

# Attached to every interaction response. This project reports what its curated
# literature sources record; it does not advise.
DISCLAIMER = (
    "This database reports interactions documented in curated PubMed literature. "
    "It is informational only, is not a substitute for professional medical advice, "
    "and does not provide diagnoses, dosages or treatment recommendations. "
    "Absence of a documented interaction is not evidence of safety."
)

# Why a pair we hold no row for is unanswerable rather than negative. The
# harvested corpus covers herb x drug pairs only, so herb+herb and drug+drug
# queries land here: structurally supported, with no evidence collected.
BASIS_NOT_IN_CORPUS = (
    "pair is outside the harvested literature corpus, which covers "
    "Ayurvedic-herb x conventional-drug pairs from the project's frozen reference tables"
)

_INTERACTION_FIELDS = (
    "id", "pair_kind", "status", "interaction_type", "severity", "severity_basis",
    "description", "mechanism", "clinical_significance", "recommended_action",
    "evidence_level", "evidence_basis", "source", "source_url", "last_verified",
)


def evidence_for(conn, interaction_id):
    """Citations backing an interaction, human-verified first.

    Every row carries a PMID (docs/PROJECT_SCOPE.md) and reports its own confidence, so an
    auto-extracted sentence can never be mistaken for a curated one.
    """
    rows = conn.execute(
        "SELECT pmid, trigger_matched, trigger_group, negated, confidence, verdict, "
        "       evidence_sentence, source_url "
        "FROM interaction_evidence WHERE interaction_id = ? "
        # 'human_verified' > 'auto_extracted' lexically, so DESC puts curated
        # evidence first.
        "ORDER BY confidence DESC, pmid, evidence_index",
        (interaction_id,),
    )
    return [
        {
            "pmid": r["pmid"],
            "trigger_matched": r["trigger_matched"] or None,
            "trigger_group": r["trigger_group"],
            "negated": bool(r["negated"]),
            "confidence": r["confidence"],
            "verdict": r["verdict"],
            "evidence_sentence": r["evidence_sentence"],
            "source_url": r["source_url"],
        }
        for r in rows
    ]


def _projection(row, conn, medicine_a_id, medicine_b_id, include_evidence=True):
    """Build the public interaction shape.

    medicine_a/medicine_b echo the order the *caller* asked in, not the
    canonical storage order, so a reversed query reads back the way it was
    posed while still hitting the single stored row.
    """
    result = {field: row[field] for field in _INTERACTION_FIELDS}
    result["medicine_a"] = medicine_summary(conn, medicine_a_id)
    result["medicine_b"] = medicine_summary(conn, medicine_b_id)
    result["interaction_found"] = row["status"] == db.STATUS_INTERACTION_FOUND
    if row["status"] == db.STATUS_INSUFFICIENT_EVIDENCE:
        # Neither true nor false: we cannot answer the question.
        result["interaction_found"] = None
    result["evidence"] = evidence_for(conn, row["id"]) if include_evidence else []
    result["disclaimer"] = DISCLAIMER
    return result


def check_pair(conn, query_a, query_b):
    """Check two medicines by name, alias or id, in either order.

    Returns (payload, error) where error is None on success. Errors are
    "empty_query", "identical_medicine", ("ambiguous", side, [ids]), or
    ("medicine_not_found", side, query) -- the side is reported so a caller can
    say which of the two inputs failed.
    """
    resolved = {}
    for side, query in (("medicine_a", query_a), ("medicine_b", query_b)):
        medicine_id, error = resolve_medicine(conn, query)
        if error == "empty_query":
            return None, ("empty_query", side, query)
        if error == "medicine_not_found":
            return None, ("medicine_not_found", side, query)
        if isinstance(error, tuple) and error[0] == "ambiguous":
            return None, ("ambiguous", side, error[1])
        resolved[side] = medicine_id

    a_id, b_id = resolved["medicine_a"], resolved["medicine_b"]
    if a_id == b_id:
        return None, ("identical_medicine", "medicine_b", b_id)

    row = conn.execute(
        "SELECT * FROM interactions WHERE pair_key = ?", (pair_key(a_id, b_id),)
    ).fetchone()
    if row is not None:
        return _projection(row, conn, a_id, b_id), None

    # No stored row: the pair was never part of the harvested corpus. That is
    # an absence of evidence, not evidence of absence.
    summary_a, summary_b = medicine_summary(conn, a_id), medicine_summary(conn, b_id)
    return {
        "id": None,
        "medicine_a": summary_a,
        "medicine_b": summary_b,
        "pair_kind": db.pair_kind(summary_a["category"], summary_b["category"]),
        "status": db.STATUS_INSUFFICIENT_EVIDENCE,
        "interaction_found": None,
        "interaction_type": None,
        "severity": db.SEVERITY_INSUFFICIENT,
        "severity_basis": None,
        "description": (
            f"No evidence has been collected for {summary_a['name']} and "
            f"{summary_b['name']}. The available sources are not sufficient to "
            f"determine whether an interaction exists."
        ),
        "mechanism": None,
        "clinical_significance": None,
        "recommended_action": None,
        "evidence_level": "insufficient",
        "evidence_basis": BASIS_NOT_IN_CORPUS,
        "source": None,
        "source_url": None,
        "last_verified": None,
        "evidence": [],
        "disclaimer": DISCLAIMER,
    }, None


def interactions_for_medicine(
    conn, medicine_id, category="all", status=None, include_evidence=False,
    limit=None, offset=0,
):
    """Every stored interaction involving one medicine.

    `category` filters the *other* side of the pair, which is what answers
    "what conventional medicines interact with Ashwagandha?" and its mirror
    "what herbs have documented interactions with Warfarin?".
    """
    if medicine_summary(conn, medicine_id) is None:
        return None

    categories = CATEGORY_FILTERS.get(category, None)
    sql = (
        "SELECT i.*, "
        "       CASE WHEN i.medicine_a_id = ? THEN i.medicine_b_id ELSE i.medicine_a_id END "
        "         AS other_id "
        "FROM interactions i "
        "WHERE (i.medicine_a_id = ? OR i.medicine_b_id = ?)"
    )
    params = [medicine_id, medicine_id, medicine_id]

    if categories:
        sql += (
            " AND EXISTS (SELECT 1 FROM medicines m WHERE m.id = "
            "   CASE WHEN i.medicine_a_id = ? THEN i.medicine_b_id ELSE i.medicine_a_id END"
            f"   AND m.category IN ({', '.join('?' * len(categories))}))"
        )
        params.append(medicine_id)
        params += list(categories)

    if status:
        sql += " AND i.status = ?"
        params.append(status)

    # Documented interactions first, then by severity band, so a caller reading
    # a truncated list sees the consequential rows.
    sql += (
        " ORDER BY CASE i.status WHEN 'interaction_found' THEN 0 "
        "                       WHEN 'insufficient_evidence' THEN 1 ELSE 2 END, "
        "          CASE i.severity WHEN 'major' THEN 0 WHEN 'moderate' THEN 1 "
        "                          WHEN 'minor' THEN 2 ELSE 3 END, i.id"
    )
    if limit is not None:
        sql += " LIMIT ? OFFSET ?"
        params += [limit, max(0, offset)]

    results = []
    for row in conn.execute(sql, params):
        other = row["other_id"]
        results.append(_projection(row, conn, medicine_id, other, include_evidence))
    return results


def interaction_counts(conn, medicine_id):
    return {
        r["status"]: r["n"]
        for r in conn.execute(
            "SELECT status, COUNT(*) AS n FROM interactions "
            "WHERE medicine_a_id = ? OR medicine_b_id = ? GROUP BY status",
            (medicine_id, medicine_id),
        )
    }


def documented_interactions(conn, pair_kind=None, limit=None):
    """All pairs with a documented interaction, optionally filtered by pair kind."""
    sql = "SELECT * FROM interactions WHERE status = ?"
    params = [db.STATUS_INTERACTION_FOUND]
    if pair_kind:
        sql += " AND pair_kind = ?"
        params.append(pair_kind)
    sql += (
        " ORDER BY CASE severity WHEN 'major' THEN 0 WHEN 'moderate' THEN 1 "
        "                        WHEN 'minor' THEN 2 ELSE 3 END, id"
    )
    if limit is not None:
        sql += " LIMIT ?"
        params.append(limit)
    return [
        _projection(row, conn, row["medicine_a_id"], row["medicine_b_id"], include_evidence=True)
        for row in conn.execute(sql, params)
    ]
