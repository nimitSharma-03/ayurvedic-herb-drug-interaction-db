"""Read access to the condition, use and combination-rule tables.

This is the data layer the recommendation service sits on. It holds queries and
projections only: no scoring, no ranking, no clinical judgement. Every function
is a parameterized database read, so the request path stays what
docs/BACKEND_API.md says it is.

Three things live here that the rest of the service depends on:

  conditions and their lay wordings    what "in scope" means, derived from the
                                       frozen reference tables
  medicine_uses projections            an option as a response renders it, with
                                       its provenance attached
  combination rules                    the tag pairs behind a mechanism-based
                                       caution

The option projection deliberately carries `source_type` and `reviewed` out to
the caller. Every row is unreviewed, and a consumer that cannot see that would
have no way to tell this data from clinically vetted content.
"""

from hdi import db

# Returned with every option so a consumer never has to infer provenance.
EVIDENCE_LEVELS = ("traditional", "preclinical", "clinical")

_USE_FIELDS = (
    "use_kind", "evidence_level", "pros", "cons", "cautions",
    "source_type", "source_note",
)


def has_knowledge_data(conn):
    """Whether the knowledge layer was seeded at all.

    Checked before the service claims a condition is unsupported: an empty table
    means the build is incomplete, which is a different answer from "we looked
    and this condition is out of scope".
    """
    return conn.execute("SELECT COUNT(*) AS n FROM conditions").fetchone()["n"] > 0


def list_conditions(conn):
    """Every supported condition, in reference-file order."""
    return [
        {
            "condition_id": r["condition_id"],
            "name": r["name"],
            "drug_classes": db.json_list(r["drug_classes"]),
        }
        for r in conn.execute(
            "SELECT condition_id, name, drug_classes FROM conditions ORDER BY rowid"
        )
    ]


def condition_ids(conn):
    return [
        r["condition_id"]
        for r in conn.execute("SELECT condition_id FROM conditions ORDER BY rowid")
    ]


def condition(conn, condition_id):
    row = conn.execute(
        "SELECT condition_id, name, drug_classes FROM conditions WHERE condition_id = ?",
        (condition_id,),
    ).fetchone()
    if row is None:
        return None
    return {
        "condition_id": row["condition_id"],
        "name": row["name"],
        "drug_classes": db.json_list(row["drug_classes"]),
    }


def tags_for(conn, medicine_id):
    """Pharmacological tags for one medicine, as a set.

    The union across every recorded use of that medicine: a tag describes the
    substance, not the use it was written beside.
    """
    return {
        r["tag"]
        for r in conn.execute(
            "SELECT tag FROM medicine_tags WHERE medicine_id = ?", (medicine_id,)
        )
    }


def tags_for_many(conn, medicine_ids):
    """tags_for over several medicines in one query."""
    ids = list(medicine_ids)
    if not ids:
        return {}
    placeholders = ", ".join("?" * len(ids))
    result = {mid: set() for mid in ids}
    for row in conn.execute(
        f"SELECT medicine_id, tag FROM medicine_tags WHERE medicine_id IN ({placeholders})",
        ids,
    ):
        result[row["medicine_id"]].add(row["tag"])
    return result


def tags_for_class(conn, drug_class):
    """Tags shared by *every* drug in a class.

    Used when a user names only a class ("blood thinner"). Taking the
    intersection rather than the union means a caution raised against a class
    holds for whichever member of it they actually take. The union would warn
    about properties their particular tablet may not have.
    """
    rows = conn.execute(
        "SELECT m.id FROM medicines m WHERE m.drug_class = ? ORDER BY m.name", (drug_class,)
    ).fetchall()
    if not rows:
        return set()
    per_medicine = tags_for_many(conn, [r["id"] for r in rows])
    shared = None
    for tags in per_medicine.values():
        shared = set(tags) if shared is None else (shared & tags)
    return shared or set()


def _option(row):
    option = {
        "medicine_id": row["medicine_id"],
        "name": row["name"],
        "category": row["category"],
        "medicine_type": row["medicine_type"],
        "scientific_name": row["scientific_name"],
        "drug_class": row["drug_class"],
    }
    option.update({field: row[field] for field in _USE_FIELDS})
    # The stored column is `summary`; the public name is `uses`, and only one of
    # the two is emitted so a consumer cannot read the same text as two fields.
    option["uses"] = row["summary"]
    option["common_side_effects"] = db.json_list(row["common_side_effects"])
    option["tags"] = db.json_list(row["tags"])
    option["reviewed"] = bool(row["reviewed"])
    return option


# Strongest evidence first, so a truncated list keeps the better-supported
# options. Within a level, alphabetical: this project does not rank medicines
# against each other and must not look as though it does.
_EVIDENCE_ORDER = (
    "CASE u.evidence_level WHEN 'clinical' THEN 0 WHEN 'preclinical' THEN 1 ELSE 2 END"
)


def options_for_condition(conn, condition_id, medicine_type):
    """Recorded options of one kind ('herb' or 'drug') for a condition."""
    rows = conn.execute(
        "SELECT u.medicine_id, u.use_kind, u.summary, u.evidence_level, u.pros, u.cons, "
        "       u.common_side_effects, u.cautions, u.tags, u.source_type, u.source_note, "
        "       u.reviewed, m.name, m.category, m.medicine_type, m.scientific_name, "
        "       m.drug_class "
        "FROM medicine_uses u JOIN medicines m ON m.id = u.medicine_id "
        "WHERE u.condition_id = ? AND m.medicine_type = ? "
        f"ORDER BY {_EVIDENCE_ORDER}, m.name",
        (condition_id, medicine_type),
    )
    return [_option(row) for row in rows]


def uses_for_medicine(conn, medicine_id):
    """Every recorded use of one medicine, for the medicine detail projection."""
    rows = conn.execute(
        "SELECT u.medicine_id, u.use_kind, u.summary, u.evidence_level, u.pros, u.cons, "
        "       u.common_side_effects, u.cautions, u.tags, u.source_type, u.source_note, "
        "       u.reviewed, u.condition_id, c.name AS condition_name, m.name, m.category, "
        "       m.medicine_type, m.scientific_name, m.drug_class "
        "FROM medicine_uses u "
        "JOIN medicines m ON m.id = u.medicine_id "
        "JOIN conditions c ON c.condition_id = u.condition_id "
        "WHERE u.medicine_id = ? "
        f"ORDER BY {_EVIDENCE_ORDER}, c.name",
        (medicine_id,),
    )
    options = []
    for row in rows:
        option = _option(row)
        option["condition_id"] = row["condition_id"]
        option["condition_name"] = row["condition_name"]
        options.append(option)
    return options


def combination_rules(conn, applies_to=None):
    """Tag-pair rules, highest level first.

    Returned as plain dicts with a frozen tag pair, so the matcher can compare
    without caring which way round a rule was written.
    """
    sql = (
        "SELECT rule_id, tag_a, tag_b, applies_to, reason_sentence, level "
        "FROM combination_rules"
    )
    params = []
    if applies_to:
        sql += " WHERE applies_to = ?"
        params.append(applies_to)
    sql += (
        " ORDER BY CASE level WHEN 'high' THEN 0 WHEN 'moderate' THEN 1 ELSE 2 END, rule_id"
    )
    return [
        {
            "rule_id": r["rule_id"],
            "tags": frozenset((r["tag_a"], r["tag_b"])),
            "tag_a": r["tag_a"],
            "tag_b": r["tag_b"],
            "applies_to": r["applies_to"],
            "reason_sentence": r["reason_sentence"],
            "level": r["level"],
        }
        for r in conn.execute(sql, params)
    ]


def tag_vocabulary(conn):
    return {
        r["tag"]: {"applies_to": r["applies_to"], "description": r["description"]}
        for r in conn.execute("SELECT tag, applies_to, description FROM tag_vocabulary")
    }
