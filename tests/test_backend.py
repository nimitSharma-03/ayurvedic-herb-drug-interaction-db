"""Backend tests: seeding, catalog, interaction lookup, topics, API and security.

Tests run against a database seeded from the project's real curated corpus (a
temporary copy, built once for the module), not a hand-made fixture. That way a
regression in how real curator verdicts map onto result states fails here.
"""

import json
import shutil
import sqlite3
import sys
import tempfile
import threading
import unittest
from http.client import HTTPConnection
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from hdi import api, catalog, db, interactions, seed, topics

_TMPDIR = None
_DB = None
_SUMMARY = None


def setUpModule():
    global _TMPDIR, _DB, _SUMMARY
    _TMPDIR = tempfile.mkdtemp(prefix="hdi-test-")
    _DB = Path(_TMPDIR) / "test.db"
    _SUMMARY = seed.build(db_path=_DB, verbose=False)


def tearDownModule():
    shutil.rmtree(_TMPDIR, ignore_errors=True)


class BackendTestCase(unittest.TestCase):
    """Shared read-only connection plus an API helper bound to the test database."""

    def setUp(self):
        self.conn = db.connect(_DB, read_only=True)
        self.addCleanup(self.conn.close)

    def get(self, path, **params):
        return api.handle("GET", path, {k: [str(v)] for k, v in params.items()}, db_path=_DB)

    def post(self, path, body):
        return api.handle("POST", path, {}, body, db_path=_DB)


class SeedTest(BackendTestCase):
    def test_frozen_scope_is_respected(self):
        """The catalog holds exactly the frozen reference tables, nothing added.

        docs/PROJECT_SCOPE.md freezes scope at herbs.csv and drug_classes.csv; a medicine
        appearing here that is not in those files would mean invented data.
        """
        counts = {
            r["medicine_type"]: r["n"]
            for r in self.conn.execute(
                "SELECT medicine_type, COUNT(*) AS n FROM medicines GROUP BY medicine_type"
            )
        }
        self.assertEqual(counts, {"herb": 40, "drug": 13})

    def test_every_interaction_pair_is_in_corpus(self):
        self.assertEqual(
            self.conn.execute("SELECT COUNT(*) AS n FROM interactions").fetchone()["n"], 520
        )

    def test_result_states_come_from_curator_verdicts(self):
        states = {
            r["status"]: r["n"]
            for r in self.conn.execute(
                "SELECT status, COUNT(*) AS n FROM interactions GROUP BY status"
            )
        }
        self.assertEqual(states["interaction_found"], 10)
        self.assertEqual(states["insufficient_evidence"], 3)
        self.assertEqual(states["no_documented_interaction"], 507)

    def test_no_curated_evidence_row_is_dropped(self):
        """All 84 curated rows survive seeding, with their verdicts intact."""
        verdicts = {
            r["verdict"]: r["n"]
            for r in self.conn.execute(
                "SELECT verdict, COUNT(*) AS n FROM interaction_evidence GROUP BY verdict"
            )
        }
        self.assertEqual(verdicts, {"confirmed": 28, "rejected": 52, "unclear": 4})

    def test_only_confirmed_evidence_is_marked_human_verified(self):
        """docs/PROJECT_SCOPE.md: auto-extracted rows are never marked verified."""
        leaked = self.conn.execute(
            "SELECT COUNT(*) AS n FROM interaction_evidence "
            "WHERE confidence = 'human_verified' AND verdict != 'confirmed'"
        ).fetchone()["n"]
        self.assertEqual(leaked, 0)

    def test_every_evidence_row_cites_a_pmid(self):
        """docs/PROJECT_SCOPE.md: every interaction record must cite a PMID."""
        missing = self.conn.execute(
            "SELECT COUNT(*) AS n FROM interaction_evidence "
            "WHERE pmid IS NULL OR TRIM(pmid) = ''"
        ).fetchone()["n"]
        self.assertEqual(missing, 0)

    def test_documented_interactions_carry_human_verified_evidence(self):
        for row in self.conn.execute(
            "SELECT id FROM interactions WHERE status = 'interaction_found'"
        ):
            n = self.conn.execute(
                "SELECT COUNT(*) AS n FROM interaction_evidence "
                "WHERE interaction_id = ? AND confidence = 'human_verified'",
                (row["id"],),
            ).fetchone()["n"]
            self.assertGreater(n, 0, f"{row['id']} is documented but has no curated evidence")

    def test_clinical_fields_are_null_not_invented(self):
        """No mechanism, significance or recommendation is generated.

        Abstract-level mining does not establish these, so they must stay NULL
        rather than be filled with plausible-sounding text.
        """
        row = self.conn.execute(
            "SELECT COUNT(*) AS n FROM interactions WHERE mechanism IS NOT NULL "
            "OR clinical_significance IS NOT NULL OR recommended_action IS NOT NULL"
        ).fetchone()
        self.assertEqual(row["n"], 0)

    def test_seed_reports_no_data_problems(self):
        self.assertEqual(_SUMMARY["problems"], [])
        self.assertEqual(_SUMMARY["collisions"], [])

    def test_seeding_is_reproducible(self):
        """A second build over unchanged inputs yields identical content."""
        second = Path(_TMPDIR) / "second.db"
        seed.build(db_path=second, verbose=False)
        try:
            other = db.connect(second, read_only=True)
            try:
                for table in ("medicines", "medicine_aliases", "interactions",
                              "interaction_evidence"):
                    a = self.conn.execute(f"SELECT * FROM {table} ORDER BY 1, 2").fetchall()
                    b = other.execute(f"SELECT * FROM {table} ORDER BY 1, 2").fetchall()
                    self.assertEqual([tuple(r) for r in a], [tuple(r) for r in b], table)
            finally:
                other.close()
        finally:
            second.unlink(missing_ok=True)


class OrderIndependenceConstraintTest(unittest.TestCase):
    """The database itself must make a reversed duplicate impossible to store."""

    def setUp(self):
        self.conn = db.connect(_DB)
        self.addCleanup(self.conn.close)

    def test_reversed_duplicate_violates_constraints(self):
        row = self.conn.execute(
            "SELECT * FROM interactions WHERE status = 'interaction_found' LIMIT 1"
        ).fetchone()
        with self.assertRaises(sqlite3.IntegrityError):
            self.conn.execute(
                "INSERT INTO interactions (id, medicine_a_id, medicine_b_id, pair_key, "
                "pair_kind, status) VALUES (?, ?, ?, ?, ?, ?)",
                (
                    "int-reversed-duplicate",
                    row["medicine_b_id"],   # deliberately reversed
                    row["medicine_a_id"],
                    row["pair_key"],
                    row["pair_kind"],
                    row["status"],
                ),
            )
        self.conn.rollback()

    def test_same_pair_key_cannot_be_inserted_twice(self):
        row = self.conn.execute("SELECT * FROM interactions LIMIT 1").fetchone()
        with self.assertRaises(sqlite3.IntegrityError):
            self.conn.execute(
                "INSERT INTO interactions (id, medicine_a_id, medicine_b_id, pair_key, "
                "pair_kind, status) VALUES (?, ?, ?, ?, ?, ?)",
                ("int-dupe", row["medicine_a_id"], row["medicine_b_id"], row["pair_key"],
                 row["pair_kind"], row["status"]),
            )
        self.conn.rollback()


class MedicineSearchTest(BackendTestCase):
    def _names(self, payload):
        return [r["name"] for r in payload["results"]]

    def test_search_ayurvedic_medicine(self):
        status, payload = self.get("/medicines/search", q="Ashwagandha")
        self.assertEqual(status, 200)
        self.assertIn("Ashwagandha", self._names(payload))
        self.assertEqual(payload["results"][0]["category"], "ayurvedic")
        self.assertEqual(payload["results"][0]["matched_on"], "exact_name")

    def test_search_allopathic_medicine(self):
        status, payload = self.get("/medicines/search", q="Metformin")
        self.assertEqual(status, 200)
        top = payload["results"][0]
        self.assertEqual(top["name"], "Metformin")
        self.assertEqual(top["category"], "allopathic")
        self.assertEqual(top["drug_class"], "Antidiabetics")

    def test_search_is_case_insensitive(self):
        for query in ("turmeric", "TURMERIC", "  Turmeric  "):
            status, payload = self.get("/medicines/search", q=query)
            self.assertEqual(status, 200)
            self.assertIn("Turmeric", self._names(payload))

    def test_search_out_of_scope_medicine_returns_nothing(self):
        """Paracetamol is outside the frozen reference tables.

        The correct answer is an empty result, not a fabricated record. This is
        the guard against inventing a medicine the project has no data for.
        """
        status, payload = self.get("/medicines/search", q="Paracetamol")
        self.assertEqual(status, 200)
        self.assertEqual(payload["count"], 0)
        self.assertEqual(payload["results"], [])

    def test_search_by_alias(self):
        status, payload = self.get("/medicines/search", q="Indian Ginseng")
        self.assertEqual(status, 200)
        self.assertEqual(payload["results"][0]["name"], "Ashwagandha")
        self.assertEqual(payload["results"][0]["matched_on"], "exact_alias")

    def test_search_by_scientific_name(self):
        status, payload = self.get("/medicines/search", q="Withania somnifera")
        self.assertEqual(status, 200)
        self.assertEqual(payload["results"][0]["name"], "Ashwagandha")

    def test_search_by_generic_name_and_active_ingredient(self):
        status, payload = self.get("/medicines/search", q="Warfarin")
        self.assertEqual(status, 200)
        top = payload["results"][0]
        self.assertEqual(top["generic_name"], "Warfarin")

    def test_search_by_hyphenated_botanical_name(self):
        status, payload = self.get("/medicines/search", q="Trigonella foenum-graecum")
        self.assertEqual(status, 200)
        self.assertEqual(payload["results"][0]["name"], "Fenugreek")

    def test_category_filter_restricts_results(self):
        status, payload = self.get("/medicines/search", q="a", category="allopathic")
        self.assertEqual(status, 200)
        self.assertTrue(payload["results"])
        for result in payload["results"]:
            self.assertEqual(result["category"], "allopathic")

    def test_exact_match_outranks_substring_match(self):
        status, payload = self.get("/medicines/search", q="Amla")
        self.assertEqual(status, 200)
        # "Bhumi Amla" also contains "amla"; the exact hit must come first.
        self.assertEqual(payload["results"][0]["name"], "Amla")
        self.assertIn("Bhumi Amla", self._names(payload))

    def test_limit_is_honoured(self):
        status, payload = self.get("/medicines/search", q="a", limit=3)
        self.assertEqual(status, 200)
        self.assertLessEqual(len(payload["results"]), 3)


class MedicineDetailTest(BackendTestCase):
    def test_ayurvedic_detail_separates_tradition_from_evidence(self):
        status, payload = self.get("/medicines/herb-ashwagandha")
        self.assertEqual(status, 200)
        self.assertEqual(payload["category"], "ayurvedic")
        self.assertEqual(payload["scientific_name"], "Withania somnifera")
        # traditional_uses and common_uses are separate keys, so traditional
        # claims can never be read as clinically established ones.
        self.assertIn("traditional_uses", payload)
        self.assertIn("common_uses", payload)
        self.assertIsNot(payload["traditional_uses"], payload["common_uses"])

    def test_ayurvedic_detail_lists_real_aliases(self):
        _, payload = self.get("/medicines/herb-ashwagandha")
        aliases = {a["alias"] for a in payload["aliases"]}
        self.assertIn("Indian Ginseng", aliases)
        self.assertIn("Withania somnifera", aliases)

    def test_allopathic_detail(self):
        status, payload = self.get("/medicines/drug-warfarin")
        self.assertEqual(status, 200)
        self.assertEqual(payload["category"], "allopathic")
        self.assertEqual(payload["generic_name"], "Warfarin")
        self.assertEqual(payload["active_ingredients"], ["Warfarin"])
        self.assertEqual(payload["drug_class"], "Anticoagulants")

    def test_detail_reports_source_metadata(self):
        _, payload = self.get("/medicines/herb-garlic")
        self.assertTrue(payload["sources"])
        source = payload["sources"][0]
        self.assertIn("herbs.csv", source["source"])
        self.assertRegex(source["last_verified"], r"^\d{4}-\d{2}-\d{2}$")

    def test_undocumented_fields_are_flagged_not_silently_empty(self):
        """An empty contraindication list must not read as 'has none'."""
        _, payload = self.get("/medicines/herb-garlic")
        completeness = payload["data_completeness"]
        self.assertIn("contraindications", completeness["undocumented_fields"])
        self.assertIn("no information was available", completeness["note"])

    def test_internal_columns_are_not_exposed(self):
        _, payload = self.get("/medicines/herb-garlic")
        for internal in ("normalized_name", "pair_key"):
            self.assertNotIn(internal, payload)

    def test_unknown_id_is_not_found(self):
        status, payload = self.get("/medicines/herb-does-not-exist")
        self.assertEqual(status, 404)
        self.assertEqual(payload["error"]["code"], "medicine_not_found")


class InteractionCheckTest(BackendTestCase):
    def test_ayurvedic_allopathic_documented_interaction(self):
        status, payload = self.get(
            "/interactions/check", medicine_a="Garlic", medicine_b="Warfarin"
        )
        self.assertEqual(status, 200)
        self.assertEqual(payload["status"], "interaction_found")
        self.assertIs(payload["interaction_found"], True)
        self.assertEqual(payload["pair_kind"], "ayurvedic_allopathic")
        self.assertIn(payload["severity"], ("major", "moderate", "minor"))
        self.assertEqual(payload["severity_basis"], db.SEVERITY_BASIS_DERIVED)
        self.assertIn(payload["evidence_level"], db.EVIDENCE_LEVELS)
        self.assertTrue(payload["evidence"])
        for item in payload["evidence"]:
            self.assertTrue(item["pmid"])
            self.assertTrue(item["source_url"].endswith(f"/{item['pmid']}/"))

    def test_reverse_order_returns_the_same_interaction(self):
        _, forward = self.get("/interactions/check", medicine_a="Garlic", medicine_b="Warfarin")
        _, reverse = self.get("/interactions/check", medicine_a="Warfarin", medicine_b="Garlic")

        for field in ("id", "status", "severity", "interaction_type", "evidence_level",
                      "description", "pair_kind"):
            self.assertEqual(forward[field], reverse[field], field)
        self.assertEqual(
            sorted(e["pmid"] for e in forward["evidence"]),
            sorted(e["pmid"] for e in reverse["evidence"]),
        )
        # The response echoes the order the caller asked in.
        self.assertEqual(forward["medicine_a"]["name"], "Garlic")
        self.assertEqual(reverse["medicine_a"]["name"], "Warfarin")

    def test_every_documented_pair_is_order_independent(self):
        for row in self.conn.execute(
            "SELECT medicine_a_id, medicine_b_id, id FROM interactions "
            "WHERE status = 'interaction_found'"
        ):
            _, forward = self.get(
                "/interactions/check",
                medicine_a=row["medicine_a_id"], medicine_b=row["medicine_b_id"],
            )
            _, reverse = self.get(
                "/interactions/check",
                medicine_a=row["medicine_b_id"], medicine_b=row["medicine_a_id"],
            )
            self.assertEqual(forward["id"], row["id"])
            self.assertEqual(forward["id"], reverse["id"])
            self.assertEqual(forward["severity"], reverse["severity"])

    def test_ayurvedic_ayurvedic_pair_is_supported_but_unevidenced(self):
        status, payload = self.get(
            "/interactions/check", medicine_a="Turmeric", medicine_b="Ginger"
        )
        self.assertEqual(status, 200)
        self.assertEqual(payload["pair_kind"], "ayurvedic_ayurvedic")
        self.assertEqual(payload["status"], "insufficient_evidence")
        self.assertIsNone(payload["interaction_found"])
        self.assertIn("outside the harvested literature corpus", payload["evidence_basis"])

    def test_allopathic_allopathic_pair_is_supported_but_unevidenced(self):
        status, payload = self.get(
            "/interactions/check", medicine_a="Warfarin", medicine_b="Aspirin"
        )
        self.assertEqual(status, 200)
        self.assertEqual(payload["pair_kind"], "allopathic_allopathic")
        self.assertEqual(payload["status"], "insufficient_evidence")
        self.assertIsNone(payload["interaction_found"])

    def test_no_documented_interaction_is_never_phrased_as_safe(self):
        """The central safety requirement of this layer."""
        status, payload = self.get(
            "/interactions/check", medicine_a="Ashwagandha", medicine_b="Warfarin"
        )
        self.assertEqual(status, 200)
        self.assertEqual(payload["status"], "no_documented_interaction")
        self.assertIs(payload["interaction_found"], False)
        self.assertEqual(payload["severity"], "none_documented")
        self.assertIn(
            "No documented interaction was found in the available sources",
            payload["description"],
        )
        self.assertNotIn("safe", payload["description"].lower())
        self.assertIn("not evidence of safety", payload["disclaimer"])

    def test_insufficient_evidence_is_not_collapsed_into_no_interaction(self):
        row = self.conn.execute(
            "SELECT medicine_a_id, medicine_b_id FROM interactions "
            "WHERE status = 'insufficient_evidence' LIMIT 1"
        ).fetchone()
        status, payload = self.get(
            "/interactions/check",
            medicine_a=row["medicine_a_id"], medicine_b=row["medicine_b_id"],
        )
        self.assertEqual(status, 200)
        self.assertEqual(payload["status"], "insufficient_evidence")
        self.assertIsNone(payload["interaction_found"])
        self.assertEqual(payload["evidence_level"], "insufficient")
        self.assertNotIn("safe", payload["description"].lower())

    def test_no_response_claims_safety(self):
        pairs = [
            ("Garlic", "Warfarin"),
            ("Ashwagandha", "Warfarin"),
            ("Turmeric", "Ginger"),
            ("Warfarin", "Aspirin"),
        ]
        for a, b in pairs:
            _, payload = self.get("/interactions/check", medicine_a=a, medicine_b=b)
            for field in ("description", "clinical_significance", "recommended_action"):
                value = payload.get(field)
                if value:
                    self.assertNotIn("safe", value.lower(), f"{a}+{b} {field}")

    def test_unknown_medicine_returns_medicine_not_found(self):
        status, payload = self.get(
            "/interactions/check", medicine_a="Ibuprofen", medicine_b="Warfarin"
        )
        self.assertEqual(status, 404)
        self.assertEqual(payload["status"], "medicine_not_found")
        self.assertEqual(payload["error"]["side"], "medicine_a")

    def test_unknown_second_medicine_reports_which_side_failed(self):
        status, payload = self.get(
            "/interactions/check", medicine_a="Garlic", medicine_b="Ginkgo"
        )
        self.assertEqual(status, 404)
        self.assertEqual(payload["error"]["side"], "medicine_b")

    def test_alias_resolves_in_interaction_check(self):
        _, by_name = self.get("/interactions/check", medicine_a="Turmeric", medicine_b="Metformin")
        _, by_alias = self.get("/interactions/check", medicine_a="Haldi", medicine_b="Metformin")
        self.assertEqual(by_name["id"], by_alias["id"])
        self.assertEqual(by_alias["medicine_a"]["name"], "Turmeric")

    def test_same_medicine_twice_is_rejected(self):
        status, payload = self.get(
            "/interactions/check", medicine_a="Garlic", medicine_b="Garlic"
        )
        self.assertEqual(status, 400)
        self.assertEqual(payload["error"]["code"], "identical_medicine")

    def test_same_medicine_via_alias_is_rejected(self):
        """Lashuna is Garlic's Sanskrit synonym, so this is still one substance."""
        status, payload = self.get(
            "/interactions/check", medicine_a="Garlic", medicine_b="Lashuna"
        )
        self.assertEqual(status, 400)
        self.assertEqual(payload["error"]["code"], "identical_medicine")

    def test_check_accepts_ids_as_well_as_names(self):
        status, payload = self.get(
            "/interactions/check", medicine_a="herb-garlic", medicine_b="drug-warfarin"
        )
        self.assertEqual(status, 200)
        self.assertEqual(payload["status"], "interaction_found")

    def test_post_check_matches_get_check(self):
        _, via_get = self.get("/interactions/check", medicine_a="Garlic", medicine_b="Warfarin")
        status, via_post = self.post(
            "/interactions/check", {"medicine_a": "Garlic", "medicine_b": "Warfarin"}
        )
        self.assertEqual(status, 200)
        self.assertEqual(via_get["id"], via_post["id"])


class MedicineInteractionsListTest(BackendTestCase):
    def test_lists_documented_interactions_for_a_herb(self):
        status, payload = self.get(
            "/medicines/herb-garlic/interactions", status="interaction_found"
        )
        self.assertEqual(status, 200)
        self.assertEqual(payload["count"], 1)
        self.assertEqual(payload["results"][0]["medicine_b"]["name"], "Warfarin")

    def test_answers_which_herbs_interact_with_a_drug(self):
        """'What Ayurvedic herbs have documented interactions with Warfarin?'"""
        status, payload = self.get(
            "/medicines/drug-warfarin/interactions",
            category="ayurvedic", status="interaction_found",
        )
        self.assertEqual(status, 200)
        names = {r["medicine_b"]["name"] for r in payload["results"]}
        self.assertEqual(names, {"Garlic", "Pippali"})
        for result in payload["results"]:
            self.assertEqual(result["medicine_b"]["category"], "ayurvedic")

    def test_answers_which_drugs_interact_with_a_herb(self):
        status, payload = self.get(
            "/medicines/herb-turmeric/interactions",
            category="allopathic", status="interaction_found",
        )
        self.assertEqual(status, 200)
        self.assertTrue(payload["results"])
        for result in payload["results"]:
            self.assertEqual(result["medicine_b"]["category"], "allopathic")

    def test_counts_cover_every_status(self):
        _, payload = self.get("/medicines/herb-garlic/interactions")
        self.assertEqual(sum(payload["counts"].values()), payload["count"])

    def test_documented_results_are_ordered_first(self):
        _, payload = self.get("/medicines/drug-warfarin/interactions")
        statuses = [r["status"] for r in payload["results"]]
        self.assertEqual(statuses[0], "interaction_found")

    def test_evidence_is_omitted_unless_requested(self):
        _, without = self.get(
            "/medicines/herb-garlic/interactions", status="interaction_found"
        )
        _, with_evidence = self.get(
            "/medicines/herb-garlic/interactions",
            status="interaction_found", include_evidence="true",
        )
        self.assertEqual(without["results"][0]["evidence"], [])
        self.assertTrue(with_evidence["results"][0]["evidence"])

    def test_unknown_medicine_id(self):
        status, payload = self.get("/medicines/herb-nope/interactions")
        self.assertEqual(status, 404)
        self.assertEqual(payload["error"]["code"], "medicine_not_found")

    def test_documented_endpoint_covers_all_pair_kinds(self):
        status, payload = self.get("/interactions/documented")
        self.assertEqual(status, 200)
        self.assertEqual(payload["count"], 10)
        for result in payload["results"]:
            self.assertEqual(result["status"], "interaction_found")

    def test_documented_endpoint_filters_by_pair_kind(self):
        status, payload = self.get(
            "/interactions/documented", pair_kind="ayurvedic_allopathic"
        )
        self.assertEqual(status, 200)
        self.assertEqual(payload["count"], 10)
        status, payload = self.get(
            "/interactions/documented", pair_kind="allopathic_allopathic"
        )
        self.assertEqual(payload["count"], 0)


class HealthTopicTest(BackendTestCase):
    def test_topic_listing_reports_absence_of_data(self):
        status, payload = self.get("/health-topics")
        self.assertEqual(status, 200)
        self.assertFalse(payload["has_topic_data"])
        self.assertEqual(payload["topics"], [])

    def test_topic_lookup_reports_no_data_rather_than_an_empty_answer(self):
        """Absence of indication data must not read as 'nothing applies'."""
        status, payload = self.get("/health-topics/lookup", topic="joint pain")
        self.assertEqual(status, 200)
        self.assertEqual(payload["status"], topics.STATUS_NO_DATA)
        self.assertIn("health_topics.csv", payload["note"])
        self.assertEqual(payload["traditional_use"], [])

    def test_topic_response_separates_use_types(self):
        _, payload = self.get("/health-topics/lookup", topic="joint pain")
        for key in ("conventional_use", "traditional_use", "evidence_supported_use"):
            self.assertIn(key, payload)

    def test_topic_disclaimer_rules_out_recommendation(self):
        _, payload = self.get("/health-topics/lookup", topic="joint pain")
        self.assertIn("not treatment recommendations", payload["disclaimer"])
        self.assertIn("no dosage guidance", payload["disclaimer"])

    def test_missing_topic_parameter(self):
        status, payload = self.get("/health-topics/lookup")
        self.assertEqual(status, 400)
        self.assertEqual(payload["error"]["code"], "missing_parameter")


class ValidationTest(BackendTestCase):
    def test_search_requires_a_query(self):
        status, payload = self.get("/medicines/search")
        self.assertEqual(status, 400)
        self.assertEqual(payload["error"]["code"], "missing_parameter")

    def test_blank_search_query_is_rejected(self):
        status, payload = self.get("/medicines/search", q="   ")
        self.assertEqual(status, 400)

    def test_punctuation_only_query_returns_no_results(self):
        status, payload = self.get("/medicines/search", q="!!!")
        self.assertEqual(status, 200)
        self.assertEqual(payload["count"], 0)

    def test_check_requires_both_medicines(self):
        for params in ({"medicine_a": "Garlic"}, {"medicine_b": "Warfarin"}, {}):
            status, payload = api.handle(
                "GET", "/interactions/check",
                {k: [v] for k, v in params.items()}, db_path=_DB,
            )
            self.assertEqual(status, 400)
            self.assertEqual(payload["error"]["code"], "missing_parameter")

    def test_malformed_limit_is_rejected(self):
        for bad in ("abc", "1.5", "-1", "0", "99999"):
            status, _ = self.get("/medicines/search", q="Amla", limit=bad)
            self.assertEqual(status, 400, f"limit={bad!r}")

    def test_blank_optional_parameter_falls_back_to_its_default(self):
        """An empty optional parameter means "not supplied", unlike a required one."""
        status, payload = self.get("/medicines/search", q="Amla", limit="")
        self.assertEqual(status, 200)
        self.assertTrue(payload["results"])

    def test_invalid_category_is_rejected(self):
        status, payload = self.get("/medicines/search", q="Amla", category="homeopathic")
        self.assertEqual(status, 400)
        self.assertEqual(payload["error"]["code"], "invalid_parameter")

    def test_invalid_status_filter_is_rejected(self):
        status, payload = self.get("/medicines/herb-garlic/interactions", status="maybe")
        self.assertEqual(status, 400)

    def test_invalid_pair_kind_is_rejected(self):
        status, payload = self.get("/interactions/documented", pair_kind="herb_herb")
        self.assertEqual(status, 400)

    def test_unknown_route_is_404(self):
        for path in ("/nope", "/medicines/x/y/z", "/interactions/nope", "/health-topics/nope"):
            status, payload = self.get(path)
            self.assertEqual(status, 404, path)
            self.assertIn("error", payload)

    def test_method_not_allowed(self):
        status, payload = api.handle("DELETE", "/medicines", {}, db_path=_DB)
        self.assertEqual(status, 405)
        self.assertEqual(payload["error"]["code"], "method_not_allowed")

    def test_post_body_must_be_an_object(self):
        for body in ("string", 42, ["a", "b"], None):
            status, payload = self.post("/interactions/check", body)
            self.assertEqual(status, 400, repr(body))

    def test_missing_database_reports_unavailable(self):
        status, payload = api.handle(
            "GET", "/medicines/search", {"q": ["Amla"]},
            db_path=Path(_TMPDIR) / "absent.db",
        )
        self.assertEqual(status, 503)
        self.assertEqual(payload["error"]["code"], "database_unavailable")


class SecurityTest(BackendTestCase):
    def test_sql_injection_in_search_is_inert(self):
        payloads = (
            "'; DROP TABLE medicines; --",
            "' OR '1'='1",
            "Amla'); DELETE FROM interactions; --",
        )
        for attempt in payloads:
            status, body = self.get("/medicines/search", q=attempt)
            self.assertEqual(status, 200, attempt)
        # Tables are intact and untouched.
        self.assertEqual(
            self.conn.execute("SELECT COUNT(*) AS n FROM medicines").fetchone()["n"], 53
        )
        self.assertEqual(
            self.conn.execute("SELECT COUNT(*) AS n FROM interactions").fetchone()["n"], 520
        )

    def test_sql_injection_in_interaction_check_is_inert(self):
        status, payload = self.get(
            "/interactions/check",
            medicine_a="' OR 1=1 --", medicine_b="Warfarin",
        )
        self.assertEqual(status, 404)
        self.assertEqual(payload["status"], "medicine_not_found")

    def test_like_wildcards_do_not_match_everything(self):
        for wildcard in ("%", "_", "%%%"):
            status, payload = self.get("/medicines/search", q=wildcard)
            self.assertEqual(status, 200)
            self.assertEqual(payload["count"], 0, wildcard)

    def test_internal_errors_do_not_leak_details(self):
        with mock.patch.object(
            catalog, "search_medicines", side_effect=RuntimeError("secret internals")
        ):
            with mock.patch("sys.stderr"):
                status, payload = self.get("/medicines/search", q="Amla")
        self.assertEqual(status, 500)
        self.assertEqual(payload["error"]["code"], "internal_error")
        serialized = json.dumps(payload)
        self.assertNotIn("secret internals", serialized)
        self.assertNotIn("Traceback", serialized)

    def test_no_llm_or_network_on_the_request_path(self):
        """Lookups must be pure database reads.

        A model or HTTP call on this path would make medical answers
        nondeterministic and let generated text stand in for sourced evidence.
        """
        for module in (catalog, interactions, topics, api):
            source = Path(module.__file__).read_text(encoding="utf-8")
            for forbidden in ("import spacy", "import requests", "urllib.request",
                              "from Bio import", "openai"):
                self.assertNotIn(forbidden, source, f"{module.__name__} -> {forbidden}")


class ExtensionPointTest(unittest.TestCase):
    """The optional reference CSVs must genuinely work when rows are added.

    Both ship with headers only, so without this the alias and health-topic
    loaders would never run against data. Fixture values below are obviously
    synthetic on purpose: this exercises the loader, and inventing plausible
    medical content is exactly what the data rules forbid.
    """

    def _build_with(self, aliases_rows="", topics_rows=""):
        tmpdir = Path(tempfile.mkdtemp(prefix="hdi-ext-"))
        self.addCleanup(shutil.rmtree, tmpdir, ignore_errors=True)

        aliases = tmpdir / "medicine_aliases.csv"
        aliases.write_text("medicine_name,alias,alias_type\n" + aliases_rows, encoding="utf-8")
        topics = tmpdir / "health_topics.csv"
        topics.write_text(
            "topic,medicine_name,use_type,description,evidence_level,source,source_url,"
            "last_verified\n" + topics_rows,
            encoding="utf-8",
        )
        target = tmpdir / "ext.db"
        with mock.patch.object(seed, "ALIASES_CSV", aliases), \
                mock.patch.object(seed, "HEALTH_TOPICS_CSV", topics):
            summary = seed.build(db_path=target, verbose=False)
        return target, summary

    def test_extra_alias_rows_become_resolvable(self):
        target, summary = self._build_with(
            aliases_rows="Ashwagandha,Testalias Zeta,synonym\n"
        )
        self.assertEqual(summary["problems"], [])
        status, payload = api.handle(
            "GET", "/medicines/search", {"q": ["Testalias Zeta"]}, db_path=target
        )
        self.assertEqual(status, 200)
        self.assertEqual(payload["results"][0]["name"], "Ashwagandha")

        status, payload = api.handle(
            "GET", "/interactions/check",
            {"medicine_a": ["Testalias Zeta"], "medicine_b": ["Warfarin"]}, db_path=target,
        )
        self.assertEqual(status, 200)
        self.assertEqual(payload["medicine_a"]["name"], "Ashwagandha")

    def test_unknown_medicine_in_alias_csv_is_reported(self):
        _, summary = self._build_with(aliases_rows="Nosuchherb,Whatever,synonym\n")
        self.assertTrue(any("Nosuchherb" in p for p in summary["problems"]))

    def test_colliding_alias_makes_resolution_ambiguous_not_a_guess(self):
        target, summary = self._build_with(
            aliases_rows="Ashwagandha,Shared Testalias,synonym\n"
                         "Turmeric,Shared Testalias,synonym\n"
        )
        self.assertTrue(summary["collisions"])
        status, payload = api.handle(
            "GET", "/interactions/check",
            {"medicine_a": ["Shared Testalias"], "medicine_b": ["Warfarin"]}, db_path=target,
        )
        self.assertEqual(status, 409)
        self.assertEqual(payload["error"]["code"], "ambiguous_medicine")
        self.assertEqual(len(payload["error"]["candidates"]), 2)

    def test_health_topic_rows_become_queryable(self):
        target, summary = self._build_with(
            topics_rows=(
                "Test Topic,Ashwagandha,traditional_use,Synthetic fixture row,traditional,"
                "unit test fixture,,2026-01-01\n"
                "Test Topic,Metformin,conventional_use,Synthetic fixture row,moderate,"
                "unit test fixture,,2026-01-01\n"
            )
        )
        self.assertEqual(summary["problems"], [])

        status, payload = api.handle(
            "GET", "/health-topics/lookup", {"topic": ["test topic"]}, db_path=target
        )
        self.assertEqual(status, 200)
        self.assertEqual(payload["status"], topics.STATUS_FOUND)
        # Traditional and conventional use stay in separate buckets, so a
        # traditional claim is never read back as a conventional indication.
        self.assertEqual(
            [e["medicine"]["name"] for e in payload["traditional_use"]], ["Ashwagandha"]
        )
        self.assertEqual(
            [e["medicine"]["name"] for e in payload["conventional_use"]], ["Metformin"]
        )
        self.assertEqual(payload["traditional_use"][0]["evidence_level"], "traditional")

        status, payload = api.handle("GET", "/health-topics", {}, db_path=target)
        self.assertTrue(payload["has_topic_data"])
        self.assertEqual(payload["topics"], [{"topic": "Test Topic", "medicine_count": 2}])

    def test_unknown_topic_returns_not_found_when_data_exists(self):
        target, _ = self._build_with(
            topics_rows=(
                "Test Topic,Ashwagandha,traditional_use,Synthetic fixture row,traditional,"
                "unit test fixture,,2026-01-01\n"
            )
        )
        status, payload = api.handle(
            "GET", "/health-topics/lookup", {"topic": ["absent topic"]}, db_path=target
        )
        self.assertEqual(status, 200)
        self.assertEqual(payload["status"], topics.STATUS_NOT_FOUND)

    def test_invalid_use_type_is_reported(self):
        _, summary = self._build_with(
            topics_rows="Test Topic,Ashwagandha,cures_everything,x,strong,fixture,,2026-01-01\n"
        )
        self.assertTrue(any("use_type" in p for p in summary["problems"]))


class HttpServerTest(unittest.TestCase):
    """End-to-end over a real socket, proving the server actually starts and serves."""

    @classmethod
    def setUpClass(cls):
        cls.server = api.make_server("127.0.0.1", 0, db_path=_DB, quiet=True)
        cls.port = cls.server.server_address[1]
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=5)

    def request(self, method, path, body=None):
        conn = HTTPConnection("127.0.0.1", self.port, timeout=10)
        try:
            if body is None:
                conn.request(method, path)
            else:
                conn.request(
                    method, path, json.dumps(body),
                    {"Content-Type": "application/json"},
                )
            response = conn.getresponse()
            payload = json.loads(response.read().decode("utf-8"))
            return response.status, response.getheader("Content-Type"), payload
        finally:
            conn.close()

    def test_health_endpoint(self):
        status, content_type, payload = self.request("GET", "/health")
        self.assertEqual(status, 200)
        self.assertIn("application/json", content_type)
        self.assertEqual(payload["status"], "ok")
        self.assertEqual(payload["database"]["medicines"], "53")

    def test_index_lists_endpoints(self):
        status, _, payload = self.request("GET", "/")
        self.assertEqual(status, 200)
        self.assertTrue(any("interactions/check" in e for e in payload["endpoints"]))

    def test_search_over_http(self):
        status, _, payload = self.request("GET", "/medicines/search?q=ashwagandha")
        self.assertEqual(status, 200)
        self.assertEqual(payload["results"][0]["name"], "Ashwagandha")

    def test_url_encoded_query_over_http(self):
        status, _, payload = self.request(
            "GET", "/medicines/search?q=Withania%20somnifera"
        )
        self.assertEqual(status, 200)
        self.assertEqual(payload["results"][0]["name"], "Ashwagandha")

    def test_interaction_check_over_http(self):
        status, _, payload = self.request(
            "GET", "/interactions/check?medicine_a=Garlic&medicine_b=Warfarin"
        )
        self.assertEqual(status, 200)
        self.assertEqual(payload["status"], "interaction_found")

    def test_post_check_over_http(self):
        status, _, payload = self.request(
            "POST", "/interactions/check",
            {"medicine_a": "Warfarin", "medicine_b": "Garlic"},
        )
        self.assertEqual(status, 200)
        self.assertEqual(payload["status"], "interaction_found")

    def test_malformed_json_body_over_http(self):
        conn = HTTPConnection("127.0.0.1", self.port, timeout=10)
        try:
            conn.request(
                "POST", "/interactions/check", "{not json",
                {"Content-Type": "application/json"},
            )
            response = conn.getresponse()
            payload = json.loads(response.read().decode("utf-8"))
        finally:
            conn.close()
        self.assertEqual(response.status, 400)
        self.assertEqual(payload["error"]["code"], "invalid_body")

    def test_not_found_over_http(self):
        status, _, payload = self.request("GET", "/no-such-route")
        self.assertEqual(status, 404)
        self.assertIn("error", payload)


if __name__ == "__main__":
    unittest.main()
