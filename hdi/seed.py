"""Rebuild the SQLite read model from this project's frozen reference and curated files.

Reproducible by construction: the script only reads, derives every id from the
reference tables, and drops/recreates every table, so running it twice against
unchanged inputs produces an identical database. It never writes to
data/raw/raw_abstracts.json or data/processed/candidates.json (docs/PROJECT_SCOPE.md).

    python -m hdi.seed

Sources, in order of authority:

  data/reference/herbs.csv            40 Ayurvedic herbs (frozen scope)
  data/reference/drug_classes.csv     13 conventional drugs in 3 classes (frozen scope)
  data/reference/medicine_aliases.csv extra alias rows, including brand names
  data/reference/class_aliases.csv     lay and Hinglish names for a drug class
  data/processed/verified_interactions.json  curator-confirmed interactions
  data/processed/curation_sheet.csv    full curator verdict set
  data/raw/raw_abstracts.json         harvested corpus (screening denominator)
  data/raw/raw_abstracts.progress.json which pairs were actually searched
  data/reference/conditions.csv        supported conditions and lay synonyms
  data/reference/tag_vocabulary.csv    the closed tag vocabulary
  data/reference/herb_uses.csv         herb -> condition, with pros and cons
  data/reference/drug_indications.csv  drug -> condition, with pros and cons
  data/reference/combination_rules.csv tag-pair mechanism cautions
  data/reference/health_topics.csv    optional extra topic associations

Fields with no value in any of those files are stored NULL. This script does
not fill gaps: no interaction, adverse effect, contraindication, indication,
mechanism, evidence level or source URL is ever generated here.
"""

import argparse
import csv
import json
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

from hdi import db
from hdi.normalize import medicine_id, normalize_name, pair_key, slugify

ROOT = Path(__file__).resolve().parent.parent
HERBS_CSV = ROOT / "data" / "reference" / "herbs.csv"
DRUG_CLASSES_CSV = ROOT / "data" / "reference" / "drug_classes.csv"
ALIASES_CSV = ROOT / "data" / "reference" / "medicine_aliases.csv"
CLASS_ALIASES_CSV = ROOT / "data" / "reference" / "class_aliases.csv"
HEALTH_TOPICS_CSV = ROOT / "data" / "reference" / "health_topics.csv"
CONDITIONS_CSV = ROOT / "data" / "reference" / "conditions.csv"
TAG_VOCABULARY_CSV = ROOT / "data" / "reference" / "tag_vocabulary.csv"
HERB_USES_CSV = ROOT / "data" / "reference" / "herb_uses.csv"
DRUG_INDICATIONS_CSV = ROOT / "data" / "reference" / "drug_indications.csv"
COMBINATION_RULES_CSV = ROOT / "data" / "reference" / "combination_rules.csv"
VERIFIED_JSON = ROOT / "data" / "processed" / "verified_interactions.json"
CURATION_SHEET_CSV = ROOT / "data" / "processed" / "curation_sheet.csv"
RAW_ABSTRACTS_JSON = ROOT / "data" / "raw" / "raw_abstracts.json"
PROGRESS_JSON = ROOT / "data" / "raw" / "raw_abstracts.progress.json"

# Short class codes used by hdi.curate and stored in verified_interactions.json,
# expanded per the table in docs/CURATION_GUIDE.md.
CLASS_CODE_TO_NAME = {
    "AC": "Anticoagulants",
    "AD": "Antidiabetics",
    "CVS": "Cardiovascular",
}
CLASS_NAME_TO_CODE = {v: k for k, v in CLASS_CODE_TO_NAME.items()}

HERB_SOURCE = "data/reference/herbs.csv (project reference table, frozen scope)"
DRUG_SOURCE = "data/reference/drug_classes.csv (project reference table, frozen scope)"

# Why a pair carries the status it does. Recorded so a consumer can tell
# "a curator read the evidence and rejected it" from "nothing was ever
# published that we could retrieve" -- both are no_documented_interaction,
# but they are not equally informative.
BASIS_CURATOR_CONFIRMED = "curator_confirmed_from_pubmed_abstracts"
BASIS_CURATOR_REJECTED = "curator_reviewed_and_rejected_candidate_evidence"
BASIS_CURATOR_UNCLEAR = "curator_reviewed_and_marked_unclear"
BASIS_SCREENED_NO_TRIGGER = "abstracts_screened_no_interaction_language_found"
BASIS_NO_LITERATURE = "pubmed_search_returned_no_abstracts"


def file_date(path):
    """ISO date a source file was last modified, used as last_verified."""
    return datetime.fromtimestamp(Path(path).stat().st_mtime, tz=timezone.utc).date().isoformat()


def load_herb_medicines():
    """40 Ayurvedic herbs, with botanical name and every listed synonym as aliases.

    Unlike scripts.collect_abstracts.load_herbs, no minimum-length filter is
    applied: that filter exists to keep short synonyms out of PubMed *queries*,
    where they cause false hits. For name resolution every synonym is wanted,
    including short ones like "Vasa" or "Methi".
    """
    verified = file_date(HERBS_CSV)
    medicines = []
    with open(HERBS_CSV, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            name = row["herb_name"].strip()
            botanical = row["botanical_name"].strip()
            synonyms = [s.strip() for s in (row.get("synonyms") or "").split(";") if s.strip()]

            aliases = [(botanical, "scientific_name")] if botanical else []
            aliases += [(s, "synonym") for s in synonyms]

            medicines.append(
                {
                    "id": medicine_id("herb", name),
                    "name": name,
                    "normalized_name": normalize_name(name),
                    "category": "ayurvedic",
                    "medicine_type": "herb",
                    "generic_name": None,
                    # Phytochemical constituents are not recorded anywhere in
                    # this project, so they stay NULL rather than invented.
                    "active_ingredients": None,
                    "scientific_name": botanical or None,
                    "drug_class": None,
                    "source": HERB_SOURCE,
                    "source_url": None,
                    "last_verified": verified,
                    "aliases": aliases,
                }
            )
    return medicines


def load_drug_medicines():
    """13 conventional drugs across 3 classes, from the frozen reference table.

    Each entry is an international non-proprietary (generic) name, so
    generic_name and active_ingredients restate the name itself. That is a
    nomenclature fact carried by the source column (`example_drugs`), not a
    clinical claim; no brand names, doses or indications are added.
    """
    verified = file_date(DRUG_CLASSES_CSV)
    medicines = []
    with open(DRUG_CLASSES_CSV, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            class_name = row["drug_class"].strip()
            code = CLASS_NAME_TO_CODE.get(class_name)
            for drug in (d.strip() for d in (row.get("example_drugs") or "").split(";")):
                if not drug:
                    continue
                # Both are the drug name itself here, so insert_aliases skips
                # them as self-aliases. They are declared anyway so that a
                # future entry whose ingredient differs from its label (a brand
                # name, or a combination product) is searchable by ingredient
                # without a code change.
                aliases = [(drug, "generic_name"), (drug, "active_ingredient")]
                medicines.append(
                    {
                        "id": medicine_id("drug", drug),
                        "name": drug,
                        "normalized_name": normalize_name(drug),
                        "category": "allopathic",
                        "medicine_type": "drug",
                        "generic_name": drug,
                        "active_ingredients": db.dump_list([drug]),
                        "scientific_name": None,
                        "drug_class": class_name,
                        "source": DRUG_SOURCE,
                        "source_url": None,
                        "last_verified": verified,
                        "aliases": aliases,
                        "_class_code": code,
                    }
                )
    return medicines


MEDICINE_COLUMNS = (
    "id", "name", "normalized_name", "category", "medicine_type", "generic_name",
    "active_ingredients", "scientific_name", "drug_class", "description",
    "common_uses", "traditional_uses", "evidence_level", "side_effects",
    "contraindications", "precautions", "pregnancy_information",
    "breastfeeding_information", "source", "source_url", "last_verified",
)


def insert_medicines(conn, medicines):
    rows = []
    for m in medicines:
        rows.append(tuple(m.get(col) for col in MEDICINE_COLUMNS))
    conn.executemany(
        f"INSERT INTO medicines ({', '.join(MEDICINE_COLUMNS)}) "
        f"VALUES ({', '.join('?' * len(MEDICINE_COLUMNS))})",
        rows,
    )


def insert_aliases(conn, medicines):
    """Insert alias rows, skipping any alias identical to the medicine's own name.

    Aloe vera is both the common and the botanical name, which would otherwise
    produce a self-alias.
    """
    seen = set()
    rows = []
    for m in medicines:
        for alias, alias_type in m.get("aliases", []):
            normalized = normalize_name(alias)
            if not normalized or normalized == m["normalized_name"]:
                continue
            key = (m["id"], normalized)
            if key in seen:
                continue
            seen.add(key)
            rows.append((m["id"], alias, normalized, alias_type))
    conn.executemany(
        "INSERT INTO medicine_aliases (medicine_id, alias, normalized_alias, alias_type) "
        "VALUES (?, ?, ?, ?)",
        rows,
    )
    return len(rows)


def load_extra_aliases(conn, by_normalized):
    """Apply optional extra alias rows from data/reference/medicine_aliases.csv.

    Ships with headers only. It is the supported way to declare that two names
    refer to one substance (the Paracetamol/Acetaminophen case) without
    touching code -- and the only way, since normalization never merges names
    on similarity.
    """
    if not ALIASES_CSV.exists():
        return 0, []
    added, problems = 0, []
    with open(ALIASES_CSV, newline="", encoding="utf-8") as f:
        for lineno, row in enumerate(csv.DictReader(f), start=2):
            name = (row.get("medicine_name") or "").strip()
            alias = (row.get("alias") or "").strip()
            alias_type = (row.get("alias_type") or "synonym").strip()
            if not name and not alias:
                continue
            target = by_normalized.get(normalize_name(name))
            if target is None:
                problems.append(f"{ALIASES_CSV.name} line {lineno}: unknown medicine {name!r}")
                continue
            normalized = normalize_name(alias)
            if not normalized:
                problems.append(f"{ALIASES_CSV.name} line {lineno}: empty alias")
                continue
            conn.execute(
                "INSERT OR IGNORE INTO medicine_aliases "
                "(medicine_id, alias, normalized_alias, alias_type) VALUES (?, ?, ?, ?)",
                (target, alias, normalized, alias_type),
            )
            added += 1
    return added, problems


def alias_collisions(conn):
    """Aliases that resolve to more than one medicine.

    Reported rather than silently dropped: a shared alias makes name-based
    resolution ambiguous, and the interaction checker answers such a lookup
    with a 409 instead of guessing which substance was meant.
    """
    return [
        (r["normalized_alias"], r["n"])
        for r in conn.execute(
            "SELECT normalized_alias, COUNT(DISTINCT medicine_id) AS n "
            "FROM medicine_aliases GROUP BY normalized_alias HAVING n > 1"
        )
    ]


def load_curated_pairs():
    """Curator verdicts per herb-drug pair, keyed (herb_name, drug_name)."""
    if not CURATION_SHEET_CSV.exists():
        return {}
    by_pair = defaultdict(list)
    with open(CURATION_SHEET_CSV, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            by_pair[(row["herb"], row["drug"])].append(row)
    return by_pair


def load_verified_rows():
    """Curator-confirmed interaction rows, keyed (herb_name, drug_name)."""
    if not VERIFIED_JSON.exists():
        return {}
    by_pair = defaultdict(list)
    for row in json.loads(VERIFIED_JSON.read_text(encoding="utf-8")):
        by_pair[(row["herb"], row["drug"])].append(row)
    return by_pair


def load_corpus_pairs():
    """Which herb-drug pairs were searched, and how many abstracts each returned."""
    searched = set()
    if PROGRESS_JSON.exists():
        progress = json.loads(PROGRESS_JSON.read_text(encoding="utf-8"))
        searched = {(p[0], p[1]) for p in progress.get("completed_pairs", [])}

    abstract_counts = defaultdict(int)
    if RAW_ABSTRACTS_JSON.exists():
        for record in json.loads(RAW_ABSTRACTS_JSON.read_text(encoding="utf-8")):
            abstract_counts[(record["herb_name"], record["drug_name"])] += 1
            searched.add((record["herb_name"], record["drug_name"]))
    return searched, abstract_counts


def _severity_and_type(rows):
    """Derive a severity band and interaction type from curated trigger groups.

    Non-negated rows are preferred: a negated trigger sentence is weaker
    grounds for a severity band even when a curator confirmed the row overall.
    The third return value says whether there were *no* un-negated rows at all,
    so only a pair resting entirely on negated sentences gets that caveat.
    """
    non_negated = [r for r in rows if not r["negated"]]
    preferred = non_negated or rows
    groups = [r["trigger_group"] for r in preferred if r.get("trigger_group")]
    severities = [db.TRIGGER_GROUP_SEVERITY.get(g) for g in groups]
    severity = db.most_severe(severities)
    interaction_type = None
    for group, band in ((g, db.TRIGGER_GROUP_SEVERITY.get(g)) for g in groups):
        if band == severity:
            interaction_type = group
            break
    return severity, interaction_type, not non_negated


def build_interaction_rows(medicines_by_name, curated, verified, searched, abstract_counts):
    """One interaction row per in-corpus herb-drug pair, with its evidence.

    Status precedence, strongest signal first: a curator confirming any row
    outranks one marking a row unclear, which outranks rejections. Pairs never
    searched get no row at all -- the service reports those as
    insufficient_evidence, which is different from a searched pair that turned
    up nothing.
    """
    verified_date = file_date(VERIFIED_JSON) if VERIFIED_JSON.exists() else None
    sheet_date = file_date(CURATION_SHEET_CSV) if CURATION_SHEET_CSV.exists() else None
    corpus_date = file_date(PROGRESS_JSON) if PROGRESS_JSON.exists() else None

    interactions, evidence, mismatches = [], [], []
    for herb_name, drug_name in sorted(searched):
        herb = medicines_by_name.get(("herb", herb_name))
        drug = medicines_by_name.get(("drug", drug_name))
        if herb is None or drug is None:
            continue

        a_id, b_id = sorted([herb["id"], drug["id"]])
        key = pair_key(herb["id"], drug["id"])
        iid = f"int-{slugify(herb_name)}-{slugify(drug_name)}"
        kind = db.pair_kind(herb["category"], drug["category"])
        label = f"{herb_name} and {drug_name}"

        sheet_rows = curated.get((herb_name, drug_name), [])
        verdicts = {(r.get("verdict") or "").strip() for r in sheet_rows}
        confirmed = verified.get((herb_name, drug_name), [])
        n_abstracts = abstract_counts.get((herb_name, drug_name), 0)

        record = {
            "id": iid,
            "medicine_a_id": a_id,
            "medicine_b_id": b_id,
            "pair_key": key,
            "pair_kind": kind,
            "interaction_type": None,
            "severity": None,
            "severity_basis": None,
            "mechanism": None,            # abstract-level mining does not capture it
            "clinical_significance": None,  # only ever set from an explicit source
            "recommended_action": None,   # this database issues no clinical advice
            "source_url": None,
        }

        if confirmed:
            pmids = sorted({r["source_pmid"] for r in confirmed})
            severity, interaction_type, negated_only = _severity_and_type(confirmed)
            basis = db.SEVERITY_BASIS_DERIVED
            if negated_only:
                basis += "; all supporting sentences were negation-flagged"
            level = (
                "moderate" if len(pmids) >= db.MULTI_SOURCE_PMID_THRESHOLD else "limited"
            )
            record.update(
                {
                    "status": db.STATUS_INTERACTION_FOUND,
                    "interaction_type": interaction_type,
                    "severity": severity,
                    "severity_basis": basis,
                    "description": (
                        f"Curated PubMed evidence records {interaction_type} interaction "
                        f"language for {label} in {len(pmids)} abstract(s) "
                        f"(PMID {', '.join(pmids)}), each confirmed by manual curator review."
                    ),
                    "evidence_level": level,
                    "evidence_basis": (
                        f"{len(confirmed)} curator-confirmed sentence(s) across {len(pmids)} "
                        f"distinct PMID(s); 'moderate' requires at least "
                        f"{db.MULTI_SOURCE_PMID_THRESHOLD} distinct PMIDs, otherwise 'limited'"
                    ),
                    "source": f"{BASIS_CURATOR_CONFIRMED}; data/processed/verified_interactions.json",
                    "last_verified": verified_date,
                }
            )
        elif "unclear" in verdicts:
            unclear = [r for r in sheet_rows if (r.get("verdict") or "").strip() == "unclear"]
            record.update(
                {
                    "status": db.STATUS_INSUFFICIENT_EVIDENCE,
                    "severity": db.SEVERITY_INSUFFICIENT,
                    "description": (
                        f"{len(unclear)} candidate sentence(s) for {label} were reviewed and "
                        f"marked unclear by a curator. The available evidence is not "
                        f"sufficient to determine whether an interaction exists."
                    ),
                    "evidence_level": "insufficient",
                    "evidence_basis": BASIS_CURATOR_UNCLEAR,
                    "source": "data/processed/curation_sheet.csv",
                    "last_verified": sheet_date,
                }
            )
        elif "rejected" in verdicts:
            rejected = [r for r in sheet_rows if (r.get("verdict") or "").strip() == "rejected"]
            record.update(
                {
                    "status": db.STATUS_NO_DOCUMENTED_INTERACTION,
                    "severity": db.SEVERITY_NONE_DOCUMENTED,
                    "description": (
                        f"{len(rejected)} candidate sentence(s) for {label} were extracted from "
                        f"PubMed and reviewed; a curator rejected each as not describing an "
                        f"interaction. No documented interaction was found in the available sources."
                    ),
                    "evidence_level": "limited",
                    "evidence_basis": BASIS_CURATOR_REJECTED,
                    "source": "data/processed/curation_sheet.csv",
                    "last_verified": sheet_date,
                }
            )
        elif n_abstracts:
            record.update(
                {
                    "status": db.STATUS_NO_DOCUMENTED_INTERACTION,
                    "severity": db.SEVERITY_NONE_DOCUMENTED,
                    "description": (
                        f"{n_abstracts} PubMed abstract(s) for {label} were screened and none "
                        f"contained interaction-trigger language. No documented interaction was "
                        f"found in the available sources."
                    ),
                    "evidence_level": "limited",
                    "evidence_basis": BASIS_SCREENED_NO_TRIGGER,
                    "source": "data/raw/raw_abstracts.json via hdi.extract",
                    "last_verified": corpus_date,
                }
            )
        else:
            record.update(
                {
                    "status": db.STATUS_NO_DOCUMENTED_INTERACTION,
                    "severity": db.SEVERITY_NONE_DOCUMENTED,
                    "description": (
                        f"A PubMed search for {label} returned no abstracts. No documented "
                        f"interaction was found in the available sources."
                    ),
                    "evidence_level": "insufficient",
                    "evidence_basis": BASIS_NO_LITERATURE,
                    "source": "data/raw/raw_abstracts.progress.json",
                    "last_verified": corpus_date,
                }
            )

        # Attach every curated sentence for the pair, whatever the pair's
        # status and whatever the curator decided. A rejected row is part of
        # why the pair reads no_documented_interaction, so hiding it would
        # make the verdict less auditable, not cleaner.
        for index, row in enumerate(sheet_rows):
            verdict = (row.get("verdict") or "").strip()
            evidence.append(
                (
                    iid,
                    index,
                    row["source_pmid"],
                    row.get("trigger_matched") or "",
                    row.get("trigger_group"),
                    1 if (row.get("negated") or "").strip().lower() == "true" else 0,
                    "human_verified" if verdict == "confirmed" else "auto_extracted",
                    verdict or None,
                    row.get("evidence_sentence"),
                    db.pubmed_url(row["source_pmid"]),
                )
            )

        sheet_confirmed = sum(1 for r in sheet_rows if (r.get("verdict") or "").strip() == "confirmed")
        if sheet_confirmed != len(confirmed):
            mismatches.append(
                f"{label}: curation_sheet.csv has {sheet_confirmed} confirmed row(s) but "
                f"verified_interactions.json has {len(confirmed)}; re-run "
                f"`python -m hdi.curate ingest`"
            )

        interactions.append(record)
    return interactions, evidence, mismatches


INTERACTION_COLUMNS = (
    "id", "medicine_a_id", "medicine_b_id", "pair_key", "pair_kind", "status",
    "interaction_type", "severity", "severity_basis", "description", "mechanism",
    "clinical_significance", "recommended_action", "evidence_level",
    "evidence_basis", "source", "source_url", "last_verified",
)


def insert_interactions(conn, interactions, evidence):
    conn.executemany(
        f"INSERT INTO interactions ({', '.join(INTERACTION_COLUMNS)}) "
        f"VALUES ({', '.join('?' * len(INTERACTION_COLUMNS))})",
        [tuple(r.get(c) for c in INTERACTION_COLUMNS) for r in interactions],
    )
    conn.executemany(
        "INSERT INTO interaction_evidence (interaction_id, evidence_index, pmid, "
        "trigger_matched, trigger_group, negated, confidence, verdict, evidence_sentence, "
        "source_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        evidence,
    )


# Maps the three-level evidence vocabulary used by the knowledge CSVs onto the
# project's existing evidence_level vocabulary (hdi.db.EVIDENCE_LEVELS), which
# health_topic_map shares with the interaction table.
#
# 'clinical' lands on 'limited', not 'moderate': the clinical rows here rest on
# single small trials or reviews of small trials, which is what 'limited' means
# elsewhere in this project. Animal work is 'insufficient' as grounds for a
# human use, however clean the experiment.
USE_EVIDENCE_TO_PROJECT_LEVEL = {
    "traditional": "traditional",
    "preclinical": "insufficient",
    "clinical": "limited",
}

# A herb use with no human or animal study behind it is traditional_use; one
# with either is evidence_supported_use. A drug's labelled indication is
# conventional_use. Keeping the three apart is why the column exists.
HERB_EVIDENCE_TO_USE_TYPE = {
    "traditional": "traditional_use",
    "preclinical": "evidence_supported_use",
    "clinical": "evidence_supported_use",
}

SOURCE_TYPES = ("fetched_source", "repo_abstract", "general_knowledge")


def _split_tags(value):
    return [t.strip() for t in (value or "").split(";") if t.strip()]


def load_class_aliases(conn, known_classes):
    """Lay and Hinglish names for a whole drug class."""
    if not CLASS_ALIASES_CSV.exists():
        return 0, []
    added, problems = 0, []
    with open(CLASS_ALIASES_CSV, newline="", encoding="utf-8") as f:
        for lineno, row in enumerate(csv.DictReader(f), start=2):
            drug_class = (row.get("drug_class") or "").strip()
            alias = (row.get("alias") or "").strip()
            if not drug_class and not alias:
                continue
            if drug_class not in known_classes:
                problems.append(
                    f"{CLASS_ALIASES_CSV.name} line {lineno}: unknown drug class {drug_class!r}"
                )
                continue
            normalized = normalize_name(alias)
            if not normalized:
                problems.append(f"{CLASS_ALIASES_CSV.name} line {lineno}: empty alias")
                continue
            source_type = (row.get("source_type") or "general_knowledge").strip()
            if source_type not in SOURCE_TYPES:
                problems.append(
                    f"{CLASS_ALIASES_CSV.name} line {lineno}: bad source_type {source_type!r}"
                )
                continue
            conn.execute(
                "INSERT OR IGNORE INTO class_aliases "
                "(drug_class, alias, normalized_alias, source_type, source_note) "
                "VALUES (?, ?, ?, ?, ?)",
                (drug_class, alias, normalized, source_type,
                 (row.get("source_note") or "").strip() or None),
            )
            added += 1
    return added, problems


def load_conditions(conn, known_classes):
    """Supported conditions and their lay synonyms."""
    if not CONDITIONS_CSV.exists():
        return 0, 0, []
    conditions, synonyms, problems = 0, 0, []
    with open(CONDITIONS_CSV, newline="", encoding="utf-8") as f:
        for lineno, row in enumerate(csv.DictReader(f), start=2):
            condition_id = (row.get("condition_id") or "").strip()
            name = (row.get("name") or "").strip()
            if not condition_id:
                continue
            classes = [c.strip() for c in (row.get("drug_class") or "").split(";") if c.strip()]
            unknown = [c for c in classes if c not in known_classes]
            if unknown:
                problems.append(
                    f"{CONDITIONS_CSV.name} line {lineno}: unknown drug class(es) {unknown}"
                )
                continue
            if not classes:
                problems.append(
                    f"{CONDITIONS_CSV.name} line {lineno}: no drug class for {condition_id!r}"
                )
                continue
            conn.execute(
                "INSERT INTO conditions (condition_id, name, normalized_name, drug_classes) "
                "VALUES (?, ?, ?, ?)",
                (condition_id, name, normalize_name(name), db.dump_list(classes)),
            )
            conditions += 1

            # The condition's own name resolves as well as its lay wordings, so
            # a caller can look up either.
            for synonym in [name] + [
                s.strip() for s in (row.get("synonyms") or "").split(";") if s.strip()
            ]:
                normalized = normalize_name(synonym)
                if not normalized:
                    continue
                cursor = conn.execute(
                    "INSERT OR IGNORE INTO condition_synonyms "
                    "(condition_id, synonym, normalized_synonym) VALUES (?, ?, ?)",
                    (condition_id, synonym, normalized),
                )
                synonyms += cursor.rowcount if cursor.rowcount > 0 else 0
    return conditions, synonyms, problems


def load_tag_vocabulary(conn):
    if not TAG_VOCABULARY_CSV.exists():
        return 0, []
    added, problems = 0, []
    with open(TAG_VOCABULARY_CSV, newline="", encoding="utf-8") as f:
        for lineno, row in enumerate(csv.DictReader(f), start=2):
            tag = (row.get("tag") or "").strip()
            if not tag:
                continue
            applies_to = (row.get("applies_to") or "").strip()
            if applies_to not in ("herb", "drug", "both"):
                problems.append(
                    f"{TAG_VOCABULARY_CSV.name} line {lineno}: bad applies_to {applies_to!r}"
                )
                continue
            conn.execute(
                "INSERT OR IGNORE INTO tag_vocabulary (tag, applies_to, description) "
                "VALUES (?, ?, ?)",
                (tag, applies_to, (row.get("description") or "").strip()),
            )
            added += 1
    return added, problems


def load_uses(conn, by_normalized, path, name_column, use_kind, summary_column,
              known_conditions, known_tags):
    """Load herb_uses.csv or drug_indications.csv into medicine_uses.

    Both files have the same shape apart from the name of the medicine column,
    the name of the summary column, and whether side effects are listed, so one
    loader handles both. Rows naming an unknown medicine, condition or tag are
    reported and skipped rather than coerced: a silently dropped tag would mean
    a combination rule never fires.
    """
    if not path.exists():
        return 0, []
    added, problems = 0, []
    with open(path, newline="", encoding="utf-8") as f:
        for lineno, row in enumerate(csv.DictReader(f), start=2):
            medicine_name = (row.get(name_column) or "").strip()
            condition_id = (row.get("condition_id") or "").strip()
            if not medicine_name and not condition_id:
                continue

            target = by_normalized.get(normalize_name(medicine_name))
            if target is None:
                problems.append(
                    f"{path.name} line {lineno}: unknown medicine {medicine_name!r}"
                )
                continue
            if condition_id not in known_conditions:
                problems.append(
                    f"{path.name} line {lineno}: unknown condition {condition_id!r}"
                )
                continue

            evidence_level = (row.get("evidence_level") or "").strip()
            if use_kind == "conventional_use":
                # A labelled indication is clinical by construction: it exists
                # because a regulator accepted trial evidence for it.
                evidence_level = "clinical"
            if evidence_level not in USE_EVIDENCE_TO_PROJECT_LEVEL:
                problems.append(
                    f"{path.name} line {lineno}: bad evidence_level {evidence_level!r}"
                )
                continue

            tags = _split_tags(row.get("tags"))
            unknown = [t for t in tags if t not in known_tags]
            if unknown:
                problems.append(
                    f"{path.name} line {lineno}: tag(s) outside tag_vocabulary.csv: {unknown}"
                )
                continue

            source_type = (row.get("source_type") or "").strip()
            if source_type not in SOURCE_TYPES:
                problems.append(
                    f"{path.name} line {lineno}: bad source_type {source_type!r}"
                )
                continue
            if (row.get("reviewed") or "false").strip().lower() not in ("false", "0", ""):
                problems.append(
                    f"{path.name} line {lineno}: reviewed must be false; nothing here has "
                    f"had clinical review"
                )
                continue

            side_effects = _split_tags(row.get("common_side_effects"))
            conn.execute(
                "INSERT OR IGNORE INTO medicine_uses "
                "(medicine_id, condition_id, use_kind, summary, evidence_level, pros, cons, "
                " common_side_effects, cautions, tags, source_type, source_note, reviewed) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)",
                (
                    target, condition_id, use_kind,
                    (row.get(summary_column) or "").strip(),
                    evidence_level,
                    (row.get("pros") or "").strip(),
                    (row.get("cons") or "").strip(),
                    db.dump_list(side_effects),
                    (row.get("cautions") or "").strip(),
                    db.dump_list(tags),
                    source_type,
                    (row.get("source_note") or "").strip(),
                ),
            )
            for tag in tags:
                conn.execute(
                    "INSERT OR IGNORE INTO medicine_tags (medicine_id, tag) VALUES (?, ?)",
                    (target, tag),
                )
            added += 1
    return added, problems


def load_combination_rules(conn, known_tags):
    if not COMBINATION_RULES_CSV.exists():
        return 0, []
    added, problems = 0, []
    with open(COMBINATION_RULES_CSV, newline="", encoding="utf-8") as f:
        for lineno, row in enumerate(csv.DictReader(f), start=2):
            rule_id = (row.get("rule_id") or "").strip()
            if not rule_id:
                continue
            tag_a = (row.get("tag_a") or "").strip()
            tag_b = (row.get("tag_b") or "").strip()
            unknown = [t for t in (tag_a, tag_b) if t not in known_tags]
            if unknown:
                problems.append(
                    f"{COMBINATION_RULES_CSV.name} line {lineno}: tag(s) outside "
                    f"tag_vocabulary.csv: {unknown}"
                )
                continue
            applies_to = (row.get("applies_to") or "").strip()
            if applies_to not in ("herb+drug", "herb+herb", "drug+drug"):
                problems.append(
                    f"{COMBINATION_RULES_CSV.name} line {lineno}: bad applies_to {applies_to!r}"
                )
                continue
            level = (row.get("level") or "").strip()
            if level not in ("high", "moderate", "low"):
                problems.append(
                    f"{COMBINATION_RULES_CSV.name} line {lineno}: bad level {level!r}"
                )
                continue
            conn.execute(
                "INSERT OR IGNORE INTO combination_rules "
                "(rule_id, tag_a, tag_b, applies_to, reason_sentence, level) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (rule_id, tag_a, tag_b, applies_to,
                 (row.get("reason_sentence") or "").strip(), level),
            )
            added += 1
    return added, problems


def derive_health_topics(conn):
    """Project medicine_uses onto health_topic_map, one topic per condition.

    The topic table predates this data and its endpoints are already live, so
    filling it is a derivation rather than new surface. Nothing is invented
    here: every row restates a medicine_uses row, carries that row's source, and
    lands in the use_type bucket its evidence level earns.
    """
    rows = conn.execute(
        "SELECT u.medicine_id, u.use_kind, u.summary, u.evidence_level, u.source_type, "
        "       u.source_note, c.name AS topic "
        "FROM medicine_uses u JOIN conditions c ON c.condition_id = u.condition_id "
        "ORDER BY c.name, u.medicine_id"
    ).fetchall()

    added = 0
    for row in rows:
        if row["use_kind"] == "conventional_use":
            use_type = "conventional_use"
        else:
            use_type = HERB_EVIDENCE_TO_USE_TYPE[row["evidence_level"]]
        conn.execute(
            "INSERT OR IGNORE INTO health_topic_map (topic, normalized_topic, medicine_id, "
            "use_type, description, evidence_level, source, source_url, last_verified) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)",
            (
                row["topic"], normalize_name(row["topic"]), row["medicine_id"], use_type,
                row["summary"],
                USE_EVIDENCE_TO_PROJECT_LEVEL[row["evidence_level"]],
                f"{row['source_type']}: {row['source_note']}",
                file_date(HERB_USES_CSV) if HERB_USES_CSV.exists() else None,
            ),
        )
        added += 1
    return added


def load_health_topics(conn, by_normalized):
    """Apply optional topic associations from data/reference/health_topics.csv.

    Ships with headers only: the project holds no sourced indication data, and
    generating any would be fabricated medical information. The table, loader
    and API are live so that sourced rows can be added as data.
    """
    if not HEALTH_TOPICS_CSV.exists():
        return 0, []
    added, problems = 0, []
    with open(HEALTH_TOPICS_CSV, newline="", encoding="utf-8") as f:
        for lineno, row in enumerate(csv.DictReader(f), start=2):
            topic = (row.get("topic") or "").strip()
            name = (row.get("medicine_name") or "").strip()
            if not topic and not name:
                continue
            target = by_normalized.get(normalize_name(name))
            if target is None:
                problems.append(f"{HEALTH_TOPICS_CSV.name} line {lineno}: unknown medicine {name!r}")
                continue
            use_type = (row.get("use_type") or "").strip()
            if use_type not in {"conventional_use", "traditional_use", "evidence_supported_use"}:
                problems.append(f"{HEALTH_TOPICS_CSV.name} line {lineno}: bad use_type {use_type!r}")
                continue
            conn.execute(
                "INSERT OR IGNORE INTO health_topic_map (topic, normalized_topic, medicine_id, "
                "use_type, description, evidence_level, source, source_url, last_verified) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    topic, normalize_name(topic), target, use_type,
                    (row.get("description") or "").strip() or None,
                    (row.get("evidence_level") or "").strip() or None,
                    (row.get("source") or "").strip() or None,
                    (row.get("source_url") or "").strip() or None,
                    (row.get("last_verified") or "").strip() or None,
                ),
            )
            added += 1
    return added, problems


def build(db_path=db.DB_PATH, verbose=True):
    def say(*args):
        if verbose:
            print(*args)

    medicines = load_herb_medicines() + load_drug_medicines()
    by_normalized = {m["normalized_name"]: m["id"] for m in medicines}
    by_name = {(m["medicine_type"], m["name"]): m for m in medicines}

    conn = db.connect(db_path)
    try:
        db.apply_schema(conn)
        insert_medicines(conn, medicines)
        n_aliases = insert_aliases(conn, medicines)
        n_extra, alias_problems = load_extra_aliases(conn, by_normalized)

        known_classes = {m["drug_class"] for m in medicines if m.get("drug_class")}
        n_class_aliases, class_alias_problems = load_class_aliases(conn, known_classes)

        curated = load_curated_pairs()
        verified = load_verified_rows()
        searched, abstract_counts = load_corpus_pairs()
        interactions, evidence, mismatches = build_interaction_rows(
            by_name, curated, verified, searched, abstract_counts
        )
        insert_interactions(conn, interactions, evidence)

        # The knowledge layer, in dependency order: tags before the rows that
        # reference them, conditions before the uses that point at them.
        n_tags, tag_problems = load_tag_vocabulary(conn)
        known_tags = {r["tag"] for r in conn.execute("SELECT tag FROM tag_vocabulary")}
        n_conditions, n_synonyms, condition_problems = load_conditions(conn, known_classes)
        known_conditions = {
            r["condition_id"] for r in conn.execute("SELECT condition_id FROM conditions")
        }

        n_herb_uses, herb_use_problems = load_uses(
            conn, by_normalized, HERB_USES_CSV, "herb", "traditional_use",
            "traditional_use", known_conditions, known_tags,
        )
        n_drug_uses, drug_use_problems = load_uses(
            conn, by_normalized, DRUG_INDICATIONS_CSV, "drug", "conventional_use",
            "what_its_for", known_conditions, known_tags,
        )
        n_rules, rule_problems = load_combination_rules(conn, known_tags)

        n_derived_topics = derive_health_topics(conn)
        n_extra_topics, topic_problems = load_health_topics(conn, by_normalized)
        n_topics = n_derived_topics + n_extra_topics

        status_counts = {
            r["status"]: r["n"]
            for r in conn.execute("SELECT status, COUNT(*) AS n FROM interactions GROUP BY status")
        }
        meta = {
            "built_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "medicines": str(len(medicines)),
            "aliases": str(n_aliases + n_extra),
            "class_aliases": str(n_class_aliases),
            "interactions": str(len(interactions)),
            "evidence_rows": str(len(evidence)),
            "health_topic_rows": str(n_topics),
            "conditions": str(n_conditions),
            "condition_synonyms": str(n_synonyms),
            "tags": str(n_tags),
            "medicine_uses": str(n_herb_uses + n_drug_uses),
            "combination_rules": str(n_rules),
            "herbs_csv_verified": file_date(HERBS_CSV),
            "drug_classes_csv_verified": file_date(DRUG_CLASSES_CSV),
        }
        for source_type, n in conn.execute(
            "SELECT source_type, COUNT(*) AS n FROM medicine_uses GROUP BY source_type"
        ):
            meta[f"uses_{source_type}"] = str(n)
        meta.update({f"status_{k}": str(v) for k, v in status_counts.items()})
        conn.executemany(
            "INSERT OR REPLACE INTO seed_metadata (key, value) VALUES (?, ?)",
            sorted(meta.items()),
        )
        conn.commit()

        collisions = alias_collisions(conn)
        say(f"Database: {db_path}")
        say(f"  medicines: {len(medicines)} "
            f"({sum(1 for m in medicines if m['medicine_type'] == 'herb')} herbs, "
            f"{sum(1 for m in medicines if m['medicine_type'] == 'drug')} drugs)")
        say(f"  aliases: {n_aliases} from reference tables + {n_extra} from {ALIASES_CSV.name}")
        say(f"  interactions: {len(interactions)} in-corpus pairs")
        for status, n in sorted(status_counts.items()):
            say(f"    {status}: {n}")
        say(f"  evidence rows: {len(evidence)}")
        say(f"  class aliases: {n_class_aliases}")
        say(f"  conditions: {n_conditions} ({n_synonyms} synonyms)")
        say(f"  tags: {n_tags}")
        say(f"  medicine uses: {n_herb_uses} herb + {n_drug_uses} drug")
        for row in conn.execute(
            "SELECT source_type, COUNT(*) AS n FROM medicine_uses "
            "GROUP BY source_type ORDER BY source_type"
        ):
            say(f"    {row['source_type']}: {row['n']}")
        say(f"  combination rules: {n_rules}")
        say(f"  health-topic rows: {n_derived_topics} derived + {n_extra_topics} from "
            f"{HEALTH_TOPICS_CSV.name}")

        problems = (
            alias_problems + class_alias_problems + tag_problems + condition_problems
            + herb_use_problems + drug_use_problems + rule_problems + topic_problems
            + mismatches
        )
        for problem in problems:
            say(f"  ! {problem}")
        for alias, n in collisions:
            say(f"  ! ambiguous alias {alias!r} resolves to {n} medicines "
                f"(name lookups for it will return 409)")

        return {
            "medicines": len(medicines),
            "interactions": len(interactions),
            "evidence": len(evidence),
            "status_counts": status_counts,
            "conditions": n_conditions,
            "tags": n_tags,
            "medicine_uses": n_herb_uses + n_drug_uses,
            "combination_rules": n_rules,
            "health_topic_rows": n_topics,
            "problems": problems,
            "collisions": collisions,
        }
    finally:
        conn.close()


def main():
    parser = argparse.ArgumentParser(description="Rebuild the SQLite read model.")
    parser.add_argument("--db", default=str(db.DB_PATH), help="Output database path.")
    parser.add_argument("--quiet", action="store_true")
    args = parser.parse_args()
    build(db_path=args.db, verbose=not args.quiet)


if __name__ == "__main__":
    main()
