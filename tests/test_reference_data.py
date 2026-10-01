"""Tests for the knowledge reference files and how the seeder loads them.

Two halves. The first drives hdi.validate_reference against the real files, so a
bad row fails here rather than somewhere less obvious. The second checks that a
deliberately broken file is actually *rejected*: a validator that passes
everything is worse than none, because it reads like a guarantee.
"""

import csv
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from hdi import db, knowledge, seed, topics, validate_reference

_TMPDIR = None
_DB = None
_SUMMARY = None


def setUpModule():
    global _TMPDIR, _DB, _SUMMARY
    _TMPDIR = tempfile.mkdtemp(prefix="hdi-reference-")
    _DB = Path(_TMPDIR) / "test.db"
    _SUMMARY = seed.build(db_path=_DB, verbose=False)


def tearDownModule():
    shutil.rmtree(_TMPDIR, ignore_errors=True)


class ValidateReferenceTest(unittest.TestCase):
    def test_the_shipped_reference_files_are_valid(self):
        problems = validate_reference.validate()
        self.assertEqual(problems, [], "\n".join(problems))

    def test_summary_counts_rows_by_source_type(self):
        counts = validate_reference.summary()
        self.assertEqual(sum(counts.values()), 48)
        self.assertEqual(
            set(counts), {"fetched_source", "repo_abstract", "general_knowledge"}
        )

    def test_every_knowledge_row_declares_a_source_type_and_note(self):
        for path, column in (
            (validate_reference.HERB_USES_CSV, "herb"),
            (validate_reference.DRUG_INDICATIONS_CSV, "drug"),
        ):
            for row in validate_reference.read_rows(path):
                where = f"{path.name}: {row[column]} / {row['condition_id']}"
                self.assertIn(row["source_type"], validate_reference.SOURCE_TYPES, where)
                self.assertTrue(row["source_note"].strip(), where)
                self.assertEqual(row["reviewed"].strip().lower(), "false", where)

    def test_fetched_rows_cite_the_label_they_came_from(self):
        """A fetched_source row must name the thing it was fetched from."""
        for row in validate_reference.read_rows(validate_reference.DRUG_INDICATIONS_CSV):
            if row["source_type"] == "fetched_source":
                self.assertIn("set_id", row["source_note"], row["drug"])

    def test_repo_abstract_rows_cite_a_pmid_present_in_the_corpus(self):
        """docs/PROJECT_SCOPE.md: no invented citations.

        Every PMID a herb_uses row cites must be one this project actually
        harvested, so a citation cannot be a plausible-looking number.
        """
        import json
        import re

        corpus = {
            record["pmid"]
            for record in json.loads(
                (Path(__file__).resolve().parent.parent
                 / "data" / "raw" / "raw_abstracts.json").read_text(encoding="utf-8")
            )
        }
        self.assertTrue(corpus)
        for row in validate_reference.read_rows(validate_reference.HERB_USES_CSV):
            if row["source_type"] != "repo_abstract":
                continue
            pmids = re.findall(r"PMID\s*([0-9]{5,9})", row["source_note"])
            self.assertTrue(
                pmids, f"{row['herb']}/{row['condition_id']} cites no PMID"
            )
            for pmid in pmids:
                self.assertIn(
                    pmid, corpus,
                    f"{row['herb']}/{row['condition_id']} cites PMID {pmid}, which is "
                    f"not in data/raw/raw_abstracts.json",
                )

    def test_general_knowledge_rows_say_why_they_are_not_sourced(self):
        for path, column in (
            (validate_reference.HERB_USES_CSV, "herb"),
            (validate_reference.DRUG_INDICATIONS_CSV, "drug"),
        ):
            for row in validate_reference.read_rows(path):
                if row["source_type"] == "general_knowledge":
                    note = row["source_note"].lower()
                    self.assertTrue(
                        "no " in note or "not " in note or "classical" in note,
                        f"{row[column]}/{row['condition_id']}: source_note does not "
                        f"explain the absence of a source ({row['source_note']!r})",
                    )


class ValidatorRejectsBadDataTest(unittest.TestCase):
    """The validator must actually fail on a broken file."""

    def _with_file(self, attribute, header, rows):
        tmpdir = Path(tempfile.mkdtemp(prefix="hdi-badref-"))
        self.addCleanup(shutil.rmtree, tmpdir, ignore_errors=True)
        path = tmpdir / "broken.csv"
        with open(path, "w", newline="", encoding="utf-8") as f:
            writer = csv.writer(f, lineterminator="\n")
            writer.writerow(header)
            writer.writerows(rows)
        return mock.patch.object(validate_reference, attribute, path)

    HERB_HEADER = [
        "herb", "condition_id", "traditional_use", "evidence_level", "pros", "cons",
        "cautions", "tags", "source_type", "source_note", "reviewed",
    ]

    def _herb_row(self, **overrides):
        row = {
            "herb": "Karela",
            "condition_id": "type_2_diabetes",
            "traditional_use": "Classical use for prameha.",
            "evidence_level": "clinical",
            "pros": "A plain pro sentence.",
            "cons": "A plain con sentence.",
            "cautions": "A plain caution sentence.",
            "tags": "hypoglycemic",
            "source_type": "repo_abstract",
            "source_note": "PMID 15521566",
            "reviewed": "false",
        }
        row.update(overrides)
        return [row[column] for column in self.HERB_HEADER]

    def _problems_with(self, **overrides):
        with self._with_file("HERB_USES_CSV", self.HERB_HEADER, [self._herb_row(**overrides)]):
            return validate_reference.validate()

    def assert_rejected(self, fragment, **overrides):
        problems = self._problems_with(**overrides)
        self.assertTrue(
            any(fragment in p for p in problems),
            f"expected a problem mentioning {fragment!r}; got {problems}",
        )

    def test_a_herb_outside_the_frozen_scope_is_rejected(self):
        self.assert_rejected("frozen reference tables", herb="Ginseng")

    def test_an_unknown_condition_is_rejected(self):
        self.assert_rejected("unknown condition_id", condition_id="insomnia")

    def test_a_tag_outside_the_vocabulary_is_rejected(self):
        self.assert_rejected("tag_vocabulary", tags="hypoglycaemic")

    def test_empty_pros_are_rejected(self):
        self.assert_rejected("pros is empty", pros="")

    def test_empty_cons_are_rejected(self):
        self.assert_rejected("cons is empty", cons="")

    def test_a_row_marked_reviewed_is_rejected(self):
        self.assert_rejected("reviewed", reviewed="true")

    def test_an_over_long_pro_is_rejected(self):
        self.assert_rejected("words, limit 20", pros=" ".join(["word"] * 21))

    def test_a_dose_in_a_field_is_rejected(self):
        self.assert_rejected("dose", pros="Take 500 mg of the powder.")

    def test_a_dosing_frequency_is_rejected(self):
        self.assert_rejected("dosing frequency", cautions="Use it twice a day.")

    def test_a_safety_claim_is_rejected(self):
        self.assert_rejected("safe", cons="This one is completely safe.")

    def test_a_brand_name_in_a_field_is_rejected(self):
        self.assert_rejected("brand name", pros="Works as well as Glucophage does.")

    def test_a_bad_source_type_is_rejected(self):
        self.assert_rejected("source_type", source_type="internet")

    def test_an_empty_source_note_is_rejected(self):
        self.assert_rejected("source_note is empty", source_note="")

    def test_a_condition_with_no_conventional_option_is_rejected(self):
        """An in-scope condition we cannot answer must fail the build."""
        header = [
            "drug", "condition_id", "what_its_for", "pros", "cons",
            "common_side_effects", "cautions", "tags", "source_type", "source_note",
            "reviewed",
        ]
        row = [
            "Metformin", "type_2_diabetes", "Lowering blood sugar.", "A pro.", "A con.",
            "nausea", "A caution.", "hypoglycemic", "general_knowledge",
            "no label was fetched for this row", "false",
        ]
        with self._with_file("DRUG_INDICATIONS_CSV", header, [row]):
            problems = validate_reference.validate()
        self.assertTrue(
            any("offers no conventional option" in p for p in problems), problems
        )


class SeededKnowledgeTest(unittest.TestCase):
    def setUp(self):
        self.conn = db.connect(_DB, read_only=True)
        self.addCleanup(self.conn.close)

    def test_the_seed_reported_no_problems(self):
        self.assertEqual(_SUMMARY["problems"], [])

    def test_conditions_and_uses_are_loaded(self):
        self.assertEqual(_SUMMARY["conditions"], 6)
        self.assertEqual(_SUMMARY["medicine_uses"], 48)
        self.assertEqual(_SUMMARY["combination_rules"], 36)

    def test_frozen_scope_is_still_exactly_the_reference_tables(self):
        """Adding knowledge must not add a medicine."""
        counts = {
            r["medicine_type"]: r["n"]
            for r in self.conn.execute(
                "SELECT medicine_type, COUNT(*) AS n FROM medicines GROUP BY medicine_type"
            )
        }
        self.assertEqual(counts, {"herb": 40, "drug": 13})

    def test_every_use_row_points_at_a_real_medicine_and_condition(self):
        orphans = self.conn.execute(
            "SELECT COUNT(*) AS n FROM medicine_uses u "
            "LEFT JOIN medicines m ON m.id = u.medicine_id "
            "LEFT JOIN conditions c ON c.condition_id = u.condition_id "
            "WHERE m.id IS NULL OR c.condition_id IS NULL"
        ).fetchone()["n"]
        self.assertEqual(orphans, 0)

    def test_nothing_is_marked_reviewed(self):
        reviewed = self.conn.execute(
            "SELECT COUNT(*) AS n FROM medicine_uses WHERE reviewed != 0"
        ).fetchone()["n"]
        self.assertEqual(reviewed, 0)

    def test_every_tag_is_in_the_vocabulary(self):
        unknown = self.conn.execute(
            "SELECT COUNT(*) AS n FROM medicine_tags t "
            "LEFT JOIN tag_vocabulary v ON v.tag = t.tag WHERE v.tag IS NULL"
        ).fetchone()["n"]
        self.assertEqual(unknown, 0)

    def test_tags_are_the_union_across_a_medicines_uses(self):
        """Garlic is recorded for four conditions with different tag lists.

        A tag describes the substance, so the medicine carries the union.
        """
        tags = knowledge.tags_for(self.conn, "herb-garlic")
        self.assertEqual(
            tags, {"antiplatelet", "hypotensive", "hypoglycemic", "cyp_inducer"}
        )

    def test_class_tags_are_the_intersection_not_the_union(self):
        """A caution against a class must hold for every member of it.

        Every anticoagulant-class drug is either antiplatelet or anticoagulant,
        but not all four share either tag, so the intersection is empty and no
        class-level caution is raised rather than a wrong one.
        """
        shared = knowledge.tags_for_class(self.conn, "Antidiabetics")
        self.assertEqual(shared, {"hypoglycemic"})
        for medicine_id in ("drug-metformin", "drug-insulin", "drug-glimepiride",
                            "drug-pioglitazone"):
            self.assertIn("hypoglycemic", knowledge.tags_for(self.conn, medicine_id))

    def test_brand_aliases_are_loaded_and_resolve(self):
        from hdi import catalog

        n_brands = self.conn.execute(
            "SELECT COUNT(*) AS n FROM medicine_aliases WHERE alias_type = 'brand_name'"
        ).fetchone()["n"]
        self.assertEqual(n_brands, 49)
        for brand, expected in (
            ("Glycomet", "drug-metformin"),
            ("Ecosprin", "drug-aspirin"),
            ("Lanoxin", "drug-digoxin"),
            ("Norvasc", "drug-amlodipine"),
            ("Lantus", "drug-insulin"),
        ):
            resolved, error = catalog.resolve_medicine(self.conn, brand)
            self.assertIsNone(error, brand)
            self.assertEqual(resolved, expected, brand)

    def test_class_aliases_resolve(self):
        from hdi import catalog

        for alias, expected in (
            ("blood thinner", "Anticoagulants"),
            ("sugar ki dawa", "Antidiabetics"),
            ("bp medicine", "Cardiovascular"),
            ("khoon patla karne ki dawa", "Anticoagulants"),
        ):
            self.assertEqual(catalog.resolve_drug_class(self.conn, alias), expected, alias)

    def test_a_medicine_name_is_not_downgraded_to_its_class(self):
        from hdi import catalog

        resolved, error = catalog.resolve_medicine(self.conn, "Warfarin")
        self.assertIsNone(error)
        self.assertEqual(resolved, "drug-warfarin")


class HealthTopicTest(unittest.TestCase):
    """The pre-existing topic endpoints must now return real data."""

    def setUp(self):
        self.conn = db.connect(_DB, read_only=True)
        self.addCleanup(self.conn.close)

    def test_topic_data_is_now_populated(self):
        self.assertTrue(topics.has_topic_data(self.conn))
        self.assertEqual(len(topics.list_topics(self.conn)), 6)

    def test_lookup_by_the_condition_name(self):
        payload, error = topics.lookup_topic(self.conn, "Type 2 diabetes")
        self.assertIsNone(error)
        self.assertEqual(payload["status"], topics.STATUS_FOUND)
        self.assertTrue(payload["conventional_use"])
        self.assertTrue(payload["evidence_supported_use"])

    def test_lookup_by_a_lay_synonym(self):
        for wording in ("sugar", "sugar ki bimari", "madhumeh", "high blood sugar"):
            payload, error = topics.lookup_topic(self.conn, wording)
            self.assertIsNone(error, wording)
            self.assertEqual(payload["status"], topics.STATUS_FOUND, wording)
            names = [e["medicine"]["name"] for e in payload["conventional_use"]]
            self.assertIn("Metformin", names, wording)

    def test_use_types_keep_tradition_separate_from_evidence(self):
        payload, _ = topics.lookup_topic(self.conn, "High blood pressure")
        conventional = {e["medicine"]["name"] for e in payload["conventional_use"]}
        traditional = {e["medicine"]["name"] for e in payload["traditional_use"]}
        supported = {e["medicine"]["name"] for e in payload["evidence_supported_use"]}

        # Drugs are conventional use only; a traditional-only herb never appears
        # as evidence-supported.
        self.assertIn("Amlodipine", conventional)
        self.assertIn("Sarpagandha", traditional)
        self.assertIn("Garlic", supported)
        self.assertFalse(conventional & traditional)
        self.assertFalse(traditional & supported)

    def test_traditional_rows_are_graded_traditional(self):
        payload, _ = topics.lookup_topic(self.conn, "High blood pressure")
        for entry in payload["traditional_use"]:
            self.assertEqual(entry["evidence_level"], "traditional", entry["medicine"]["name"])

    def test_preclinical_evidence_is_not_graded_above_insufficient(self):
        """Animal work is not grounds for a human claim, however clean it is."""
        rows = self.conn.execute(
            "SELECT t.evidence_level, u.evidence_level AS use_level "
            "FROM health_topic_map t "
            "JOIN conditions c ON c.normalized_name = t.normalized_topic "
            "JOIN medicine_uses u ON u.medicine_id = t.medicine_id "
            "                    AND u.condition_id = c.condition_id "
            "WHERE u.evidence_level = 'preclinical'"
        ).fetchall()
        self.assertTrue(rows)
        for row in rows:
            self.assertEqual(row["evidence_level"], "insufficient")

    def test_an_unknown_topic_is_not_found_rather_than_empty(self):
        payload, _ = topics.lookup_topic(self.conn, "hair loss")
        self.assertEqual(payload["status"], topics.STATUS_NOT_FOUND)


class ReproducibilityTest(unittest.TestCase):
    def test_seeding_twice_produces_the_same_knowledge_rows(self):
        def snapshot(path):
            conn = db.connect(path, read_only=True)
            try:
                return {
                    table: list(conn.execute(f"SELECT * FROM {table} ORDER BY rowid"))
                    for table in ("conditions", "condition_synonyms", "tag_vocabulary",
                                  "medicine_tags", "combination_rules", "class_aliases")
                }
            finally:
                conn.close()

        tmpdir = Path(tempfile.mkdtemp(prefix="hdi-repeat-"))
        self.addCleanup(shutil.rmtree, tmpdir, ignore_errors=True)
        first, second = tmpdir / "a.db", tmpdir / "b.db"
        seed.build(db_path=first, verbose=False)
        seed.build(db_path=second, verbose=False)

        a, b = snapshot(first), snapshot(second)
        for table in a:
            self.assertEqual(
                [tuple(r) for r in a[table]], [tuple(r) for r in b[table]], table
            )


if __name__ == "__main__":
    unittest.main()
