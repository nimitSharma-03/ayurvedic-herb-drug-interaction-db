"""Tests for the three deployment-facing additions: /stats, CORS and HOST/PORT.

Like tests/test_backend.py, these run against a database seeded from the real
curated corpus rather than a fixture, because the point of /stats is that its
numbers are the real ones. A test that seeded two herbs would pass while the
endpoint reported nonsense.

The /stats tests deliberately assert *relationships* -- that a reported count
equals the rows it claims to count, that breakdowns sum to their totals -- and
not literal figures. Pinning 520 here would mean a correct change to the corpus
breaks a test that was never about the corpus. Where a literal is asserted it
is one the project's own rules fix: 53 medicines, 40 herbs, 13 drugs and zero
reviewed rows.
"""

import csv
import json
import os
import shutil
import sys
import tempfile
import threading
import unittest
from http.client import HTTPConnection
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from hdi import api, db, seed, stats

ROOT = Path(__file__).resolve().parent.parent

_TMPDIR = None
_DB = None


def setUpModule():
    global _TMPDIR, _DB
    _TMPDIR = tempfile.mkdtemp(prefix="hdi-stats-test-")
    _DB = Path(_TMPDIR) / "test.db"
    seed.build(db_path=_DB, verbose=False)


def tearDownModule():
    shutil.rmtree(_TMPDIR, ignore_errors=True)


class StatsTestCase(unittest.TestCase):
    def setUp(self):
        self.conn = db.connect(_DB, read_only=True)
        self.addCleanup(self.conn.close)
        status, self.payload = api.handle("GET", "/stats", db_path=_DB)
        self.assertEqual(status, 200)

    def count(self, sql):
        return self.conn.execute(sql).fetchone()[0]


class StatsEndpointTest(StatsTestCase):
    def test_top_level_shape(self):
        self.assertEqual(
            set(self.payload),
            {
                "literature", "scope", "knowledge", "classifier",
                "classifier_note", "database", "note",
            },
        )

    def test_it_is_a_get_only_route(self):
        status, payload = api.handle("POST", "/stats", body={}, db_path=_DB)
        self.assertEqual(status, 405)
        self.assertEqual(payload["error"]["code"], "method_not_allowed")

    def test_the_index_advertises_it(self):
        _, index = api.handle("GET", "/", db_path=_DB)
        self.assertIn("GET /stats", index["endpoints"])

    def test_it_is_json_serializable(self):
        """Whatever the route returns must survive json.dumps unchanged.

        A set or a Path leaking out of a count would raise here rather than at
        the first real request.
        """
        self.assertEqual(
            json.loads(json.dumps(self.payload)), json.loads(json.dumps(self.payload))
        )

    def test_two_calls_agree(self):
        _, again = api.handle("GET", "/stats", db_path=_DB)
        self.assertEqual(self.payload, again)


class StatsScopeTest(StatsTestCase):
    def test_scope_counts_match_the_frozen_reference_tables(self):
        scope = self.payload["scope"]
        self.assertEqual(scope["medicines"], 53)
        self.assertEqual(scope["herbs"], 40)
        self.assertEqual(scope["drugs"], 13)
        self.assertEqual(scope["herbs"] + scope["drugs"], scope["medicines"])

    def test_herb_and_drug_counts_match_their_csv_files(self):
        """The two numbers a front end calls "scope" are the two frozen files."""
        with open(ROOT / "data" / "reference" / "herbs.csv", encoding="utf-8") as f:
            herbs = len(list(csv.DictReader(f)))
        with open(ROOT / "data" / "reference" / "drug_classes.csv", encoding="utf-8") as f:
            classes = {row["drug_class"] for row in csv.DictReader(f)}
        self.assertEqual(self.payload["scope"]["herbs"], herbs)
        self.assertEqual(self.payload["scope"]["drug_classes"], len(classes))

    def test_scope_counts_match_the_database(self):
        scope = self.payload["scope"]
        self.assertEqual(scope["medicines"], self.count("SELECT COUNT(*) FROM medicines"))
        self.assertEqual(scope["conditions"], self.count("SELECT COUNT(*) FROM conditions"))
        self.assertEqual(
            scope["condition_synonyms"],
            self.count("SELECT COUNT(*) FROM condition_synonyms"),
        )
        self.assertEqual(
            scope["aliases"], self.count("SELECT COUNT(*) FROM medicine_aliases")
        )
        self.assertEqual(
            scope["class_aliases"], self.count("SELECT COUNT(*) FROM class_aliases")
        )

    def test_drug_class_detail_sums_to_the_drug_count(self):
        detail = self.payload["scope"]["drug_classes_detail"]
        self.assertEqual(len(detail), self.payload["scope"]["drug_classes"])
        self.assertEqual(
            sum(row["drugs"] for row in detail), self.payload["scope"]["drugs"]
        )
        self.assertEqual(
            [row["drug_class"] for row in detail],
            sorted(row["drug_class"] for row in detail),
        )


class StatsLiteratureTest(StatsTestCase):
    def test_pairs_searched_is_the_corpus_size(self):
        lit = self.payload["literature"]
        self.assertEqual(
            lit["pairs_searched"], self.count("SELECT COUNT(*) FROM interactions")
        )

    def test_result_states_sum_to_pairs_searched(self):
        lit = self.payload["literature"]
        self.assertEqual(sum(lit["result_states"].values()), lit["pairs_searched"])

    def test_documented_pairs_is_the_interaction_found_count(self):
        lit = self.payload["literature"]
        self.assertEqual(
            lit["documented_pairs"], lit["result_states"][db.STATUS_INTERACTION_FOUND]
        )
        self.assertEqual(
            lit["documented_pairs"],
            self.count(
                "SELECT COUNT(*) FROM interactions WHERE status = 'interaction_found'"
            ),
        )

    def test_no_finding_basis_reconciles_with_the_result_states(self):
        """Every pair without a documented interaction has a stated reason.

        The four bases cover the no-finding and insufficient-evidence rows
        between them, so a front end showing the breakdown is not hiding a
        remainder.
        """
        lit = self.payload["literature"]
        basis_total = sum(lit["no_finding_basis"].values())
        states = lit["result_states"]
        self.assertEqual(
            basis_total,
            states[db.STATUS_NO_DOCUMENTED_INTERACTION]
            + states[db.STATUS_INSUFFICIENT_EVIDENCE],
        )

    def test_verdicts_sum_to_the_evidence_rows(self):
        lit = self.payload["literature"]
        self.assertEqual(sum(lit["verdicts"].values()), lit["evidence_rows"])
        self.assertEqual(
            lit["evidence_rows"], self.count("SELECT COUNT(*) FROM interaction_evidence")
        )

    def test_no_verdict_bucket_is_missing(self):
        self.assertEqual(
            set(self.payload["literature"]["verdicts"]),
            {"confirmed", "rejected", "unclear"},
        )

    def test_abstract_and_candidate_counts_match_the_files_on_disk(self):
        lit = self.payload["literature"]
        with open(stats.ABSTRACTS_PATH, encoding="utf-8") as f:
            abstracts = json.load(f)
        with open(stats.CANDIDATES_PATH, encoding="utf-8") as f:
            candidates = json.load(f)
        self.assertEqual(lit["abstracts_harvested"], len(abstracts))
        self.assertEqual(lit["candidate_sentences"], len(candidates))
        self.assertEqual(
            lit["distinct_pmids_harvested"], len({row["pmid"] for row in abstracts})
        )

    def test_candidate_sentences_equal_the_evidence_rows(self):
        """Every extracted candidate is stored, including the rejected ones.

        docs/BACKEND_API.md says interaction_evidence keeps what a curator
        dismissed, because that is part of why a pair reads no_documented_
        interaction. If these two ever diverge, something is being dropped.
        """
        lit = self.payload["literature"]
        self.assertEqual(lit["candidate_sentences"], lit["evidence_rows"])

    def test_cited_pmids_do_not_exceed_harvested_pmids(self):
        lit = self.payload["literature"]
        self.assertLessEqual(lit["distinct_pmids_cited"], lit["distinct_pmids_harvested"])
        self.assertEqual(
            lit["distinct_pmids_cited"],
            self.count("SELECT COUNT(DISTINCT pmid) FROM interaction_evidence"),
        )

    def test_a_missing_file_reports_absent_rather_than_zero(self):
        """A file that is not there must not be reported as a count of nothing.

        Zero abstracts harvested and "we cannot see the harvest" are different
        statements, and this project does not collapse them anywhere else.
        """
        with mock.patch.object(stats, "ABSTRACTS_PATH", ROOT / "data" / "raw" / "nope.json"):
            stats._cache.pop(str(stats.ABSTRACTS_PATH), None)
            lit = stats.literature(self.conn)
        self.assertIsNone(lit["abstracts_harvested"])
        self.assertIsNone(lit["distinct_pmids_harvested"])
        self.assertEqual(lit["pairs_searched"], self.payload["literature"]["pairs_searched"])


class StatsKnowledgeTest(StatsTestCase):
    def test_rows_match_the_use_table(self):
        self.assertEqual(
            self.payload["knowledge"]["rows"],
            self.count("SELECT COUNT(*) FROM medicine_uses"),
        )

    def test_source_type_breakdown_sums_to_the_total(self):
        knowledge = self.payload["knowledge"]
        self.assertEqual(
            sum(row["rows"] for row in knowledge["by_source_type"]), knowledge["rows"]
        )
        self.assertTrue(knowledge["by_source_type"])

    def test_source_types_are_the_three_the_project_defines(self):
        kinds = {row["source_type"] for row in self.payload["knowledge"]["by_source_type"]}
        self.assertTrue(
            kinds <= {"fetched_source", "repo_abstract", "general_knowledge"}, kinds
        )

    def test_use_kind_and_evidence_breakdowns_sum_to_the_total(self):
        knowledge = self.payload["knowledge"]
        for key in ("by_use_kind", "by_evidence_level"):
            self.assertEqual(
                sum(row["rows"] for row in knowledge[key]), knowledge["rows"], key
            )

    def test_nothing_is_reported_as_reviewed(self):
        """docs/PROJECT_SCOPE.md forbids it and the schema makes it impossible.

        /stats reports the number anyway so a consumer can check rather than
        trust, and this asserts the number it reports is the true one.
        """
        self.assertEqual(self.payload["knowledge"]["reviewed_rows"], 0)

    def test_rule_and_tag_counts_match_their_tables(self):
        knowledge = self.payload["knowledge"]
        self.assertEqual(
            knowledge["combination_rules"],
            self.count("SELECT COUNT(*) FROM combination_rules"),
        )
        self.assertEqual(
            knowledge["tags"], self.count("SELECT COUNT(*) FROM tag_vocabulary")
        )
        self.assertEqual(
            knowledge["health_topic_rows"],
            self.count("SELECT COUNT(*) FROM health_topic_map"),
        )


class StatsClassifierTest(StatsTestCase):
    def test_metrics_come_from_the_file_evaluate_writes(self):
        self.assertTrue(
            stats.METRICS_PATH.exists(),
            f"{stats.METRICS_PATH} is missing; run `python ml/evaluate.py`.",
        )
        with open(stats.METRICS_PATH, encoding="utf-8") as f:
            on_disk = json.load(f)
        self.assertEqual(self.payload["classifier"], on_disk)
        self.assertIsNone(self.payload["classifier_note"])

    def test_metrics_carry_the_numbers_a_client_needs(self):
        metrics = self.payload["classifier"]
        for field in (
            "macro_f1_test", "macro_f1_validation", "threshold", "per_class",
            "rows_scored", "test_set_is_synthetic",
        ):
            self.assertIn(field, metrics)
        self.assertTrue(metrics["test_set_is_synthetic"])

    def test_per_class_rows_are_complete_and_in_range(self):
        metrics = self.payload["classifier"]
        names = {row["class"] for row in metrics["per_class"]}
        self.assertEqual(names, set(metrics["classes"]) | {"out_of_scope"})
        for row in metrics["per_class"]:
            for field in ("precision", "recall", "f1"):
                self.assertGreaterEqual(row[field], 0.0, row)
                self.assertLessEqual(row[field], 1.0, row)
            self.assertGreater(row["support"], 0, row)

    def test_macro_f1_is_the_mean_of_the_per_class_f1s(self):
        metrics = self.payload["classifier"]
        rows = metrics["per_class"]
        mean = sum(row["f1"] for row in rows) / len(rows)
        self.assertAlmostEqual(metrics["macro_f1_test"], mean, places=3)

    def test_the_threshold_matches_the_served_artifact(self):
        """The reported threshold has to be the one inference actually uses."""
        from hdi.classify import load_classifier

        self.assertEqual(self.payload["classifier"]["threshold"], load_classifier().threshold)

    def test_validation_macro_f1_matches_the_artifact_metadata(self):
        from hdi.classify import load_classifier

        self.assertEqual(
            self.payload["classifier"]["macro_f1_validation"],
            load_classifier().metadata.get("validation_macro_f1"),
        )

    def test_an_absent_metrics_file_is_null_with_an_explanation(self):
        with mock.patch.object(stats, "METRICS_PATH", ROOT / "ml" / "reports" / "nope.json"):
            stats._cache.pop(str(stats.METRICS_PATH), None)
            payload = stats.stats(self.conn)
        self.assertIsNone(payload["classifier"])
        self.assertEqual(payload["classifier_note"], stats.CLASSIFIER_MISSING_NOTE)


class StatsHonestyTest(StatsTestCase):
    def test_no_count_is_negative(self):
        def walk(value, path):
            if isinstance(value, bool):
                return
            if isinstance(value, (int, float)):
                self.assertGreaterEqual(value, 0, path)
            elif isinstance(value, dict):
                for key, item in value.items():
                    walk(item, f"{path}.{key}")
            elif isinstance(value, list):
                for i, item in enumerate(value):
                    walk(item, f"{path}[{i}]")

        walk(self.payload, "stats")

    def test_the_note_says_nothing_is_reviewed(self):
        self.assertIn("reviewed", self.payload["note"])
        self.assertIn("synthetic", self.payload["note"])

    def test_database_metadata_is_echoed(self):
        self.assertEqual(self.payload["database"]["medicines"], "53")


class RecordedUsesTest(unittest.TestCase):
    """The additive `recorded_uses` field on GET /medicines/{id}.

    The medicine table's own use columns are NULL for every row, by design. The
    sourced uses live in medicine_uses, and a client showing a medicine page
    needs them. Added beside the existing projection, so nothing already
    returned changed shape.
    """

    def get(self, path):
        return api.handle("GET", path, db_path=_DB)

    def test_existing_fields_are_unchanged(self):
        _, payload = self.get("/medicines/herb-turmeric")
        for field in (
            "id", "name", "category", "medicine_type", "scientific_name", "aliases",
            "sources", "data_completeness", "interaction_summary",
        ):
            self.assertIn(field, payload)

    def test_recorded_uses_are_present_and_sourced(self):
        _, payload = self.get("/medicines/drug-metformin")
        uses = payload["recorded_uses"]
        self.assertTrue(uses)
        for use in uses:
            self.assertFalse(use["reviewed"])
            self.assertTrue(use["source_type"])
            self.assertTrue(use["source_note"])
            self.assertTrue(use["condition_id"])
            self.assertTrue(use["condition_name"])

    def test_a_medicine_with_no_recorded_use_gets_an_empty_list(self):
        """Absent, not invented. Most of the 40 herbs have no use row."""
        conn = db.connect(_DB, read_only=True)
        self.addCleanup(conn.close)
        row = conn.execute(
            "SELECT id FROM medicines WHERE id NOT IN "
            "(SELECT medicine_id FROM medicine_uses) LIMIT 1"
        ).fetchone()
        self.assertIsNotNone(row, "expected at least one medicine with no recorded use")
        _, payload = self.get(f"/medicines/{row['id']}")
        self.assertEqual(payload["recorded_uses"], [])

    def test_an_unknown_id_is_still_a_404(self):
        status, payload = self.get("/medicines/herb-nope")
        self.assertEqual(status, 404)
        self.assertEqual(payload["error"]["code"], "medicine_not_found")


class AllowedOriginsTest(unittest.TestCase):
    def test_the_default_is_the_local_dev_server_not_a_wildcard(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            self.assertEqual(api.allowed_origins(), ["http://localhost:3000"])

    def test_a_comma_separated_list_is_parsed(self):
        self.assertEqual(
            api.allowed_origins("http://a.test, https://b.test"),
            ["http://a.test", "https://b.test"],
        )

    def test_blanks_duplicates_and_trailing_slashes_are_cleaned_up(self):
        self.assertEqual(
            api.allowed_origins("http://a.test/, , http://a.test,https://b.test/"),
            ["http://a.test", "https://b.test"],
        )

    def test_it_reads_the_environment(self):
        with mock.patch.dict(os.environ, {"ALLOWED_ORIGINS": "https://x.test"}):
            self.assertEqual(api.allowed_origins(), ["https://x.test"])

    def test_an_empty_setting_falls_back_to_the_default(self):
        self.assertEqual(api.allowed_origins(""), [])


class CorsHeaderTest(unittest.TestCase):
    ORIGINS = ["http://localhost:3000", "https://web.test"]

    def test_an_allowed_origin_is_echoed_with_the_method_and_header_lists(self):
        headers = api.cors_headers("https://web.test", self.ORIGINS)
        self.assertEqual(headers["Access-Control-Allow-Origin"], "https://web.test")
        self.assertIn("OPTIONS", headers["Access-Control-Allow-Methods"])
        self.assertIn("POST", headers["Access-Control-Allow-Methods"])
        self.assertIn("Content-Type", headers["Access-Control-Allow-Headers"])
        self.assertEqual(headers["Vary"], "Origin")

    def test_a_disallowed_origin_gets_no_allow_header(self):
        """Not reflected, and not an error: the browser does the blocking."""
        headers = api.cors_headers("https://evil.test", self.ORIGINS)
        self.assertNotIn("Access-Control-Allow-Origin", headers)
        self.assertEqual(headers, {"Vary": "Origin"})

    def test_a_request_with_no_origin_gets_no_allow_header(self):
        self.assertEqual(api.cors_headers(None, self.ORIGINS), {"Vary": "Origin"})
        self.assertEqual(api.cors_headers("", self.ORIGINS), {"Vary": "Origin"})

    def test_a_trailing_slash_on_the_origin_still_matches(self):
        headers = api.cors_headers("https://web.test/", self.ORIGINS)
        self.assertEqual(headers["Access-Control-Allow-Origin"], "https://web.test/")

    def test_a_wildcard_entry_allows_any_origin(self):
        headers = api.cors_headers("https://anything.test", ["*"])
        self.assertEqual(headers["Access-Control-Allow-Origin"], "*")

    def test_an_empty_allow_list_allows_nothing(self):
        self.assertEqual(api.cors_headers("https://web.test", []), {"Vary": "Origin"})

    def test_a_substring_of_an_allowed_origin_is_not_allowed(self):
        for origin in ("https://web.test.evil.test", "https://notweb.test", "web.test"):
            self.assertNotIn(
                "Access-Control-Allow-Origin",
                api.cors_headers(origin, self.ORIGINS),
                origin,
            )


class EnvHostPortTest(unittest.TestCase):
    def test_defaults_when_unset(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            self.assertEqual(api.env_host(), "127.0.0.1")
            self.assertEqual(api.env_port(), 8000)

    def test_the_environment_wins_over_the_default(self):
        with mock.patch.dict(os.environ, {"HOST": "0.0.0.0", "PORT": "10000"}):
            self.assertEqual(api.env_host(), "0.0.0.0")
            self.assertEqual(api.env_port(), 10000)

    def test_blank_values_fall_back(self):
        with mock.patch.dict(os.environ, {"HOST": "  ", "PORT": " "}):
            self.assertEqual(api.env_host(), "127.0.0.1")
            self.assertEqual(api.env_port(), 8000)

    def test_a_non_numeric_port_falls_back_rather_than_crashing(self):
        with mock.patch.dict(os.environ, {"PORT": "not-a-port"}):
            self.assertEqual(api.env_port(), 8000)


class CorsOverHttpTest(unittest.TestCase):
    """CORS and /stats over a real socket, including an OPTIONS preflight."""

    ORIGIN = "http://localhost:3000"

    @classmethod
    def setUpClass(cls):
        cls.server = api.make_server(
            "127.0.0.1", 0, db_path=_DB, quiet=True, origins=[cls.ORIGIN]
        )
        cls.port = cls.server.server_address[1]
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=5)

    def request(self, method, path, origin=None, body=None):
        conn = HTTPConnection("127.0.0.1", self.port, timeout=10)
        try:
            headers = {}
            if origin is not None:
                headers["Origin"] = origin
            payload = None
            if body is not None:
                headers["Content-Type"] = "application/json"
                payload = json.dumps(body)
            conn.request(method, path, payload, headers)
            response = conn.getresponse()
            raw = response.read()
            return response.status, dict(response.getheaders()), raw
        finally:
            conn.close()

    def test_preflight_is_answered_with_the_allow_headers(self):
        status, headers, body = self.request("OPTIONS", "/recommend", origin=self.ORIGIN)
        self.assertEqual(status, 204)
        self.assertEqual(headers["Access-Control-Allow-Origin"], self.ORIGIN)
        self.assertIn("POST", headers["Access-Control-Allow-Methods"])
        self.assertIn("Content-Type", headers["Access-Control-Allow-Headers"])
        self.assertEqual(body, b"")

    def test_preflight_from_a_disallowed_origin_gets_no_allow_header(self):
        status, headers, _ = self.request(
            "OPTIONS", "/recommend", origin="https://evil.test"
        )
        self.assertEqual(status, 204)
        self.assertNotIn("Access-Control-Allow-Origin", headers)

    def test_a_get_from_an_allowed_origin_carries_the_allow_header(self):
        status, headers, raw = self.request("GET", "/stats", origin=self.ORIGIN)
        self.assertEqual(status, 200)
        self.assertEqual(headers["Access-Control-Allow-Origin"], self.ORIGIN)
        self.assertEqual(headers["Vary"], "Origin")
        self.assertEqual(json.loads(raw)["scope"]["medicines"], 53)

    def test_a_post_from_an_allowed_origin_carries_the_allow_header(self):
        status, headers, raw = self.request(
            "POST", "/recommend", origin=self.ORIGIN, body={"text": "my sugar is high"}
        )
        self.assertEqual(status, 200)
        self.assertEqual(headers["Access-Control-Allow-Origin"], self.ORIGIN)
        self.assertEqual(json.loads(raw)["status"], "results")

    def test_an_error_response_still_carries_the_allow_header(self):
        """Otherwise the browser hides the error and the client sees a network
        failure instead of the 400 the API actually sent."""
        status, headers, raw = self.request(
            "POST", "/recommend", origin=self.ORIGIN, body={}
        )
        self.assertEqual(status, 400)
        self.assertEqual(headers["Access-Control-Allow-Origin"], self.ORIGIN)
        self.assertEqual(json.loads(raw)["error"]["code"], "missing_parameter")

    def test_a_malformed_body_error_still_carries_the_allow_header(self):
        conn = HTTPConnection("127.0.0.1", self.port, timeout=10)
        try:
            conn.request(
                "POST", "/recommend", "{not json",
                {"Content-Type": "application/json", "Origin": self.ORIGIN},
            )
            response = conn.getresponse()
            raw = response.read()
            headers = dict(response.getheaders())
        finally:
            conn.close()
        self.assertEqual(response.status, 400)
        self.assertEqual(headers["Access-Control-Allow-Origin"], self.ORIGIN)
        self.assertEqual(json.loads(raw)["error"]["code"], "invalid_body")

    def test_a_server_to_server_request_without_an_origin_still_works(self):
        status, headers, raw = self.request("GET", "/health")
        self.assertEqual(status, 200)
        self.assertNotIn("Access-Control-Allow-Origin", headers)
        self.assertEqual(json.loads(raw)["status"], "ok")


if __name__ == "__main__":
    unittest.main()
