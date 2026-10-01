"""Evaluate the condition classifier on the held-out test set and write a report.

    python ml/evaluate.py

Reads ml/artifacts/condition_classifier.json (so it scores exactly what the API
will run, through hdi/classify.py) against ml/data/test.jsonl, and writes:

  ml/reports/eval.md                per-class scores, macro-F1, confusion matrix
  ml/reports/confusion_matrix.csv   the same matrix as data
  ml/reports/confusion_matrix.png   the same matrix as a figure

The test set is synthetic: both splits were written by hand in
ml/make_dataset.py from disjoint template and phrase pools. A score here says
the model generalizes from one set of invented phrasings to another set of
invented phrasings. It does not say how the model behaves on language nobody in
this project thought to write down, and every number below is reported with
that caveat attached.

The PNG needs matplotlib. Without it the CSV and the report are still written
and the report says the figure is missing.
"""

import argparse
import csv
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from hdi.classify import load_classifier  # noqa: E402  (after sys.path setup)
from ml.train import load_jsonl, per_class_scores, predicted_sets  # noqa: E402

DATA_DIR = ROOT / "ml" / "data"
REPORT_DIR = ROOT / "ml" / "reports"
OUT_OF_SCOPE = "out_of_scope"
MULTIPLE = "multiple_conditions"

TARGET_MACRO_F1 = 0.85


def confusion(rows, pred_sets, classes):
    """Confusion matrix over single-label rows.

    Multi-condition rows are left out on purpose: a row with two true labels
    has no single cell to land in, and spreading it across two would make the
    diagonal mean something different from every other row. They are scored
    separately in `multi_condition_scores`.

    The extra `multiple_conditions` column is where a single-label row goes
    when the classifier asserts more than one condition -- a real failure mode
    that a square matrix would otherwise hide inside the correct cell.
    """
    labels = list(classes) + [OUT_OF_SCOPE]
    columns = labels + [MULTIPLE]
    matrix = {t: {p: 0 for p in columns} for t in labels}

    for row, predicted in zip(rows, pred_sets):
        if len(row["labels"]) > 1:
            continue
        true = row["labels"][0] if row["labels"] else OUT_OF_SCOPE
        if not predicted:
            column = OUT_OF_SCOPE
        elif len(predicted) == 1:
            column = next(iter(predicted))
        else:
            column = MULTIPLE
        matrix[true][column] += 1
    return labels, columns, matrix


def multi_condition_scores(rows, pred_sets):
    """How the rows carrying two true conditions were handled."""
    total = exact = partial = missed = 0
    for row, predicted in zip(rows, pred_sets):
        true = set(row["labels"])
        if len(true) < 2:
            continue
        total += 1
        if predicted == true:
            exact += 1
        elif predicted & true:
            partial += 1
        else:
            missed += 1
    return {"total": total, "exact_set": exact, "partial": partial, "none_correct": missed}


def write_confusion_csv(path, labels, columns, matrix):
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f, lineterminator="\n")
        writer.writerow(["true_class"] + columns)
        for true in labels:
            writer.writerow([true] + [matrix[true][c] for c in columns])


def write_confusion_png(path, labels, columns, matrix):
    """Render the matrix as a figure. Returns None, or why it could not be done."""
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except ImportError as exc:
        return f"matplotlib is not installed ({exc})"

    data = [[matrix[t][c] for c in columns] for t in labels]
    fig, ax = plt.subplots(figsize=(1.1 * len(columns) + 2.5, 0.8 * len(labels) + 2.5))
    image = ax.imshow(data, cmap="Blues")

    ax.set_xticks(range(len(columns)))
    ax.set_xticklabels(columns, rotation=45, ha="right", fontsize=8)
    ax.set_yticks(range(len(labels)))
    ax.set_yticklabels(labels, fontsize=8)
    ax.set_xlabel("predicted")
    ax.set_ylabel("true")
    ax.set_title("Condition classifier, synthetic held-out test set")

    highest = max((v for row in data for v in row), default=0)
    for i, row in enumerate(data):
        for j, value in enumerate(row):
            ax.text(
                j, i, str(value), ha="center", va="center", fontsize=8,
                color="white" if value > highest / 2 else "black",
            )
    fig.colorbar(image, ax=ax, shrink=0.8, label="rows")
    fig.tight_layout()
    fig.savefig(path, dpi=150)
    plt.close(fig)
    return None


def report(scores, macro, confusion_parts, multi, metadata, png_problem, n_rows, threshold):
    labels, columns, matrix = confusion_parts
    lines = [
        "# Condition classifier evaluation",
        "",
        "## What these numbers do and do not mean",
        "",
        "**The test set is synthetic.** Both the training and the test split were written by",
        "hand in `ml/make_dataset.py`, from template and phrase pools that share no wording",
        "and no identical strings (`tests/test_dataset.py` asserts both). A score here",
        "measures whether the model generalizes from one set of invented phrasings to a",
        "different set of invented phrasings.",
        "",
        "**It therefore overstates real-world performance.** Nothing in this repository was",
        "written by a real user describing a real health problem. Expect worse accuracy on",
        "wording nobody here thought of, and treat the figures as a regression check on the",
        "model, not as evidence that it is fit to classify a patient's words.",
        "",
        "## Setup",
        "",
        f"- rows scored: {n_rows} (`ml/data/test.jsonl`)",
        f"- decision threshold: {threshold} (tuned on a validation split of the training data)",
        f"- training rows: {metadata.get('training_rows', 'unknown')}",
        f"- vocabulary: {metadata.get('vocabulary_size', 'unknown')} terms",
        "- model: TF-IDF (word 1-2 grams, sublinear tf, l2) + one-vs-rest logistic regression",
        "  with balanced class weights",
        "- scored through `hdi.classify`, the pure-Python inference path the API uses",
        "",
        "`out_of_scope` has no coefficient vector of its own. It is scored on the event \"no",
        "condition reached the threshold\", which is exactly the decision the API makes.",
        "",
        "## Per-class scores",
        "",
        "| class | precision | recall | F1 | support |",
        "|---|---|---|---|---|",
    ]
    for name, score in scores.items():
        lines.append(
            f"| `{name}` | {score['precision']:.3f} | {score['recall']:.3f} | "
            f"{score['f1']:.3f} | {score['support']} |"
        )
    lines += [
        "",
        f"**Macro-F1: {macro:.4f}** (unweighted mean of the {len(scores)} F1 scores above)",
        "",
        f"Target was {TARGET_MACRO_F1:.2f} on the held-out set: "
        f"{'met' if macro >= TARGET_MACRO_F1 else 'NOT met'}.",
        "",
        "## Confusion matrix",
        "",
        "Single-label rows only. A row with two true conditions has no single cell to land",
        "in, so those are counted separately below. `multiple_conditions` is where a",
        "single-label row goes when the classifier asserted more than one condition.",
        "",
        "| true \\ predicted | " + " | ".join(f"`{c}`" for c in columns) + " |",
        "|---" * (len(columns) + 1) + "|",
    ]
    for true in labels:
        cells = " | ".join(str(matrix[true][c]) for c in columns)
        lines.append(f"| `{true}` | {cells} |")

    lines += [
        "",
        "Also written as data in `confusion_matrix.csv`"
        + (
            ", and as a figure in `confusion_matrix.png`."
            if png_problem is None
            else f". The figure was not produced: {png_problem}."
        ),
        "",
        "## Multi-condition rows",
        "",
        "Rows where the user described two conditions at once.",
        "",
        "| outcome | rows |",
        "|---|---|",
        f"| both conditions found | {multi['exact_set']} |",
        f"| one of the two found | {multi['partial']} |",
        f"| neither found | {multi['none_correct']} |",
        f"| total | {multi['total']} |",
        "",
        "## Reproducing this",
        "",
        "```",
        "python -m pip install -r requirements-ml.txt",
        "python ml/make_dataset.py",
        "python ml/train.py",
        "python ml/evaluate.py",
        "```",
        "",
        "`ml/make_dataset.py` and `ml/train.py` both use fixed seeds, so the whole chain is",
        "reproducible from a clean checkout.",
        "",
    ]
    return "\n".join(lines)


def evaluate(artifact_path=None):
    classifier = load_classifier(artifact_path)
    rows = load_jsonl(DATA_DIR / "test.jsonl")
    classes = classifier.classes

    probabilities = [
        [classifier.scores(row["text"])[c] for c in classes] for row in rows
    ]
    pred_sets = predicted_sets(probabilities, classes, classifier.threshold)
    true_sets = [set(row["labels"]) for row in rows]

    scores = per_class_scores(true_sets, pred_sets, classes)
    macro = sum(s["f1"] for s in scores.values()) / len(scores)

    confusion_parts = confusion(rows, pred_sets, classes)
    multi = multi_condition_scores(rows, pred_sets)

    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    write_confusion_csv(REPORT_DIR / "confusion_matrix.csv", *confusion_parts)
    png_problem = write_confusion_png(REPORT_DIR / "confusion_matrix.png", *confusion_parts)

    (REPORT_DIR / "eval.md").write_text(
        report(
            scores, macro, confusion_parts, multi, classifier.metadata,
            png_problem, len(rows), classifier.threshold,
        ),
        encoding="utf-8",
    )

    for name, score in scores.items():
        print(f"{name:40s} P {score['precision']:.3f}  R {score['recall']:.3f}  "
              f"F1 {score['f1']:.3f}  n {score['support']}")
    print(f"\nmacro-F1: {macro:.4f}  (target {TARGET_MACRO_F1})")
    print(f"multi-condition rows: {multi}")
    if png_problem:
        print(f"confusion_matrix.png not written: {png_problem}", file=sys.stderr)
    print(f"wrote {(REPORT_DIR / 'eval.md').relative_to(ROOT)}")
    return macro


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--artifact", default=None)
    args = parser.parse_args()
    macro = evaluate(args.artifact)
    return 0 if macro >= TARGET_MACRO_F1 else 2


if __name__ == "__main__":
    sys.exit(main())
