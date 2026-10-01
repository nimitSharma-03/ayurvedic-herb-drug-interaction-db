"""Check the reference CSVs against the frozen scope and the project's data rules.

    python -m hdi.validate_reference          # exits 1 if anything fails

Runs on the files, not on the built database, so a bad row is caught before it
is seeded and before a test fails somewhere less obvious. The seeder reports the
same class of problem while loading; this is the check you can run on its own,
and the one tests/test_reference_data.py drives.

What it enforces, and why each rule exists:

  frozen scope        every herb and drug named anywhere resolves to a row in
                      herbs.csv or drug_classes.csv. docs/PROJECT_SCOPE.md freezes
                      that scope, and a typo would otherwise silently drop a row.
  closed tag set      every tag is in tag_vocabulary.csv. A misspelled tag is
                      worse than a missing one: the rule it was meant to trigger
                      never fires and nothing complains.
  conditions exist    every condition_id resolves, and every condition names a
                      real drug class.
  no empty pros/cons  an option with a blank pro or con reads as though there is
                      nothing to say, which is not the same as not knowing.
  word limits         pros, cons and cautions stay at or under 20 words, so a
                      response cannot turn into prose nobody reads.
  nothing reviewed    reviewed is false on every row. docs/PROJECT_SCOPE.md forbids
                      marking unreviewed data as reviewed.
  forbidden output    no dose, no brand name and no form of "safe to take" in any
                      field that can reach a response.
  answerable scope    every supported condition has at least one conventional
                      option. A condition we accept but cannot answer would be a
                      worse answer than out_of_scope.
"""

import argparse
import csv
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REFERENCE = ROOT / "data" / "reference"

HERBS_CSV = REFERENCE / "herbs.csv"
DRUG_CLASSES_CSV = REFERENCE / "drug_classes.csv"
ALIASES_CSV = REFERENCE / "medicine_aliases.csv"
CLASS_ALIASES_CSV = REFERENCE / "class_aliases.csv"
CONDITIONS_CSV = REFERENCE / "conditions.csv"
TAG_VOCABULARY_CSV = REFERENCE / "tag_vocabulary.csv"
HERB_USES_CSV = REFERENCE / "herb_uses.csv"
DRUG_INDICATIONS_CSV = REFERENCE / "drug_indications.csv"
COMBINATION_RULES_CSV = REFERENCE / "combination_rules.csv"
RED_FLAGS_JSON = REFERENCE / "red_flags.json"

MAX_WORDS = 20
SOURCE_TYPES = {"fetched_source", "repo_abstract", "general_knowledge"}
EVIDENCE_LEVELS = {"traditional", "preclinical", "clinical"}
APPLIES_TO = {"herb+drug", "herb+herb", "drug+drug"}
RULE_LEVELS = {"high", "moderate", "low"}

# Patterns that must never appear in a field a response can carry.
#
# Dosing is the big one: this project has no sourced dose for anything, and a
# number next to a unit reads as instruction however it was meant.
FORBIDDEN_OUTPUT_PATTERNS = (
    (r"\b\d+\s*(?:mg|mcg|ug|g|gm|grams?|ml|cc|iu|units?|tablets?|capsules?|tsp|tbsp)\b",
     "looks like a dose"),
    (r"\b(?:twice|thrice|once)\s+(?:a|per)\s+day\b", "looks like a dosing frequency"),
    (r"\b(?:bd|tds|od|hs|q\.?d\.?|b\.?i\.?d\.?|t\.?i\.?d\.?)\b", "dosing abbreviation"),
    # Forbidden outright, however they are framed.
    (r"safe to take", "uses the forbidden phrase 'safe to take'"),
    (r"\b(?:perfectly|completely|totally|entirely|generally) safe\b", "claims safety"),
    (r"\bharmless\b", "claims safety"),
    (r"\brisk[- ]free\b", "claims safety"),
)

# The word "safe" is not banned, because the wording this project is *required*
# to use for a pair it holds no record of contains it:
#
#   "No documented interaction in this database. This does not mean the
#    combination is safe."
#
# Banning the word would ban that sentence. What is banned is an *unnegated
# claim* that something is safe. Only claim-shaped constructions count: a
# "narrow safety margin" or a "long safety record" is a description, and the
# first of those is in fact a warning, so sweeping for the bare word would
# forbid the very sentences that carry the caution.
_SAFETY_WORD = re.compile(
    r"\b(?:is|are|was|were|be|been|seems?|appears?|remains?|stays?)\s+"
    r"(?:\w+\s+){0,2}safer?\b"
    r"|\bsafer?\s+(?:to|for|with|in|alongside)\b",
    re.IGNORECASE,
)
_SENTENCE_SPLIT = re.compile(r"(?<=[.!?;])\s+|\n+")
_NEGATION = re.compile(
    r"\b(?:not|never|no|none|nothing|nor|cannot|can't|does ?n[o']t|do ?n[o']t|"
    r"is ?n[o']t|was ?n[o']t|absence|without|un\w+)\b",
    re.IGNORECASE,
)


def safety_claim_problems(text):
    """Sentences that mention safety without negating the claim."""
    problems = []
    for sentence in _SENTENCE_SPLIT.split(text or ""):
        if not _SAFETY_WORD.search(sentence):
            continue
        if not _NEGATION.search(sentence):
            problems.append(
                f"claims something is safe without negating it ({sentence.strip()!r})"
            )
    return problems

# Fields that can reach a response body and so must be clean.
_SCANNED_FIELDS = (
    "traditional_use", "what_its_for", "pros", "cons", "cautions",
    "common_side_effects", "reason_sentence",
)
_WORD_LIMITED_FIELDS = ("traditional_use", "what_its_for", "pros", "cons", "cautions")
_REQUIRED_TEXT_FIELDS = ("pros", "cons", "cautions")


def read_rows(path):
    if not path.exists():
        return None
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def load_frozen_scope():
    """Medicine names the project is allowed to mention, from the frozen tables."""
    herbs, drugs, classes = set(), set(), set()
    for row in read_rows(HERBS_CSV) or []:
        herbs.add(row["herb_name"].strip())
    for row in read_rows(DRUG_CLASSES_CSV) or []:
        drug_class = row["drug_class"].strip()
        classes.add(drug_class)
        for drug in (d.strip() for d in row["example_drugs"].split(";")):
            if drug:
                drugs.add(drug)
    return herbs, drugs, classes


def brand_names():
    """Brand names declared in the alias table, so no other field may contain one."""
    names = set()
    for row in read_rows(ALIASES_CSV) or []:
        if (row.get("alias_type") or "").strip() == "brand_name":
            alias = (row.get("alias") or "").strip()
            if alias:
                names.add(alias)
    return names


def scan_forbidden(text, brands):
    """Reasons this text may not be emitted, or an empty list."""
    problems = []
    if not text:
        return problems
    lowered = text.lower()
    for pattern, why in FORBIDDEN_OUTPUT_PATTERNS:
        match = re.search(pattern, lowered, re.IGNORECASE)
        if match:
            problems.append(f"{why} ({match.group(0)!r})")
    problems.extend(safety_claim_problems(text))
    for brand in brands:
        # Word-boundary match, so "Aten" does not fire inside "Atenolol" and
        # "Warf" does not fire inside "Warfarin".
        if re.search(rf"\b{re.escape(brand.lower())}\b", lowered):
            problems.append(f"contains the brand name {brand!r}")
    return problems


def check_tag_vocabulary():
    rows = read_rows(TAG_VOCABULARY_CSV)
    problems, tags = [], set()
    if rows is None:
        return [f"{TAG_VOCABULARY_CSV.name} is missing"], tags
    for lineno, row in enumerate(rows, start=2):
        tag = (row.get("tag") or "").strip()
        if not tag:
            problems.append(f"{TAG_VOCABULARY_CSV.name} line {lineno}: empty tag")
            continue
        if tag in tags:
            problems.append(f"{TAG_VOCABULARY_CSV.name} line {lineno}: duplicate tag {tag!r}")
        if (row.get("applies_to") or "").strip() not in {"herb", "drug", "both"}:
            problems.append(
                f"{TAG_VOCABULARY_CSV.name} line {lineno}: bad applies_to for {tag!r}"
            )
        if not (row.get("description") or "").strip():
            problems.append(
                f"{TAG_VOCABULARY_CSV.name} line {lineno}: {tag!r} has no description"
            )
        tags.add(tag)
    return problems, tags


def check_conditions(classes):
    rows = read_rows(CONDITIONS_CSV)
    problems, conditions = [], {}
    if rows is None:
        return [f"{CONDITIONS_CSV.name} is missing"], conditions
    for lineno, row in enumerate(rows, start=2):
        condition_id = (row.get("condition_id") or "").strip()
        if not condition_id:
            problems.append(f"{CONDITIONS_CSV.name} line {lineno}: empty condition_id")
            continue
        if condition_id in conditions:
            problems.append(
                f"{CONDITIONS_CSV.name} line {lineno}: duplicate condition_id {condition_id!r}"
            )
        if not (row.get("name") or "").strip():
            problems.append(f"{CONDITIONS_CSV.name} line {lineno}: {condition_id!r} has no name")
        declared = [c.strip() for c in (row.get("drug_class") or "").split(";") if c.strip()]
        if not declared:
            problems.append(
                f"{CONDITIONS_CSV.name} line {lineno}: {condition_id!r} names no drug class"
            )
        for drug_class in declared:
            if drug_class not in classes:
                problems.append(
                    f"{CONDITIONS_CSV.name} line {lineno}: {condition_id!r} names unknown "
                    f"drug class {drug_class!r}"
                )
        synonyms = [s.strip() for s in (row.get("synonyms") or "").split(";") if s.strip()]
        if not synonyms:
            problems.append(
                f"{CONDITIONS_CSV.name} line {lineno}: {condition_id!r} has no lay synonyms, "
                f"so a topic lookup can only find it by its formal name"
            )
        conditions[condition_id] = declared
    return problems, conditions


def check_uses(path, name_column, summary_column, known_names, conditions, tags, brands,
               evidence_level_required=True):
    """Validate herb_uses.csv or drug_indications.csv. Returns (problems, covered).

    evidence_level_required is False for drug_indications.csv, which carries no
    such column: a labelled indication is clinical by construction, because it
    exists only where a regulator accepted trial evidence for it. hdi/seed.py
    derives the same value, and the two must agree.
    """
    rows = read_rows(path)
    problems, covered, seen = [], {}, set()
    if rows is None:
        return [f"{path.name} is missing"], covered

    for lineno, row in enumerate(rows, start=2):
        where = f"{path.name} line {lineno}"
        name = (row.get(name_column) or "").strip()
        condition_id = (row.get("condition_id") or "").strip()

        if name not in known_names:
            problems.append(f"{where}: {name!r} is not in the frozen reference tables")
            continue
        if condition_id not in conditions:
            problems.append(f"{where}: unknown condition_id {condition_id!r}")
            continue
        if (name, condition_id) in seen:
            problems.append(f"{where}: duplicate row for {name!r} / {condition_id!r}")
        seen.add((name, condition_id))
        covered.setdefault(condition_id, []).append(name)

        if not (row.get(summary_column) or "").strip():
            problems.append(f"{where}: {summary_column} is empty")

        evidence_level = (row.get("evidence_level") or "").strip()
        if evidence_level_required and evidence_level not in EVIDENCE_LEVELS:
            problems.append(f"{where}: bad evidence_level {evidence_level!r}")
        elif evidence_level and evidence_level not in EVIDENCE_LEVELS:
            problems.append(f"{where}: bad evidence_level {evidence_level!r}")

        for field in _REQUIRED_TEXT_FIELDS:
            if not (row.get(field) or "").strip():
                problems.append(f"{where}: {field} is empty")

        for field in _WORD_LIMITED_FIELDS:
            value = (row.get(field) or "").strip()
            if value:
                words = len(value.split())
                if words > MAX_WORDS:
                    problems.append(f"{where}: {field} is {words} words, limit {MAX_WORDS}")

        for field in _SCANNED_FIELDS:
            for reason in scan_forbidden(row.get(field), brands):
                problems.append(f"{where}: {field} {reason}")

        row_tags = [t.strip() for t in (row.get("tags") or "").split(";") if t.strip()]
        for tag in row_tags:
            if tag not in tags:
                problems.append(f"{where}: tag {tag!r} is not in {TAG_VOCABULARY_CSV.name}")

        source_type = (row.get("source_type") or "").strip()
        if source_type not in SOURCE_TYPES:
            problems.append(f"{where}: bad source_type {source_type!r}")
        if not (row.get("source_note") or "").strip():
            problems.append(f"{where}: source_note is empty")

        reviewed = (row.get("reviewed") or "").strip().lower()
        if reviewed not in {"false", "0", ""}:
            problems.append(
                f"{where}: reviewed is {reviewed!r}; nothing in this project has had "
                f"clinical review and docs/PROJECT_SCOPE.md forbids marking it reviewed"
            )
    return problems, covered


def check_aliases(herbs, drugs):
    rows = read_rows(ALIASES_CSV)
    problems = []
    if rows is None:
        return [f"{ALIASES_CSV.name} is missing"]
    known = herbs | drugs
    seen = set()
    for lineno, row in enumerate(rows, start=2):
        where = f"{ALIASES_CSV.name} line {lineno}"
        name = (row.get("medicine_name") or "").strip()
        alias = (row.get("alias") or "").strip()
        if not name and not alias:
            continue
        if name not in known:
            problems.append(f"{where}: {name!r} is not in the frozen reference tables")
        if not alias:
            problems.append(f"{where}: empty alias")
        key = (name.lower(), alias.lower())
        if key in seen:
            problems.append(f"{where}: duplicate alias {alias!r} for {name!r}")
        seen.add(key)
        alias_type = (row.get("alias_type") or "").strip()
        if alias_type not in {"synonym", "scientific_name", "generic_name",
                             "active_ingredient", "abbreviation", "brand_name"}:
            problems.append(f"{where}: bad alias_type {alias_type!r}")
        if (row.get("source_type") or "").strip() not in SOURCE_TYPES:
            problems.append(f"{where}: bad source_type for {alias!r}")
    return problems


def check_class_aliases(classes):
    rows = read_rows(CLASS_ALIASES_CSV)
    problems = []
    if rows is None:
        return [f"{CLASS_ALIASES_CSV.name} is missing"]
    for lineno, row in enumerate(rows, start=2):
        where = f"{CLASS_ALIASES_CSV.name} line {lineno}"
        drug_class = (row.get("drug_class") or "").strip()
        if drug_class not in classes:
            problems.append(f"{where}: unknown drug class {drug_class!r}")
        if not (row.get("alias") or "").strip():
            problems.append(f"{where}: empty alias")
        if (row.get("source_type") or "").strip() not in SOURCE_TYPES:
            problems.append(f"{where}: bad source_type")
    return problems


def check_rules(tags, brands):
    rows = read_rows(COMBINATION_RULES_CSV)
    problems, seen = [], set()
    if rows is None:
        return [f"{COMBINATION_RULES_CSV.name} is missing"]
    for lineno, row in enumerate(rows, start=2):
        where = f"{COMBINATION_RULES_CSV.name} line {lineno}"
        rule_id = (row.get("rule_id") or "").strip()
        if not rule_id:
            problems.append(f"{where}: empty rule_id")
        elif rule_id in seen:
            problems.append(f"{where}: duplicate rule_id {rule_id!r}")
        seen.add(rule_id)

        for field in ("tag_a", "tag_b"):
            tag = (row.get(field) or "").strip()
            if tag not in tags:
                problems.append(f"{where}: {field} {tag!r} is not in {TAG_VOCABULARY_CSV.name}")

        if (row.get("applies_to") or "").strip() not in APPLIES_TO:
            problems.append(f"{where}: bad applies_to")
        if (row.get("level") or "").strip() not in RULE_LEVELS:
            problems.append(f"{where}: bad level")

        reason = (row.get("reason_sentence") or "").strip()
        if not reason:
            problems.append(f"{where}: empty reason_sentence")
        elif len(reason.split()) > MAX_WORDS:
            problems.append(
                f"{where}: reason_sentence is {len(reason.split())} words, limit {MAX_WORDS}"
            )
        for problem in scan_forbidden(reason, brands):
            problems.append(f"{where}: reason_sentence {problem}")
    return problems


def check_red_flags(brands):
    problems = []
    if not RED_FLAGS_JSON.exists():
        return [f"{RED_FLAGS_JSON.name} is missing"]
    try:
        document = json.loads(RED_FLAGS_JSON.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        return [f"{RED_FLAGS_JSON.name} is not valid JSON: {exc}"]

    if not document.get("emergency_number", {}).get("number"):
        problems.append(f"{RED_FLAGS_JSON.name}: no emergency_number")

    required = {
        "chest_pain", "trouble_breathing", "fainting", "stroke_signs",
        "severe_bleeding", "vomiting_blood", "black_stools",
        "glycemic_emergency", "suicidal_thoughts",
    }
    present = {c.get("id") for c in document.get("categories", [])}
    for missing in sorted(required - present):
        problems.append(f"{RED_FLAGS_JSON.name}: no category for {missing!r}")

    for category in document.get("categories", []):
        where = f"{RED_FLAGS_JSON.name} category {category.get('id')!r}"
        if not category.get("message"):
            problems.append(f"{where}: no message")
        if not category.get("patterns"):
            problems.append(f"{where}: no patterns")
        for pattern in category.get("patterns", []):
            try:
                re.compile(pattern, re.IGNORECASE)
            except re.error as exc:
                problems.append(f"{where}: pattern {pattern!r} does not compile: {exc}")
        for problem in scan_forbidden(category.get("message"), brands):
            problems.append(f"{where}: message {problem}")

    # The suicidal-thoughts category must route to a helpline, not just 112.
    if "suicidal_thoughts" not in document.get("additional_help", {}):
        problems.append(
            f"{RED_FLAGS_JSON.name}: suicidal_thoughts has no additional_help helpline"
        )
    return problems


def validate():
    """Every problem found, as a list of strings. Empty means the files are clean."""
    herbs, drugs, classes = load_frozen_scope()
    if not herbs or not drugs:
        return ["the frozen reference tables could not be read"]

    brands = brand_names()
    problems = []

    tag_problems, tags = check_tag_vocabulary()
    problems += tag_problems

    condition_problems, conditions = check_conditions(classes)
    problems += condition_problems

    problems += check_aliases(herbs, drugs)
    problems += check_class_aliases(classes)

    herb_problems, herb_coverage = check_uses(
        HERB_USES_CSV, "herb", "traditional_use", herbs, conditions, tags, brands
    )
    problems += herb_problems

    drug_problems, drug_coverage = check_uses(
        DRUG_INDICATIONS_CSV, "drug", "what_its_for", drugs, conditions, tags, brands,
        evidence_level_required=False,
    )
    problems += drug_problems

    problems += check_rules(tags, brands)
    problems += check_red_flags(brands)

    # A condition we accept but hold no conventional option for would answer a
    # user with an empty list, which is a worse answer than out_of_scope.
    for condition_id in conditions:
        if not drug_coverage.get(condition_id):
            problems.append(
                f"{CONDITIONS_CSV.name}: {condition_id!r} is supported but "
                f"{DRUG_INDICATIONS_CSV.name} offers no conventional option for it"
            )

    # Tags declared but never used point at a rule that will never fire.
    used = set()
    for path, column in ((HERB_USES_CSV, "tags"), (DRUG_INDICATIONS_CSV, "tags")):
        for row in read_rows(path) or []:
            used.update(t.strip() for t in (row.get(column) or "").split(";") if t.strip())
    for row in read_rows(COMBINATION_RULES_CSV) or []:
        used.update(
            (row.get(f) or "").strip() for f in ("tag_a", "tag_b") if (row.get(f) or "").strip()
        )
    for unused in sorted(tags - used):
        problems.append(
            f"{TAG_VOCABULARY_CSV.name}: tag {unused!r} is declared but used nowhere"
        )

    return problems


def summary():
    """Row counts by source type, for the docs and the final report."""
    counts = {}
    for path, column in ((HERB_USES_CSV, "herb"), (DRUG_INDICATIONS_CSV, "drug")):
        for row in read_rows(path) or []:
            if (row.get(column) or "").strip():
                source_type = (row.get("source_type") or "unknown").strip()
                counts[source_type] = counts.get(source_type, 0) + 1
    return counts


def main():
    parser = argparse.ArgumentParser(description="Validate the reference CSVs.")
    parser.parse_args()

    problems = validate()
    if problems:
        print(f"{len(problems)} problem(s) found:", file=sys.stderr)
        for problem in problems:
            print(f"  ! {problem}", file=sys.stderr)
        return 1

    counts = summary()
    print("Reference data is valid.")
    print(f"  knowledge rows by source_type: "
          f"{', '.join(f'{k}={v}' for k, v in sorted(counts.items()))}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
