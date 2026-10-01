"""Tests for the condition classifier: parity with scikit-learn, and dataset hygiene.

The parity test is the one that matters. hdi/classify.py reimplements TF-IDF and
one-vs-rest logistic regression in the standard library so the API needs no
scientific stack, and nothing but a test keeps that reimplementation honest. If
the vectorizer configuration in ml/train.py ever changes without hdi/classify.py
changing with it, this is what says so.

Tests needing scikit-learn skip cleanly when it is absent, because the API does
not need it and a checkout that only runs the backend should still pass.
"""

import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from hdi import classify

DATA_DIR = ROOT / "ml" / "data"
ARTIFACT_DIR = ROOT / "ml" / "artifacts"
JSON_ARTIFACT = ARTIFACT_DIR / "condition_classifier.json"
SKLEARN_ARTIFACT = ARTIFACT_DIR / "condition_classifier.joblib"
REPORT = ROOT / "ml" / "reports" / "eval.md"

PARITY_TOLERANCE = 1e-4
MIN_PARITY_INPUTS = 30


def have_sklearn():
    try:
        import joblib  # noqa: F401
        import sklearn  # noqa: F401
        return True
    except ImportError:
        return False


def load_jsonl(path):
    with open(path, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


class DatasetTest(unittest.TestCase):
    """The dataset's own guarantees, checkable without scikit-learn."""

    @classmethod
    def setUpClass(cls):
        if not (DATA_DIR / "train.jsonl").exists():
            raise unittest.SkipTest("run `python ml/make_dataset.py` first")
        cls.train = load_jsonl(DATA_DIR / "train.jsonl")
        cls.test = load_jsonl(DATA_DIR / "test.jsonl")

    def counts(self, rows):
        per, multi = {}, 0
        for row in rows:
            if not row["labels"]:
                per["out_of_scope"] = per.get("out_of_scope", 0) + 1
            else:
                for label in row["labels"]:
                    per[label] = per.get(label, 0) + 1
                if len(row["labels"]) > 1:
                    multi += 1
        return per, multi

    def test_train_and_test_share_no_identical_string(self):
        """Leakage check. An overlap would make the test score memorization."""
        overlap = {r["text"] for r in self.train} & {r["text"] for r in self.test}
        self.assertEqual(overlap, set(), f"{len(overlap)} shared strings")

    def test_train_and_test_phrase_pools_are_disjoint(self):
        """Stronger than the string check: the underlying wordings differ too."""
        train_phrases = {p for r in self.train for p in r["phrases"]}
        test_phrases = {p for r in self.test for p in r["phrases"]}
        self.assertEqual(train_phrases & test_phrases, set())

    def test_no_duplicate_rows_within_a_split(self):
        for name, rows in (("train", self.train), ("test", self.test)):
            texts = [r["text"] for r in rows]
            self.assertEqual(len(texts), len(set(texts)), name)

    def test_at_least_150_training_examples_per_condition(self):
        per, _ = self.counts(self.train)
        for label, n in per.items():
            if label == "out_of_scope":
                continue
            self.assertGreaterEqual(n, 150, label)

    def test_at_least_30_multi_condition_training_examples(self):
        _, multi = self.counts(self.train)
        self.assertGreaterEqual(multi, 30)

    def test_at_least_200_out_of_scope_training_examples(self):
        per, _ = self.counts(self.train)
        self.assertGreaterEqual(per["out_of_scope"], 200)

    def test_at_least_40_test_examples_per_class(self):
        per, _ = self.counts(self.test)
        self.assertEqual(len(per), 7, sorted(per))
        for label, n in per.items():
            self.assertGreaterEqual(n, 40, label)

    def test_every_label_is_a_supported_condition(self):
        import csv

        with open(ROOT / "data" / "reference" / "conditions.csv", encoding="utf-8") as f:
            supported = {row["condition_id"] for row in csv.DictReader(f)}
        for rows in (self.train, self.test):
            for row in rows:
                for label in row["labels"]:
                    self.assertIn(label, supported, row["text"])

    def test_the_dataset_is_reproducible_from_its_seed(self):
        """Regenerating must produce byte-identical files."""
        import subprocess

        before = {
            name: (DATA_DIR / name).read_bytes() for name in ("train.jsonl", "test.jsonl")
        }
        result = subprocess.run(
            [sys.executable, str(ROOT / "ml" / "make_dataset.py")],
            capture_output=True, cwd=str(ROOT),
        )
        self.assertEqual(result.returncode, 0, result.stderr.decode("utf-8", "replace"))
        for name, content in before.items():
            self.assertEqual(
                (DATA_DIR / name).read_bytes(), content,
                f"{name} changed when regenerated from the same seed",
            )

    def test_no_red_flag_wording_is_used_as_training_data(self):
        """A red-flag phrase never reaches the classifier at request time.

        Training on one would be training on text the pipeline short-circuits
        before classification, which would be measuring something that cannot
        happen.
        """
        from hdi import safety

        screen = safety.load_red_flags()
        for rows in (self.train, self.test):
            for row in rows:
                self.assertEqual(
                    screen.check(row["text"]), [],
                    f"{row['text']!r} would be caught by the red-flag screen",
                )


class ArtifactTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not JSON_ARTIFACT.exists():
            raise unittest.SkipTest("run `python ml/train.py` first")
        cls.classifier = classify.load_classifier()
        cls.artifact = json.loads(JSON_ARTIFACT.read_text(encoding="utf-8"))

    def test_the_artifact_declares_its_format(self):
        self.assertEqual(self.artifact["format"], classify.ARTIFACT_FORMAT)

    def test_the_artifact_shape_is_consistent(self):
        vocabulary = self.artifact["vectorizer"]["vocabulary"]
        idf = self.artifact["vectorizer"]["idf"]
        self.assertEqual(len(idf), len(vocabulary))
        self.assertEqual(sorted(vocabulary.values()), list(range(len(vocabulary))))
        self.assertEqual(len(self.artifact["coefficients"]), len(self.artifact["classes"]))
        self.assertEqual(len(self.artifact["intercepts"]), len(self.artifact["classes"]))
        for row in self.artifact["coefficients"]:
            self.assertEqual(len(row), len(vocabulary))

    def test_there_is_no_out_of_scope_coefficient_vector(self):
        """out_of_scope is a decision, not a trained class."""
        self.assertNotIn("out_of_scope", self.artifact["classes"])

    def test_the_threshold_is_in_range(self):
        self.assertGreater(self.classifier.threshold, 0.0)
        self.assertLess(self.classifier.threshold, 1.0)

    def test_the_low_confidence_band_sits_below_the_threshold(self):
        self.assertLess(self.classifier.low_confidence_floor, self.classifier.threshold)
        self.assertGreater(self.classifier.low_confidence_floor, 0.0)

    def test_scores_are_probabilities(self):
        for text in ("my sugar is high", "", "zzz", "bp badh gaya hai"):
            for condition_id, score in self.classifier.scores(text).items():
                self.assertGreaterEqual(score, 0.0, (text, condition_id))
                self.assertLessEqual(score, 1.0, (text, condition_id))

    def test_the_three_outcomes_follow_the_bands(self):
        """Status is a pure function of the scores and the two thresholds."""
        for text in (
            "my sugar is high", "bp badh gaya hai", "i have a headache", "dandruff",
            "swelling ke liye kya karu", "a clot in my leg", "zzz qqq",
        ):
            status, detected, scores = self.classifier.classify(text)
            best = max(scores.values())
            if best >= self.classifier.threshold:
                self.assertEqual(status, classify.STATUS_RESULTS, text)
                self.assertTrue(detected, text)
            elif best >= self.classifier.low_confidence_floor:
                self.assertEqual(status, classify.STATUS_LOW_CONFIDENCE, text)
                self.assertEqual(detected, [], text)
            else:
                self.assertEqual(status, classify.STATUS_OUT_OF_SCOPE, text)
                self.assertEqual(detected, [], text)

    def test_an_empty_input_detects_nothing(self):
        status, detected, _ = self.classifier.classify("")
        self.assertIn(
            status, (classify.STATUS_OUT_OF_SCOPE, classify.STATUS_LOW_CONFIDENCE)
        )
        self.assertEqual(detected, [])

    def test_a_malformed_artifact_is_refused_not_guessed(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "bad.json"
            path.write_text(json.dumps({"format": "something/else"}), encoding="utf-8")
            with self.assertRaises(classify.ClassifierUnavailable):
                classify.load_classifier(path)

            path = Path(tmpdir) / "notjson.json"
            path.write_text("{not json", encoding="utf-8")
            with self.assertRaises(classify.ClassifierUnavailable):
                classify.load_classifier(path)

    def test_a_missing_artifact_raises_rather_than_degrading(self):
        with self.assertRaises(classify.ClassifierUnavailable):
            classify.load_classifier(ROOT / "ml" / "artifacts" / "does-not-exist.json")


@unittest.skipUnless(have_sklearn(), "scikit-learn is not installed")
class ParityTest(unittest.TestCase):
    """hdi/classify.py must reproduce the scikit-learn pipeline it was exported from."""

    @classmethod
    def setUpClass(cls):
        if not SKLEARN_ARTIFACT.exists() or not JSON_ARTIFACT.exists():
            raise unittest.SkipTest("run `python ml/train.py` first")
        import joblib

        bundle = joblib.load(SKLEARN_ARTIFACT)
        cls.pipeline = bundle["pipeline"]
        cls.sklearn_classes = list(bundle["classes"])
        cls.sklearn_threshold = bundle["threshold"]
        cls.classifier = classify.load_classifier()

    def inputs(self):
        """At least 30: real test rows plus awkward cases a template would not make."""
        texts = [r["text"] for r in load_jsonl(DATA_DIR / "test.jsonl")][:40]
        texts += [
            "", "   ", "zzz", "MY SUGAR IS HIGH!!!", "sugar...bp???",
            "sugar sugar sugar sugar", "123 456", "bp 140/90 hai",
            "diabetes & hypertension", "\ttabbed\tsugar\t",
            "a" * 400, "sugar aur bp dono high hai", "non-ascii free text",
            "Punctuation, lots; of: it! sugar?", "sugaar highh hai",
        ]
        return texts

    def test_the_class_list_and_threshold_match(self):
        self.assertEqual(self.classifier.classes, self.sklearn_classes)
        self.assertAlmostEqual(self.classifier.threshold, self.sklearn_threshold, places=12)

    def test_probabilities_match_sklearn_within_tolerance(self):
        texts = self.inputs()
        self.assertGreaterEqual(len(texts), MIN_PARITY_INPUTS)

        expected = self.pipeline.predict_proba(texts)
        worst, worst_text = 0.0, None
        for index, text in enumerate(texts):
            mine = self.classifier.scores(text)
            for column, condition_id in enumerate(self.sklearn_classes):
                difference = abs(mine[condition_id] - float(expected[index][column]))
                if difference > worst:
                    worst, worst_text = difference, text
                self.assertLess(
                    difference, PARITY_TOLERANCE,
                    f"{condition_id} on {text!r}: pure-Python {mine[condition_id]!r} vs "
                    f"sklearn {float(expected[index][column])!r}",
                )
        self.assertLess(worst, PARITY_TOLERANCE, f"worst case was {worst_text!r}")

    def test_the_tokenizer_matches_sklearn_feature_for_feature(self):
        """Parity of the analyzer itself, not just of the final probability.

        A probability can match by luck when a term is out of vocabulary; the
        feature multiset cannot.
        """
        analyzer = self.pipeline.named_steps["tfidf"].build_analyzer()
        for text in self.inputs():
            self.assertEqual(
                sorted(self.classifier._analyze(text)), sorted(analyzer(text)), repr(text)
            )

    def test_the_exported_vocabulary_matches_the_fitted_one(self):
        fitted = self.pipeline.named_steps["tfidf"].vocabulary_
        self.assertEqual(
            {term: int(i) for term, i in fitted.items()}, self.classifier._vocabulary
        )


class EvaluationReportTest(unittest.TestCase):
    """The report must exist and must state the synthetic caveat."""

    @classmethod
    def setUpClass(cls):
        if not REPORT.exists():
            raise unittest.SkipTest("run `python ml/evaluate.py` first")
        cls.text = REPORT.read_text(encoding="utf-8")

    def test_the_report_says_the_test_set_is_synthetic(self):
        lowered = self.text.lower()
        self.assertIn("synthetic", lowered)
        self.assertIn("overstates real-world performance", lowered)

    def test_the_report_states_a_macro_f1(self):
        import re

        match = re.search(r"\*\*Macro-F1: ([0-9.]+)\*\*", self.text)
        self.assertIsNotNone(match, "the report does not state a macro-F1")
        self.assertGreaterEqual(float(match.group(1)), 0.85)

    def test_the_confusion_matrix_was_written_as_data(self):
        self.assertTrue((ROOT / "ml" / "reports" / "confusion_matrix.csv").exists())


if __name__ == "__main__":
    unittest.main()
