"""Condition classifier inference, standard library only.

The model is trained with scikit-learn (ml/train.py) and exported to
ml/artifacts/condition_classifier.json. This module reads that file and
reproduces the arithmetic by hand, so the API keeps the no-dependency design
recorded in docs/BACKEND_API.md: no scikit-learn, no numpy, no model runtime on
the request path, and nothing to download at startup.

tests/test_classifier.py asserts the two agree to within 1e-4 on a sample of
inputs. If the vectorizer configuration in ml/train.py changes, that test is
what tells you this file has to change with it.

Three outcomes, which the service maps straight onto a response status:

  at least one condition at or above the threshold   -> results
  the best condition in the band below it            -> low_confidence
  nothing even close                                 -> out_of_scope

The threshold is tuned on validation data by ml/train.py and travels inside the
artifact. The low-confidence band is a product decision rather than a fitted
value: the floor below which we stop guessing at all.
"""

import json
import math
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_ARTIFACT = ROOT / "ml" / "artifacts" / "condition_classifier.json"

ARTIFACT_FORMAT = "ayurveda-hdi/condition-classifier/1"

STATUS_RESULTS = "results"
STATUS_LOW_CONFIDENCE = "low_confidence"
STATUS_OUT_OF_SCOPE = "out_of_scope"

# The low-confidence band: scores in [floor, threshold) mean "the model nearly
# fired, but we will not assert which condition". Below the floor we answer
# out_of_scope rather than hand back a condition picker nobody asked for.
#
# Expressed as a margin below the tuned threshold rather than a fraction of it,
# because a fraction of a low threshold lands inside the noise. Unrelated
# complaints ("dandruff", "my knees hurt") score around 0.10-0.20 against every
# condition, so LOW_CONFIDENCE_MINIMUM keeps the band clear of that floor
# however low the tuned threshold goes. Both numbers are product decisions, not
# fitted values, and they only ever move a score from one non-answer to another:
# neither can turn a rejected guess into a reported condition.
LOW_CONFIDENCE_MARGIN = 0.08
LOW_CONFIDENCE_MINIMUM = 0.20

_cache = {}


class ClassifierUnavailable(RuntimeError):
    """The exported artifact is missing or unreadable.

    Raised rather than silently falling back to keyword matching: a classifier
    that quietly degrades into something else would make the API's answers
    untraceable.
    """


class ConditionClassifier:
    """TF-IDF + one-vs-rest logistic regression, evaluated in pure Python."""

    def __init__(self, artifact):
        if artifact.get("format") != ARTIFACT_FORMAT:
            raise ClassifierUnavailable(
                f"unexpected artifact format {artifact.get('format')!r}; "
                f"expected {ARTIFACT_FORMAT!r}"
            )
        vectorizer = artifact["vectorizer"]
        if vectorizer["analyzer"] != "word" or vectorizer["norm"] != "l2":
            raise ClassifierUnavailable(
                "this module implements the word analyzer with l2 normalization only"
            )
        if not vectorizer["sublinear_tf"]:
            raise ClassifierUnavailable("this module implements sublinear tf only")

        self.classes = list(artifact["classes"])
        self.threshold = float(artifact["threshold"])
        self.low_confidence_floor = max(
            self.threshold - LOW_CONFIDENCE_MARGIN, LOW_CONFIDENCE_MINIMUM
        )
        self.metadata = artifact.get("metadata", {})

        self._lowercase = bool(vectorizer["lowercase"])
        self._token_re = re.compile(vectorizer["token_pattern"])
        self._min_n, self._max_n = (int(n) for n in vectorizer["ngram_range"])
        self._vocabulary = vectorizer["vocabulary"]
        self._idf = vectorizer["idf"]
        self._coefficients = artifact["coefficients"]
        self._intercepts = artifact["intercepts"]

        if len(self._coefficients) != len(self.classes):
            raise ClassifierUnavailable("coefficient rows do not match the class list")

    # -- vectorizer ---------------------------------------------------------

    def _analyze(self, text):
        """Feature strings for one document, matching sklearn's word analyzer.

        sklearn lowercases, applies the token pattern with re.findall, then
        emits the unigrams followed by every n-gram joined on a single space.
        Reproducing the order is not necessary -- only the multiset of features
        is -- but reproducing the joining exactly is.
        """
        if self._lowercase:
            text = text.lower()
        tokens = self._token_re.findall(text)

        features = list(tokens) if self._min_n == 1 else []
        start = max(self._min_n, 2)
        for n in range(start, min(self._max_n + 1, len(tokens) + 1)):
            for i in range(len(tokens) - n + 1):
                features.append(" ".join(tokens[i: i + n]))
        return features

    def _vector(self, text):
        """Sparse tf-idf vector as {column index: value}, l2-normalized."""
        counts = {}
        for feature in self._analyze(text):
            column = self._vocabulary.get(feature)
            if column is not None:
                counts[column] = counts.get(column, 0) + 1

        vector = {}
        for column, count in counts.items():
            # sublinear_tf, then idf; the same two steps as TfidfTransformer.
            vector[column] = (1.0 + math.log(count)) * self._idf[column]

        norm = math.sqrt(sum(v * v for v in vector.values()))
        if norm > 0.0:
            for column in vector:
                vector[column] /= norm
        return vector

    # -- classifier ---------------------------------------------------------

    def scores(self, text):
        """Probability per condition, as the one-vs-rest sigmoid of each margin."""
        vector = self._vector(text)
        result = {}
        for index, condition_id in enumerate(self.classes):
            coefficients = self._coefficients[index]
            margin = self._intercepts[index]
            for column, value in vector.items():
                margin += coefficients[column] * value
            result[condition_id] = _sigmoid(margin)
        return result

    def classify(self, text):
        """Return (status, detected, scores).

        detected is a list of {"condition_id", "confidence"} sorted by
        confidence, highest first. It is empty for low_confidence and for
        out_of_scope, so a caller cannot read a rejected guess as a finding.
        """
        scores = self.scores(text)
        above = [
            {"condition_id": c, "confidence": round(p, 4)}
            for c, p in scores.items()
            if p >= self.threshold
        ]
        above.sort(key=lambda d: (-d["confidence"], d["condition_id"]))
        if above:
            return STATUS_RESULTS, above, scores

        best = max(scores.values()) if scores else 0.0
        if best >= self.low_confidence_floor:
            return STATUS_LOW_CONFIDENCE, [], scores
        return STATUS_OUT_OF_SCOPE, [], scores


def _sigmoid(x):
    """Logistic function, written to not overflow on a large negative margin."""
    if x >= 0.0:
        return 1.0 / (1.0 + math.exp(-x))
    exp_x = math.exp(x)
    return exp_x / (1.0 + exp_x)


def load_classifier(path=None):
    """Load and cache the exported classifier.

    Cached by resolved path and modification time, so re-training and
    re-exporting is picked up without restarting a long-lived process.
    """
    path = Path(path or DEFAULT_ARTIFACT)
    try:
        stamp = path.stat().st_mtime_ns
    except OSError as exc:
        raise ClassifierUnavailable(
            f"{path} is not readable; train and export it with `python ml/train.py`"
        ) from exc

    key = (str(path.resolve()), stamp)
    if key not in _cache:
        try:
            artifact = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise ClassifierUnavailable(f"{path} could not be parsed: {exc}") from exc
        _cache.clear()
        _cache[key] = ConditionClassifier(artifact)
    return _cache[key]


def is_available(path=None):
    try:
        load_classifier(path)
        return True
    except ClassifierUnavailable:
        return False
