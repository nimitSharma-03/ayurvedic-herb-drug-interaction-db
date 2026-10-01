# Condition classifier evaluation

## What these numbers do and do not mean

**The test set is synthetic.** Both the training and the test split were written by
hand in `ml/make_dataset.py`, from template and phrase pools that share no wording
and no identical strings (`tests/test_dataset.py` asserts both). A score here
measures whether the model generalizes from one set of invented phrasings to a
different set of invented phrasings.

**It therefore overstates real-world performance.** Nothing in this repository was
written by a real user describing a real health problem. Expect worse accuracy on
wording nobody here thought of, and treat the figures as a regression check on the
model, not as evidence that it is fit to classify a patient's words.

## Setup

- rows scored: 384 (`ml/data/test.jsonl`)
- decision threshold: 0.29 (tuned on a validation split of the training data)
- training rows: 1609
- vocabulary: 3080 terms
- model: TF-IDF (word 1-2 grams, sublinear tf, l2) + one-vs-rest logistic regression
  with balanced class weights
- scored through `hdi.classify`, the pure-Python inference path the API uses

`out_of_scope` has no coefficient vector of its own. It is scored on the event "no
condition reached the threshold", which is exactly the decision the API makes.

## Per-class scores

| class | precision | recall | F1 | support |
|---|---|---|---|---|
| `atrial_fibrillation` | 0.909 | 0.833 | 0.870 | 60 |
| `heart_failure` | 0.779 | 0.957 | 0.859 | 70 |
| `hypertension` | 0.871 | 0.938 | 0.904 | 65 |
| `secondary_cardiovascular_prevention` | 0.726 | 0.984 | 0.836 | 62 |
| `type_2_diabetes` | 0.886 | 0.984 | 0.932 | 63 |
| `venous_thromboembolism` | 0.865 | 1.000 | 0.928 | 64 |
| `out_of_scope` | 0.897 | 0.729 | 0.805 | 48 |

**Macro-F1: 0.8760** (unweighted mean of the 7 F1 scores above)

Target was 0.85 on the held-out set: met.

## Confusion matrix

Single-label rows only. A row with two true conditions has no single cell to land
in, so those are counted separately below. `multiple_conditions` is where a
single-label row goes when the classifier asserted more than one condition.

| true \ predicted | `atrial_fibrillation` | `heart_failure` | `hypertension` | `secondary_cardiovascular_prevention` | `type_2_diabetes` | `venous_thromboembolism` | `out_of_scope` | `multiple_conditions` |
|---|---|---|---|---|---|---|---|---|
| `atrial_fibrillation` | 33 | 1 | 0 | 1 | 0 | 0 | 2 | 11 |
| `heart_failure` | 1 | 41 | 0 | 0 | 0 | 0 | 0 | 6 |
| `hypertension` | 0 | 0 | 40 | 0 | 0 | 0 | 2 | 6 |
| `secondary_cardiovascular_prevention` | 0 | 0 | 0 | 42 | 0 | 0 | 0 | 6 |
| `type_2_diabetes` | 0 | 0 | 0 | 0 | 39 | 0 | 0 | 9 |
| `venous_thromboembolism` | 0 | 0 | 0 | 0 | 0 | 40 | 0 | 8 |
| `out_of_scope` | 1 | 3 | 0 | 4 | 0 | 3 | 35 | 2 |

Also written as data in `confusion_matrix.csv`, and as a figure in `confusion_matrix.png`.

## Multi-condition rows

Rows where the user described two conditions at once.

| outcome | rows |
|---|---|
| both conditions found | 35 |
| one of the two found | 13 |
| neither found | 0 |
| total | 48 |

## Reproducing this

```
python -m pip install -r requirements-ml.txt
python ml/make_dataset.py
python ml/train.py
python ml/evaluate.py
```

`ml/make_dataset.py` and `ml/train.py` both use fixed seeds, so the whole chain is
reproducible from a clean checkout.
