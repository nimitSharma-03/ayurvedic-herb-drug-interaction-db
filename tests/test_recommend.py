"""Scenario tests for POST /recommend: safety, options, combinations and output rules.

Tests run against a database seeded from the project's real reference files (a
temporary copy, built once for the module), not a hand-made fixture, so a
regression in the real data fails here rather than in production.

The scan in ForbiddenOutputTest is the important one. It walks every string in
every response shape this module can produce and asserts that none of them
carries a dose, a brand name or a safety claim. A response is the only thing a
user sees, so that is the layer the rule has to hold at.
"""

import json
import re
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from hdi import api, catalog, classify, db, knowledge, recommend, safety, seed
from hdi.validate_reference import (
    FORBIDDEN_OUTPUT_PATTERNS,
    brand_names,
    safety_claim_problems,
)

_TMPDIR = None
_DB = None


def setUpModule():
    global _TMPDIR, _DB
    _TMPDIR = tempfile.mkdtemp(prefix="hdi-recommend-")
    _DB = Path(_TMPDIR) / "test.db"
    seed.build(db_path=_DB, verbose=False)


def tearDownModule():
    shutil.rmtree(_TMPDIR, ignore_errors=True)


class RecommendTestCase(unittest.TestCase):
    def setUp(self):
        self.conn = db.connect(_DB, read_only=True)
        self.addCleanup(self.conn.close)

    def ask(self, **body):
        """Call the service directly."""
        return recommend.recommend(self.conn, **body)

    def post(self, body):
        """Call it through the route, so validation and status mapping are covered."""
        return api.handle("POST", "/recommend", {}, body, db_path=_DB)

    def names(self, payload, key):
        return [o["name"] for o in payload[key]]

    def warning_for(self, payload, a, b):
        """The warning for a pair, in whichever order it was reported."""
        for warning in payload["combination_warnings"]:
            pair = {warning["medicine_a"], str(warning["medicine_b"])}
            if pair == {a, b}:
                return warning
        return None


# ---------------------------------------------------------------------------
# safety
# ---------------------------------------------------------------------------

class EmergencyTest(RecommendTestCase):
    """A red flag must short-circuit before anything else runs."""

    def test_english_chest_pain_short_circuits(self):
        payload = self.ask(text="I have chest pain and my sugar is high")
        self.assertEqual(payload["status"], recommend.STATUS_EMERGENCY)
        self.assertEqual(payload["ayurvedic_options"], [])
        self.assertEqual(payload["allopathic_options"], [])
        self.assertEqual(payload["combination_warnings"], [])
        self.assertEqual(payload["detected_conditions"], [])
        self.assertIn("chest_pain", [f["category"] for f in payload["red_flags"]])
        self.assertTrue(any("112" in a for a in payload["actions"]))

    def test_hinglish_chest_pain_short_circuits(self):
        payload = self.ask(text="seene me dard ho raha hai aur ghabrahat")
        self.assertEqual(payload["status"], recommend.STATUS_EMERGENCY)
        self.assertEqual(payload["ayurvedic_options"], [])
        self.assertIn("chest_pain", [f["category"] for f in payload["red_flags"]])

    def test_hinglish_bleeding_short_circuits(self):
        payload = self.ask(text="khoon band nahi ho raha, warfarin leta hoon")
        self.assertEqual(payload["status"], recommend.STATUS_EMERGENCY)
        self.assertEqual(payload["allopathic_options"], [])

    def test_suicidal_thoughts_route_to_a_helpline(self):
        payload = self.ask(text="mera jeene ka man nahi karta")
        self.assertEqual(payload["status"], recommend.STATUS_EMERGENCY)
        self.assertIn("suicidal_thoughts", [f["category"] for f in payload["red_flags"]])
        # 112 alone is the wrong answer here; the mental-health line must appear.
        self.assertTrue(
            any("14416" in a for a in payload["actions"]),
            "suicidal ideation must route to Tele-MANAS, not only to 112",
        )

    def test_red_flag_beats_a_supplied_condition_id(self):
        """condition_ids skips the classifier, not the safety screen."""
        payload = self.ask(
            text="vomiting blood since morning", condition_ids=["type_2_diabetes"]
        )
        self.assertEqual(payload["status"], recommend.STATUS_EMERGENCY)
        self.assertEqual(payload["ayurvedic_options"], [])

    def test_history_of_a_heart_attack_is_not_an_emergency(self):
        """A past event must be classified, not escalated.

        The patterns deliberately omit bare "heart attack" and "stroke" so
        someone giving their history gets an answer.
        """
        payload = self.ask(text="a heart attack last year, what are my options")
        self.assertNotEqual(payload["status"], recommend.STATUS_EMERGENCY)

    def test_several_red_flags_are_all_reported(self):
        payload = self.ask(text="black tarry stools and I fainted this morning")
        categories = {f["category"] for f in payload["red_flags"]}
        self.assertIn("black_stools", categories)
        self.assertIn("fainting", categories)


class CautionFlagTest(RecommendTestCase):
    def test_caution_flags_add_notes_without_removing_options(self):
        plain = self.ask(text="my sugar is high")
        flagged = self.ask(
            text="my sugar is high",
            cautions={"pregnant_or_breastfeeding": True, "kidney_or_liver_disease": True},
        )
        self.assertEqual(flagged["status"], recommend.STATUS_RESULTS)
        self.assertEqual(
            self.names(plain, "ayurvedic_options"), self.names(flagged, "ayurvedic_options")
        )
        self.assertGreater(len(flagged["caution_notes"]), len(plain["caution_notes"]))
        joined = " ".join(flagged["caution_notes"]).lower()
        self.assertIn("pregnant", joined)
        self.assertIn("kidney", joined)

    def test_false_flags_add_nothing(self):
        payload = self.ask(text="my sugar is high", cautions={"under_18": False})
        self.assertNotIn("under 18", " ".join(payload["caution_notes"]).lower())

    def test_unknown_caution_flag_is_reported_not_rejected(self):
        payload = self.ask(text="my sugar is high", cautions={"made_up_flag": True})
        self.assertEqual(payload["status"], recommend.STATUS_RESULTS)
        self.assertEqual(payload["ignored_caution_flags"], ["made_up_flag"])


# ---------------------------------------------------------------------------
# classification and scope
# ---------------------------------------------------------------------------

class ScopeTest(RecommendTestCase):
    def test_headache_is_out_of_scope(self):
        payload = self.ask(text="i have a headache")
        self.assertEqual(payload["status"], recommend.STATUS_OUT_OF_SCOPE)
        self.assertEqual(payload["ayurvedic_options"], [])
        self.assertEqual(payload["allopathic_options"], [])
        self.assertEqual(len(payload["supported_conditions"]), 6)

    def test_unrelated_hinglish_complaint_is_out_of_scope(self):
        payload = self.ask(text="mujhe baal jhadne ki problem hai")
        self.assertEqual(payload["status"], recommend.STATUS_OUT_OF_SCOPE)
        self.assertEqual(payload["ayurvedic_options"], [])

    def test_low_confidence_lists_the_supported_conditions(self):
        """Vague text must not be forced into a condition."""
        payload = self.ask(text="swelling ke liye kya karu")
        self.assertEqual(payload["status"], recommend.STATUS_LOW_CONFIDENCE)
        self.assertEqual(payload["detected_conditions"], [])
        self.assertEqual(payload["ayurvedic_options"], [])
        ids = [c["condition_id"] for c in payload["supported_conditions"]]
        self.assertIn("heart_failure", ids)
        self.assertIn("type_2_diabetes", ids)

    def test_condition_ids_skips_the_classifier(self):
        with mock.patch.object(
            classify, "load_classifier", side_effect=AssertionError("classifier was called")
        ):
            payload = self.ask(condition_ids=["hypertension"])
        self.assertEqual(payload["status"], recommend.STATUS_RESULTS)
        self.assertEqual(
            [c["condition_id"] for c in payload["detected_conditions"]], ["hypertension"]
        )
        self.assertIsNone(payload["detected_conditions"][0]["confidence"])
        self.assertEqual(payload["detected_conditions"][0]["source"], "supplied_by_caller")

    def test_unknown_condition_id_is_rejected_with_the_supported_list(self):
        with self.assertRaises(recommend.RequestError) as caught:
            self.ask(condition_ids=["cancer"])
        self.assertEqual(caught.exception.code, "invalid_parameter")
        self.assertIn("supported_conditions", caught.exception.extra)

    def test_two_conditions_in_one_text(self):
        payload = self.ask(text="sugar aur BP dono high hai")
        self.assertEqual(payload["status"], recommend.STATUS_RESULTS)
        detected = {c["condition_id"] for c in payload["detected_conditions"]}
        self.assertEqual(detected, {"type_2_diabetes", "hypertension"})
        # Options from both conditions, each tagged with the one it answers.
        conditions = {o["condition_id"] for o in payload["ayurvedic_options"]}
        self.assertEqual(conditions, {"type_2_diabetes", "hypertension"})
        self.assertIn("Sarpagandha", self.names(payload, "ayurvedic_options"))
        self.assertIn("Karela", self.names(payload, "ayurvedic_options"))


# ---------------------------------------------------------------------------
# options
# ---------------------------------------------------------------------------

class OptionTest(RecommendTestCase):
    def test_diabetes_returns_both_kinds_of_option_with_provenance(self):
        payload = self.ask(text="my sugar is high")
        self.assertEqual(payload["status"], recommend.STATUS_RESULTS)
        self.assertIn("Karela", self.names(payload, "ayurvedic_options"))
        self.assertIn("Gymnema", self.names(payload, "ayurvedic_options"))
        self.assertIn("Metformin", self.names(payload, "allopathic_options"))

        for option in payload["ayurvedic_options"] + payload["allopathic_options"]:
            for field in ("name", "uses", "evidence_level", "pros", "cons", "cautions",
                          "source_type", "reviewed"):
                self.assertIn(field, option, option.get("name"))
            self.assertTrue(option["pros"].strip())
            self.assertTrue(option["cons"].strip())
            self.assertIn(option["source_type"],
                          ("fetched_source", "repo_abstract", "general_knowledge"))
            # docs/PROJECT_SCOPE.md: nothing here has been reviewed, and the
            # response must say so rather than leave a consumer to assume.
            self.assertFalse(option["reviewed"], option["name"])

    def test_blood_thinner_request_returns_anticoagulant_options(self):
        payload = self.ask(text="a clot in my leg, what are my options")
        self.assertEqual(payload["status"], recommend.STATUS_RESULTS)
        self.assertIn(
            "venous_thromboembolism",
            {c["condition_id"] for c in payload["detected_conditions"]},
        )
        allopathic = self.names(payload, "allopathic_options")
        self.assertIn("Warfarin", allopathic)
        self.assertIn("Heparin", allopathic)
        # Every herb offered here must say it is not a replacement.
        for option in payload["ayurvedic_options"]:
            self.assertIn("replace", option["cautions"].lower(), option["name"])

    def test_options_are_ordered_by_evidence_not_ranked(self):
        payload = self.ask(condition_ids=["type_2_diabetes"])
        levels = [o["evidence_level"] for o in payload["ayurvedic_options"]]
        rank = {"clinical": 0, "preclinical": 1, "traditional": 2}
        self.assertEqual(levels, sorted(levels, key=lambda level: rank[level]))

    def test_every_supported_condition_can_be_answered(self):
        for condition in knowledge.list_conditions(self.conn):
            payload = self.ask(condition_ids=[condition["condition_id"]])
            self.assertEqual(payload["status"], recommend.STATUS_RESULTS)
            self.assertTrue(
                payload["allopathic_options"],
                f"{condition['condition_id']} has no conventional option",
            )


# ---------------------------------------------------------------------------
# current medicines, aliases and combination checking
# ---------------------------------------------------------------------------

class CurrentMedicineTest(RecommendTestCase):
    def test_diabetes_with_metformin_as_a_current_medicine(self):
        payload = self.ask(text="my sugar is high", current_medicines=["Metformin"])
        self.assertEqual(payload["status"], recommend.STATUS_RESULTS)
        self.assertEqual(
            [m["name"] for m in payload["current_medicines"]["resolved"]], ["Metformin"]
        )

        # The curated table marks Turmeric + Metformin documented, so that pair
        # must be literature-verified and must carry its PMID.
        warning = self.warning_for(payload, "Turmeric", "Metformin")
        self.assertIsNotNone(warning)
        self.assertEqual(warning["level"], recommend.LEVEL_LITERATURE_VERIFIED)
        self.assertTrue(warning["against_current_medicine"])
        self.assertTrue(warning["citations"])
        self.assertTrue(all(c["pmid"] for c in warning["citations"]))

        # A pair with no record but a shared mechanism is mechanism-based, and
        # must say it is not literature-verified.
        gymnema = self.warning_for(payload, "Gymnema", "Metformin")
        self.assertEqual(gymnema["level"], recommend.LEVEL_MECHANISM_BASED)
        self.assertIn("not literature-verified", gymnema["label"])
        self.assertEqual(gymnema["citations"], [])

    def test_current_medicine_conflicts_are_sorted_first(self):
        payload = self.ask(text="my sugar is high", current_medicines=["Metformin"])
        against_current = [
            w["against_current_medicine"] for w in payload["combination_warnings"]
        ]
        # All True values come before any False value.
        self.assertEqual(against_current, sorted(against_current, reverse=True))

    def test_brand_name_resolves_but_is_never_echoed(self):
        payload = self.ask(text="my sugar is high", current_medicines=["Glycomet"])
        resolved = payload["current_medicines"]["resolved"]
        self.assertEqual([m["name"] for m in resolved], ["Metformin"])
        self.assertEqual(resolved[0]["query"], "Glycomet")
        # The brand appears only where the caller put it, never as a medicine name.
        serialized = json.dumps(
            {k: v for k, v in payload.items() if k != "current_medicines"}
        )
        self.assertNotIn("Glycomet", serialized)

    def test_generic_synonym_and_hinglish_herb_name_resolve(self):
        payload = self.ask(
            text="my sugar is high",
            current_medicines=["Acetylsalicylic acid", "Haldi", "Methi"],
        )
        resolved = {m["name"] for m in payload["current_medicines"]["resolved"]}
        self.assertEqual(resolved, {"Aspirin", "Turmeric", "Fenugreek"})

    def test_class_level_lay_term_resolves_to_a_class(self):
        payload = self.ask(text="my sugar is high", current_medicines=["blood thinner"])
        classes = payload["current_medicines"]["drug_classes"]
        self.assertEqual([c["drug_class"] for c in classes], ["Anticoagulants"])
        self.assertIn("Warfarin", classes[0]["members"])
        self.assertTrue(
            any("group of medicines" in n for n in payload["caution_notes"])
        )

    def test_hinglish_class_term_resolves(self):
        payload = self.ask(
            text="my sugar is high", current_medicines=["khoon patla karne ki dawa"]
        )
        self.assertEqual(
            [c["drug_class"] for c in payload["current_medicines"]["drug_classes"]],
            ["Anticoagulants"],
        )

    def test_unrecognised_current_medicine_is_reported_not_guessed(self):
        payload = self.ask(
            text="my sugar is high", current_medicines=["Paracetamol", "Metformin"]
        )
        self.assertEqual(payload["current_medicines"]["unresolved"], ["Paracetamol"])
        self.assertTrue(
            any("not recognised" in n for n in payload["caution_notes"])
        )
        # The one that did resolve is still checked.
        self.assertEqual(
            [m["name"] for m in payload["current_medicines"]["resolved"]], ["Metformin"]
        )

    def test_already_taking_a_suggested_option_is_called_out(self):
        payload = self.ask(text="my sugar is high", current_medicines=["Karela"])
        self.assertTrue(
            any("already take it" in n for n in payload["caution_notes"]),
            payload["caution_notes"],
        )


class CombinationTest(RecommendTestCase):
    def test_reverse_order_pair_gives_the_same_record(self):
        """Order-independence comes from reusing the existing interaction check."""
        rules = knowledge.combination_rules(self.conn)
        turmeric = {"medicine_id": "herb-turmeric", "name": "Turmeric",
                    "medicine_type": "herb"}
        metformin = {"medicine_id": "drug-metformin", "name": "Metformin",
                     "medicine_type": "drug"}
        tag_map = knowledge.tags_for_many(
            self.conn, ["herb-turmeric", "drug-metformin"]
        )

        forward = recommend.check_combination(
            self.conn, turmeric, metformin, rules, tag_map, False
        )
        backward = recommend.check_combination(
            self.conn, metformin, turmeric, rules, tag_map, False
        )
        self.assertEqual(forward["level"], backward["level"])
        self.assertEqual(forward["reason"], backward["reason"])
        self.assertEqual(
            [c["pmid"] for c in forward["citations"]],
            [c["pmid"] for c in backward["citations"]],
        )
        # Only the echoed order differs.
        self.assertEqual(forward["medicine_a"], "Turmeric")
        self.assertEqual(backward["medicine_a"], "Metformin")

    def test_pair_with_no_record_uses_the_required_wording(self):
        """A pair in the corpus with nothing found, and no rule, must say so exactly."""
        payload = self.ask(text="my sugar is high", current_medicines=["Losartan"])
        warning = self.warning_for(payload, "Gymnema", "Losartan")
        self.assertIsNotNone(warning)
        self.assertEqual(warning["level"], recommend.LEVEL_NO_DOCUMENTED)
        self.assertEqual(warning["reason"], recommend.NO_RECORD_SENTENCE)
        self.assertIn("does not mean the combination is safe", warning["reason"])
        self.assertEqual(warning["citations"], [])

    def test_herb_herb_pair_without_a_rule_is_insufficient_evidence(self):
        """Herb+herb was never harvested, so with no rule there is no basis to answer."""
        rules = knowledge.combination_rules(self.conn)
        # Sarpagandha (hypotensive, sedative, bradycardic) and Karela
        # (hypoglycemic) share no rule tag pair.
        left = {"medicine_id": "herb-sarpagandha", "name": "Sarpagandha",
                "medicine_type": "herb"}
        right = {"medicine_id": "herb-karela", "name": "Karela", "medicine_type": "herb"}
        tag_map = knowledge.tags_for_many(
            self.conn, ["herb-sarpagandha", "herb-karela"]
        )
        warning = recommend.check_combination(self.conn, left, right, rules, tag_map, True)
        self.assertEqual(warning["level"], recommend.LEVEL_INSUFFICIENT)
        self.assertEqual(warning["citations"], [])

    def test_drug_drug_rule_fires_for_two_antiplatelets(self):
        payload = self.ask(
            text="a heart attack last year", current_medicines=["Aspirin"]
        )
        warning = self.warning_for(payload, "Clopidogrel", "Aspirin")
        self.assertIsNotNone(warning)
        self.assertEqual(warning["level"], recommend.LEVEL_MECHANISM_BASED)
        self.assertIn("bleeding", warning["reason"].lower())

    def test_mechanism_warning_names_the_rules_it_fired(self):
        payload = self.ask(text="my sugar is high", current_medicines=["Metformin"])
        warning = self.warning_for(payload, "Karela", "Metformin")
        self.assertEqual(warning["level"], recommend.LEVEL_MECHANISM_BASED)
        self.assertTrue(warning["rules"])
        for rule in warning["rules"]:
            self.assertTrue(rule["rule_id"].startswith("rule-"))
            self.assertEqual(len(rule["tags"]), 2)

    def test_every_pair_is_counted_even_when_not_listed(self):
        payload = self.ask(text="my sugar is high")
        summary = payload["combination_summary"]
        self.assertEqual(
            summary["pairs_checked"],
            summary["warnings_listed"] + summary["pairs_with_no_finding_not_listed"],
        )
        self.assertGreater(summary["pairs_checked"], 0)

    def test_only_documented_pairs_claim_literature_verification(self):
        """The one label allowed to say literature-verified, across a broad sweep."""
        documented = {
            frozenset((r["medicine_a_id"], r["medicine_b_id"]))
            for r in self.conn.execute(
                "SELECT medicine_a_id, medicine_b_id FROM interactions "
                "WHERE status = 'interaction_found'"
            )
        }
        resolve = {}
        for row in self.conn.execute("SELECT id, name FROM medicines"):
            resolve[row["name"]] = row["id"]

        for condition in knowledge.list_conditions(self.conn):
            payload = self.ask(condition_ids=[condition["condition_id"]])
            for warning in payload["combination_warnings"]:
                if warning["level"] != recommend.LEVEL_LITERATURE_VERIFIED:
                    self.assertEqual(
                        warning["citations"], [],
                        f"{warning['medicine_a']} + {warning['medicine_b']} is "
                        f"{warning['level']} but carries citations",
                    )
                    continue
                pair = frozenset(
                    (resolve[warning["medicine_a"]], resolve[warning["medicine_b"]])
                )
                self.assertIn(pair, documented)
                self.assertTrue(warning["citations"])


# ---------------------------------------------------------------------------
# output rules
# ---------------------------------------------------------------------------

def _walk_strings(value, path="$"):
    """Every string in a nested payload, with the path it was found at."""
    if isinstance(value, str):
        yield path, value
    elif isinstance(value, dict):
        for key, item in value.items():
            yield from _walk_strings(item, f"{path}.{key}")
    elif isinstance(value, list):
        for index, item in enumerate(value):
            yield from _walk_strings(item, f"{path}[{index}]")


class ForbiddenOutputTest(RecommendTestCase):
    """No dose, no brand name and no safety claim in any response string."""

    # The caller's own words come back in these fields so they can see what was
    # understood. A brand the user typed is theirs, not ours.
    ECHOED_PATHS = re.compile(r"\.(query|unresolved)\b|\.ambiguous\[")

    def responses(self):
        yield "diabetes", self.ask(text="my sugar is high")
        yield "diabetes+current", self.ask(
            text="my sugar is high", current_medicines=["Metformin", "Haldi"]
        )
        yield "two conditions", self.ask(text="sugar aur BP dono high hai")
        yield "clot", self.ask(text="a clot in my leg")
        yield "heart attack", self.ask(
            text="a heart attack last year", current_medicines=["Ecosprin"]
        )
        yield "heart failure", self.ask(condition_ids=["heart_failure"])
        yield "atrial fibrillation", self.ask(condition_ids=["atrial_fibrillation"])
        yield "all conditions", self.ask(
            condition_ids=[c["condition_id"] for c in knowledge.list_conditions(self.conn)]
        )
        yield "emergency", self.ask(text="I have chest pain")
        yield "emergency hinglish", self.ask(text="seene me dard hai")
        yield "suicidal", self.ask(text="jeene ka man nahi hai")
        yield "out of scope", self.ask(text="i have a headache")
        yield "low confidence", self.ask(text="swelling ke liye kya karu")

    def test_no_dosing_anywhere(self):
        for label, payload in self.responses():
            for path, text in _walk_strings(payload):
                for pattern, why in FORBIDDEN_OUTPUT_PATTERNS:
                    match = re.search(pattern, text, re.IGNORECASE)
                    self.assertIsNone(
                        match,
                        f"{label} {path}: {why} -> {match.group(0)!r} in {text!r}"
                        if match else "",
                    )

    def test_safety_is_only_ever_mentioned_to_deny_a_claim(self):
        """"safe" may appear only in a negated sentence.

        The wording required for a pair with no record contains it ("This does
        not mean the combination is safe"), so the word cannot simply be banned.
        An unnegated mention would be a safety claim this project cannot support.
        """
        for label, payload in self.responses():
            for path, text in _walk_strings(payload):
                self.assertEqual(
                    safety_claim_problems(text), [], f"{label} {path}: {text!r}"
                )

    def test_the_safety_scan_itself_is_calibrated(self):
        """Guards the scan: it must forbid claims without forbidding cautions.

        A scan that swept for the bare word "safe" would reject both the wording
        this project is required to use and the warnings that mention a narrow
        safety margin, so it would have to be switched off to ship.
        """
        must_pass = (
            recommend.NO_RECORD_SENTENCE,
            "This is not safe for children.",
            "Narrow safety margin; needs monitoring.",
            "A small rise in a medicine with a narrow safety margin can be harmful.",
            "The safe and toxic blood levels are very close.",
            "Long safety record; does not usually cause low sugar.",
        )
        must_fail = (
            "This combination is safe.",
            "Garlic is generally safe with warfarin.",
            "It is completely safe to take together.",
            "safe for use in pregnancy",
            "Metformin is safer than glimepiride.",
        )
        for text in must_pass:
            self.assertEqual(safety_claim_problems(text), [], text)
        for text in must_fail:
            self.assertTrue(safety_claim_problems(text), text)

    def test_no_brand_name_anywhere(self):
        brands = brand_names()
        self.assertTrue(brands, "the alias table declares no brand names to check")
        for label, payload in self.responses():
            for path, text in _walk_strings(payload):
                if self.ECHOED_PATHS.search(path):
                    continue
                for brand in brands:
                    self.assertIsNone(
                        re.search(rf"\b{re.escape(brand)}\b", text, re.IGNORECASE),
                        f"{label} {path}: brand name {brand!r} in {text!r}",
                    )

    def test_every_response_carries_the_disclaimer(self):
        for label, payload in self.responses():
            disclaimer = payload.get("disclaimer", "").lower()
            self.assertIn("not medical advice", disclaimer, label)
            self.assertIn("doctor or pharmacist", disclaimer, label)
            self.assertIn("start or stop", disclaimer, label)

    def test_brand_names_are_not_exposed_by_the_medicine_detail_endpoint(self):
        """The resolver knows brand names; no endpoint prints them."""
        status, payload = api.handle("GET", "/medicines/drug-metformin", {}, db_path=_DB)
        self.assertEqual(status, 200)
        aliases = [a["alias"] for a in payload["aliases"]]
        self.assertNotIn("Glycomet", aliases)
        self.assertIn("Metformin hydrochloride", aliases)
        self.assertNotIn(
            "brand_name", {a["alias_type"] for a in payload["aliases"]}
        )

    def test_brand_search_finds_the_medicine_without_echoing_the_brand(self):
        status, payload = api.handle(
            "GET", "/medicines/search", {"q": ["Glycomet"]}, db_path=_DB
        )
        self.assertEqual(status, 200)
        self.assertEqual(payload["results"][0]["name"], "Metformin")
        self.assertNotIn("Glycomet", json.dumps(payload["results"]))


# ---------------------------------------------------------------------------
# request validation and route behaviour
# ---------------------------------------------------------------------------

class RouteTest(RecommendTestCase):
    def test_post_recommend_returns_200(self):
        status, payload = self.post({"text": "my sugar is high"})
        self.assertEqual(status, 200)
        self.assertEqual(payload["status"], recommend.STATUS_RESULTS)

    def test_get_is_not_allowed(self):
        status, payload = api.handle("GET", "/recommend", {}, db_path=_DB)
        self.assertEqual(status, 405)
        self.assertEqual(payload["error"]["code"], "method_not_allowed")

    def test_text_over_the_limit_is_rejected(self):
        status, payload = self.post({"text": "a" * (recommend.MAX_TEXT_LENGTH + 1)})
        self.assertEqual(status, 400)
        self.assertEqual(payload["error"]["code"], "invalid_parameter")

    def test_text_at_the_limit_is_accepted(self):
        status, _ = self.post({"text": "my sugar is high " * 10})
        self.assertEqual(status, 200)

    def test_missing_text_without_condition_ids_is_rejected(self):
        status, payload = self.post({})
        self.assertEqual(status, 400)
        self.assertEqual(payload["error"]["code"], "missing_parameter")

    def test_blank_text_is_rejected(self):
        status, payload = self.post({"text": "   "})
        self.assertEqual(status, 400)
        self.assertEqual(payload["error"]["code"], "invalid_parameter")

    def test_wrong_types_are_rejected(self):
        for body in (
            {"text": 42},
            {"text": "sugar", "current_medicines": "Metformin"},
            {"text": "sugar", "current_medicines": [1, 2]},
            {"text": "sugar", "cautions": []},
            {"text": "sugar", "cautions": {"under_18": "yes"}},
            {"text": "sugar", "condition_ids": "type_2_diabetes"},
        ):
            status, payload = self.post(body)
            self.assertEqual(status, 400, body)
            self.assertEqual(payload["error"]["code"], "invalid_parameter", body)

    def test_unknown_body_field_is_rejected(self):
        status, payload = self.post({"text": "sugar", "temperature": 0.7})
        self.assertEqual(status, 400)
        self.assertEqual(payload["error"]["code"], "invalid_body")

    def test_non_object_body_is_rejected(self):
        status, payload = api.handle("POST", "/recommend", {}, ["sugar"], db_path=_DB)
        self.assertEqual(status, 400)
        self.assertEqual(payload["error"]["code"], "invalid_body")

    def test_too_many_current_medicines_is_rejected(self):
        status, payload = self.post(
            {"text": "sugar", "current_medicines": ["Metformin"] * 21}
        )
        self.assertEqual(status, 400)
        self.assertEqual(payload["error"]["code"], "invalid_parameter")

    def test_no_stack_trace_reaches_the_client(self):
        with mock.patch.object(
            recommend, "recommend", side_effect=RuntimeError("secret internals")
        ):
            with mock.patch("sys.stderr"):
                status, payload = self.post({"text": "my sugar is high"})
        self.assertEqual(status, 500)
        self.assertEqual(payload["error"]["code"], "internal_error")
        serialized = json.dumps(payload)
        self.assertNotIn("secret internals", serialized)
        self.assertNotIn("Traceback", serialized)

    def test_missing_classifier_is_a_503_not_a_400(self):
        with mock.patch.object(
            classify, "load_classifier",
            side_effect=classify.ClassifierUnavailable("not trained"),
        ):
            status, payload = self.post({"text": "my sugar is high"})
        self.assertEqual(status, 503)
        self.assertEqual(payload["error"]["code"], "classifier_unavailable")

    def test_conditions_endpoint_lists_the_supported_scope(self):
        status, payload = api.handle("GET", "/conditions", {}, db_path=_DB)
        self.assertEqual(status, 200)
        self.assertEqual(payload["count"], 6)
        self.assertIn(
            "type_2_diabetes", [c["condition_id"] for c in payload["results"]]
        )

    def test_recommend_is_listed_on_the_index(self):
        status, payload = api.handle("GET", "/", {}, db_path=_DB)
        self.assertEqual(status, 200)
        self.assertIn("POST /recommend", payload["endpoints"])


# ---------------------------------------------------------------------------
# the no-model, no-network guarantee
# ---------------------------------------------------------------------------

class ServiceIsolationTest(unittest.TestCase):
    """The request path must stay deterministic and offline.

    An LLM or an HTTP call here would let generated text stand in for sourced
    evidence, and would make the same question answerable two different ways.
    """

    SERVICE_MODULES = (recommend, safety, classify, knowledge, catalog, api)

    # Standard-library modules that could reach the network or shell out. These
    # need naming because test_service_modules_import_nothing_outside_the_
    # standard_library cannot catch them -- they *are* standard library. A
    # third-party model or HTTP client is caught by that test instead, whatever
    # it is called, which is stronger than any list of vendor names could be.
    FORBIDDEN_IMPORTS = (
        "urllib.request", "urllib.error", "http.client", "import socket",
        "import subprocess", "from subprocess", "import ctypes", "import ssl",
        "import ftplib", "import smtplib", "import telnetlib", "import asyncio",
        "eval(", "exec(", "pickle", "marshal",
    )

    def test_no_network_or_shell_access_in_the_service_modules(self):
        for module in self.SERVICE_MODULES:
            source = Path(module.__file__).read_text(encoding="utf-8")
            for forbidden in self.FORBIDDEN_IMPORTS:
                self.assertNotIn(
                    forbidden, source, f"{module.__name__} contains {forbidden!r}"
                )

    def test_service_modules_import_nothing_outside_the_standard_library(self):
        """Walk the real import graph, not just the text of each file."""
        allowed_prefixes = ("hdi.", "hdi")
        standard = set(sys.stdlib_module_names)
        for module in self.SERVICE_MODULES:
            source = Path(module.__file__).read_text(encoding="utf-8")
            for match in re.finditer(
                r"^\s*(?:from|import)\s+([a-zA-Z_][\w.]*)", source, re.MULTILINE
            ):
                root = match.group(1).split(".")[0]
                self.assertTrue(
                    root in standard or match.group(1).startswith(allowed_prefixes),
                    f"{module.__name__} imports {match.group(1)!r}, which is neither "
                    f"standard library nor hdi",
                )

    def test_the_classifier_is_a_plain_json_file(self):
        """No pickle, no joblib, nothing executable on the request path."""
        self.assertTrue(classify.DEFAULT_ARTIFACT.suffix == ".json")
        artifact = json.loads(classify.DEFAULT_ARTIFACT.read_text(encoding="utf-8"))
        self.assertEqual(artifact["format"], classify.ARTIFACT_FORMAT)

    def test_two_identical_requests_give_identical_answers(self):
        conn = db.connect(_DB, read_only=True)
        self.addCleanup(conn.close)
        first = recommend.recommend(conn, text="my sugar is high",
                                   current_medicines=["Metformin"])
        second = recommend.recommend(conn, text="my sugar is high",
                                    current_medicines=["Metformin"])
        self.assertEqual(json.dumps(first, sort_keys=True), json.dumps(second, sort_keys=True))


if __name__ == "__main__":
    unittest.main()
