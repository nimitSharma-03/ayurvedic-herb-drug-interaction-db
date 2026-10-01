"""Health-topic to medicine information mapping.

Informational only. A topic lookup reports which medicines a *source* has
associated with a topic, tagged by whether that association is conventional
use, traditional Ayurvedic use, or use with modern evidence behind it. It does
not rank, recommend, diagnose, or suggest a dose.

The backing table is populated from data/reference/health_topics.csv, which
ships with headers only: this project holds no sourced indication data, and
generating any would be fabricated medical information. A topic query
therefore currently returns no_topic_data rather than an empty "nothing helps
this" answer, which would be a claim of its own.
"""

from hdi.normalize import normalize_name

STATUS_FOUND = "topic_found"
STATUS_NOT_FOUND = "topic_not_found"
STATUS_NO_DATA = "no_topic_data"

DISCLAIMER = (
    "Topic associations are informational records drawn from cited sources. They are "
    "not treatment recommendations, are not personalized, and include no dosage "
    "guidance. Traditional use is reported as tradition, not as clinical proof."
)

_ROW_FIELDS = (
    "use_type", "description", "evidence_level", "source", "source_url", "last_verified",
)


def has_topic_data(conn):
    return conn.execute("SELECT COUNT(*) AS n FROM health_topic_map").fetchone()["n"] > 0


def list_topics(conn):
    return [
        {"topic": r["topic"], "medicine_count": r["n"]}
        for r in conn.execute(
            "SELECT topic, COUNT(DISTINCT medicine_id) AS n FROM health_topic_map "
            "GROUP BY normalized_topic, topic ORDER BY topic"
        )
    ]


def lookup_topic(conn, topic):
    """Medicines a source associates with a topic, grouped by kind of use.

    Returns (payload, error). error is "empty_query" when the topic is blank.
    """
    normalized = normalize_name(topic)
    if not normalized:
        return None, "empty_query"

    if not has_topic_data(conn):
        return {
            "topic": topic,
            "status": STATUS_NO_DATA,
            "conventional_use": [],
            "traditional_use": [],
            "evidence_supported_use": [],
            "note": (
                "No health-topic associations are loaded. This project has no sourced "
                "indication data; populate data/reference/health_topics.csv with cited "
                "rows and re-run `python -m hdi.seed` to enable topic lookups."
            ),
            "disclaimer": DISCLAIMER,
        }, None

    rows = conn.execute(
        "SELECT t.use_type, t.description, t.evidence_level, t.source, t.source_url, "
        "       t.last_verified, m.id, m.name, m.category, m.medicine_type "
        "FROM health_topic_map t JOIN medicines m ON m.id = t.medicine_id "
        "WHERE t.normalized_topic = ? ORDER BY t.use_type, m.name",
        (normalized,),
    ).fetchall()

    grouped = {"conventional_use": [], "traditional_use": [], "evidence_supported_use": []}
    for row in rows:
        entry = {
            "medicine": {
                "id": row["id"],
                "name": row["name"],
                "category": row["category"],
                "medicine_type": row["medicine_type"],
            },
        }
        entry.update({field: row[field] for field in _ROW_FIELDS})
        grouped[row["use_type"]].append(entry)

    payload = {
        "topic": topic,
        "status": STATUS_FOUND if rows else STATUS_NOT_FOUND,
        "disclaimer": DISCLAIMER,
    }
    payload.update(grouped)
    return payload, None
