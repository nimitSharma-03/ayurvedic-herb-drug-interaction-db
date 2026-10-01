"""Train the multi-label condition classifier and export it for pure-Python inference.

    python ml/train.py

Reads ml/data/train.jsonl, holds back a validation split to tune the decision
threshold, and writes two things:

  ml/artifacts/condition_classifier.json   vocabulary, idf, coefficients,
                                           intercepts, classes, threshold
  ml/artifacts/condition_classifier.joblib the fitted scikit-learn pipeline

Only the JSON is on the API's request path. hdi/classify.py reads it and does
the arithmetic with the standard library alone, which is what keeps the backend
dependency-free (docs/BACKEND_API.md). The joblib file exists so a test can
assert that the two agree (tests/test_classifier.py).

The model is one-vs-rest logistic regression over the supported conditions
only. There is no out_of_scope coefficient vector: out_of_scope is what it
means when no condition clears the threshold, which is also how the
out-of-scope rows are labelled in the dataset (an empty label list).

Needs scikit-learn. The API does not.
"""

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

DATA_DIR = ROOT / "ml" / "data"
ARTIFACT_DIR = ROOT / "ml" / "artifacts"
JSON_ARTIFACT = ARTIFACT_DIR / "condition_classifier.json"
SKLEARN_ARTIFACT = ARTIFACT_DIR / "condition_classifier.joblib"

SEED = 20260401
VALIDATION_FRACTION = 0.2

# Fixed so hdi/classify.py can hard-code the same analyzer. Changing any of
# these means changing hdi/classify.py too, and the parity test will say so.
TOKEN_PATTERN = r"[a-z0-9]+"
NGRAM_RANGE = (1, 2)

THRESHOLD_GRID = [round(0.05 + 0.01 * i, 2) for i in range(86)]


def load_jsonl(path):
    rows = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def split_validation(rows, fraction, seed):
    """Hold back whole *phrases*, not rows.

    A row-level split would put "mujhe sugar hai" in training and
    "mujhe sugar hai, what are my options" in validation, so the tuned
    threshold would be tuned against wordings the model had already seen. The
    held-out test set is built from entirely different phrasings, so a
    threshold tuned that way comes out far too high and the model under-reports
    on anything new.

    Phrases are held back per label set, so every label set keeps
    representation on both sides.
    """
    import random

    rng = random.Random(seed)
    by_label_set = {}
    for row in rows:
        by_label_set.setdefault(tuple(sorted(row["labels"])), set()).update(row["phrases"])

    held_back = set()
    for key in sorted(by_label_set):
        phrases = sorted(by_label_set[key])
        rng.shuffle(phrases)
        n = int(round(len(phrases) * fraction))
        held_back.update(phrases[:n])

    train, validation = [], []
    for row in rows:
        # A multi-condition row goes to validation only if *every* phrase in it
        # was held back; otherwise part of it was seen during fitting.
        if row["phrases"] and all(p in held_back for p in row["phrases"]):
            validation.append(row)
        elif not any(p in held_back for p in row["phrases"]):
            train.append(row)
        # Rows mixing a held-back phrase with a seen one are dropped: they
        # belong to neither side cleanly.
    rng.shuffle(train)
    rng.shuffle(validation)
    return train, validation


def label_classes(rows):
    return sorted({label for row in rows for label in row["labels"]})


def indicator(rows, classes):
    index = {c: i for i, c in enumerate(classes)}
    matrix = []
    for row in rows:
        vector = [0] * len(classes)
        for label in row["labels"]:
            vector[index[label]] = 1
        matrix.append(vector)
    return matrix


def predicted_sets(probabilities, classes, threshold):
    """Condition ids above threshold for each row; an empty set means out_of_scope."""
    return [
        {c for c, p in zip(classes, row) if p >= threshold}
        for row in probabilities
    ]


def per_class_scores(true_sets, pred_sets, classes):
    """Precision, recall and F1 for each condition plus the derived out_of_scope class.

    out_of_scope has no coefficient vector, so it is scored on the event "no
    condition was predicted" against the event "no condition was true". That is
    exactly the decision the API makes, so scoring it this way measures the
    thing that ships.
    """
    scores = {}
    for name in list(classes) + ["out_of_scope"]:
        tp = fp = fn = 0
        for true, pred in zip(true_sets, pred_sets):
            if name == "out_of_scope":
                is_true, is_pred = (not true), (not pred)
            else:
                is_true, is_pred = (name in true), (name in pred)
            if is_true and is_pred:
                tp += 1
            elif is_pred:
                fp += 1
            elif is_true:
                fn += 1
        precision = tp / (tp + fp) if tp + fp else 0.0
        recall = tp / (tp + fn) if tp + fn else 0.0
        f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
        scores[name] = {
            "precision": precision, "recall": recall, "f1": f1,
            "support": tp + fn, "true_positives": tp, "false_positives": fp,
            "false_negatives": fn,
        }
    return scores


def macro_f1(true_sets, pred_sets, classes):
    scores = per_class_scores(true_sets, pred_sets, classes)
    return sum(s["f1"] for s in scores.values()) / len(scores)


def build_pipeline():
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.linear_model import LogisticRegression
    from sklearn.multiclass import OneVsRestClassifier
    from sklearn.pipeline import Pipeline

    return Pipeline(
        [
            (
                "tfidf",
                TfidfVectorizer(
                    analyzer="word",
                    ngram_range=NGRAM_RANGE,
                    lowercase=True,
                    token_pattern=TOKEN_PATTERN,
                    sublinear_tf=True,
                    norm="l2",
                ),
            ),
            (
                "clf",
                OneVsRestClassifier(
                    LogisticRegression(
                        class_weight="balanced",
                        max_iter=2000,
                        C=4.0,
                        random_state=SEED,
                    )
                ),
            ),
        ]
    )


def export_json(pipeline, classes, threshold, metadata):
    vectorizer = pipeline.named_steps["tfidf"]
    ovr = pipeline.named_steps["clf"]

    coefficients, intercepts = [], []
    for estimator in ovr.estimators_:
        coefficients.append([float(v) for v in estimator.coef_[0]])
        intercepts.append(float(estimator.intercept_[0]))

    artifact = {
        "format": "ayurveda-hdi/condition-classifier/1",
        "classes": list(classes),
        "threshold": threshold,
        "vectorizer": {
            "analyzer": "word",
            "lowercase": True,
            "token_pattern": TOKEN_PATTERN,
            "ngram_range": list(NGRAM_RANGE),
            "sublinear_tf": True,
            "norm": "l2",
            "vocabulary": {term: int(i) for term, i in vectorizer.vocabulary_.items()},
            "idf": [float(v) for v in vectorizer.idf_],
        },
        "coefficients": coefficients,
        "intercepts": intercepts,
        "metadata": metadata,
    }
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    JSON_ARTIFACT.write_text(
        json.dumps(artifact, ensure_ascii=False, indent=1, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return artifact


def train():
    import joblib

    rows = load_jsonl(DATA_DIR / "train.jsonl")
    classes = label_classes(rows)
    train_rows, validation_rows = split_validation(rows, VALIDATION_FRACTION, SEED)
    print(f"train {len(train_rows)} rows, validation {len(validation_rows)} rows, "
          f"{len(classes)} conditions")

    pipeline = build_pipeline()
    pipeline.fit(
        [r["text"] for r in train_rows],
        indicator(train_rows, classes),
    )

    validation_probabilities = pipeline.predict_proba(
        [r["text"] for r in validation_rows]
    ).tolist()
    validation_true = [set(r["labels"]) for r in validation_rows]

    best = max(
        THRESHOLD_GRID,
        key=lambda t: (
            macro_f1(validation_true, predicted_sets(validation_probabilities, classes, t), classes),
            # Prefer the higher threshold on a tie: fewer conditions asserted
            # from the same evidence.
            t,
        ),
    )
    best_score = macro_f1(
        validation_true, predicted_sets(validation_probabilities, classes, best), classes
    )
    print(f"tuned threshold {best} (validation macro-F1 {best_score:.4f})")

    # Refit on everything now that the threshold is fixed, so the shipped model
    # has seen the whole training file.
    final = build_pipeline()
    final.fit([r["text"] for r in rows], indicator(rows, classes))

    vocabulary_size = len(final.named_steps["tfidf"].vocabulary_)
    metadata = {
        "seed": SEED,
        "training_rows": len(rows),
        "validation_rows": len(validation_rows),
        "validation_macro_f1": round(best_score, 4),
        "vocabulary_size": vocabulary_size,
        "dataset": "synthetic, generated by ml/make_dataset.py",
        "note": (
            "Trained on hand-written synthetic phrasings. Scores measure recall of those "
            "phrasings, not real-world performance."
        ),
    }

    artifact = export_json(final, classes, best, metadata)
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    joblib.dump({"pipeline": final, "classes": list(classes), "threshold": best},
                SKLEARN_ARTIFACT)

    size_mb = JSON_ARTIFACT.stat().st_size / (1024 * 1024)
    print(f"vocabulary {vocabulary_size} terms")
    print(f"wrote {JSON_ARTIFACT.relative_to(ROOT)} ({size_mb:.2f} MB)")
    print(f"wrote {SKLEARN_ARTIFACT.relative_to(ROOT)}")
    return artifact


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.parse_args()
    try:
        train()
    except ImportError as exc:
        print(f"scikit-learn and joblib are required to train: {exc}", file=sys.stderr)
        print("Install them with: python -m pip install -r requirements-ml.txt", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
