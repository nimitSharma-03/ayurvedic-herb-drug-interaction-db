"""Generate candidate herb-drug interaction rows from collected PubMed abstracts.

Pipeline per record in data/raw/raw_abstracts.json:
  1. Confirm the herb and drug are both actually mentioned in the title+abstract
     text (via hdi.matching, which falls back to stem matching for spelling
     variants) -- records that fail this are skipped and reported, not silently
     dropped.
  2. Run scispaCy NER (en_ner_bc5cdr_md) over the text to recognize CHEMICAL and
     DISEASE/effect entities.
  3. Scan each sentence for a trigger-lexicon phrase (hdi.lexicon). A hit only
     becomes a candidate row if the herb name and drug name are also literally
     present within SENTENCE_WINDOW sentences of the trigger -- this keeps
     evidence_sentence tied to a sentence that actually names both sides of
     the pair, rather than any trigger phrase found anywhere in the abstract.
  4. Flag (never drop) sentences where that trigger is syntactically negated,
     using the sentence's dependency parse.

Candidate rows are auto-extracted evidence, not curated interactions: per
docs/PROJECT_SCOPE.md, confidence is always "auto_extracted" and every row carries the
source PMID.
"""

import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path

import spacy

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from scripts.collect_abstracts import HERBS_CSV, load_herbs  # noqa: E402

from hdi.lexicon import NEGATION_CUES, TRIGGER_LEXICON
from hdi.matching import find_drug_mention, find_herb_mention

ROOT = Path(__file__).resolve().parent.parent
INPUT_PATH = ROOT / "data" / "raw" / "raw_abstracts.json"
OUTPUT_PATH = ROOT / "data" / "processed" / "candidates.json"
NER_MODEL = "en_ner_bc5cdr_md"

# How many sentences on either side of the trigger sentence to include when
# checking that the herb and drug are actually named near the trigger, not
# just somewhere in the same abstract. 0 (same sentence only) proved too
# strict on real data -- interactions are routinely stated as "Herb and Drug
# were co-administered. <trigger sentence>" across two sentences -- so this
# is widened to a tight +/-1 sentence window instead.
SENTENCE_WINDOW = 1

REVERSE_LEXICON = {
    phrase: group for group, phrases in TRIGGER_LEXICON.items() for phrase in phrases
}


def load_herb_terms(path=HERBS_CSV):
    return {h["herb_name"]: h["search_terms"] for h in load_herbs(path)}


INLINE_TAG_RE = re.compile(r"</?[a-zA-Z][^>]*>")


def strip_inline_tags(text):
    """Remove PubMed's inline formatting tags (e.g. <i>...</i> around species
    names, <sub>/<sup> in chemical formulas) that Biopython's XML parsing
    leaves as literal text. Left in place, they can split a botanical name
    like "Trigonella foenum-graecum" into "Trigonella foenum</i>-<i>graecum",
    which breaks a literal substring match even though the name is clearly
    present to a human reader.
    """
    return INLINE_TAG_RE.sub("", text)


def is_negated(sent, trigger_span):
    """Dependency-based negation check, scoped to the sentence containing the trigger.

    Walks up from the trigger phrase's syntactic root to see whether a
    negation cue (spaCy's "neg" dep label, or a cue lemma like "no"/"without")
    attaches to the same clause -- either as an ancestor of the trigger, with
    the trigger in its own subtree, or sharing the trigger's head directly.
    """
    trigger_root = trigger_span.root
    ancestor_set = set(trigger_root.ancestors)
    ancestor_set.add(trigger_root)

    for tok in sent:
        is_cue = tok.dep_ == "neg" or tok.lemma_.lower() in NEGATION_CUES
        if not is_cue:
            continue
        if tok in ancestor_set:
            return True
        if trigger_root in tok.ancestors:
            return True
        if tok.head in ancestor_set:
            return True
    return False


def check_mention(record, herb_terms_by_name):
    """Cross-reference the record's herb/drug against the reference tables.

    Returns (text, status). text is "" when the record has neither title nor
    abstract; status always reports whether each side was actually found in
    that text, regardless.
    """
    herb_name = record["herb_name"]
    drug_name = record["drug_name"]
    text = strip_inline_tags(f'{record.get("title", "")} {record.get("abstract", "")}').strip()

    status = {"herb_mention": False, "herb_match_kind": None, "herb_match_term": None, "drug_mention": False}
    if not text:
        return text, status

    herb_terms = herb_terms_by_name.get(herb_name, [herb_name])
    herb_term, herb_kind = find_herb_mention(herb_terms, text)
    drug_term, _drug_kind = find_drug_mention(drug_name, text)

    status["herb_mention"] = herb_term is not None
    status["herb_match_kind"] = herb_kind
    status["herb_match_term"] = herb_term
    status["drug_mention"] = drug_term is not None
    return text, status


def sentence_window_text(sents, idx, window):
    """Join the sentence at idx with `window` sentences on either side into
    one string, for a same-sentence-or-tight-window mention check."""
    lo = max(0, idx - window)
    hi = min(len(sents), idx + window + 1)
    return " ".join(s.text.strip() for s in sents[lo:hi])


def extract_rows_from_doc(doc, record, herb_terms, window=SENTENCE_WINDOW):
    """Emit one candidate row per trigger hit, but only when the herb name
    AND the drug name are also literally present within `window` sentences
    of the trigger (window=0 means the same sentence only). This is what
    keeps evidence_sentence tied to the actual claim instead of matching a
    trigger phrase and a herb/drug mention that live in unrelated sentences
    of the same abstract.
    """
    rows = []
    sents = list(doc.sents)
    for i, sent in enumerate(sents):
        sent_lower = sent.text.lower()
        for phrase, group in REVERSE_LEXICON.items():
            idx = sent_lower.find(phrase)
            if idx == -1:
                continue

            window_text = sentence_window_text(sents, i, window)
            herb_term, _herb_kind = find_herb_mention(herb_terms, window_text)
            drug_term, _drug_kind = find_drug_mention(record["drug_name"], window_text)
            if herb_term is None or drug_term is None:
                continue

            start_char = sent.start_char + idx
            end_char = start_char + len(phrase)
            trigger_span = doc.char_span(start_char, end_char, alignment_mode="expand")
            negated = is_negated(sent, trigger_span) if trigger_span is not None else False
            rows.append(
                {
                    "herb": record["herb_name"],
                    "drug": record["drug_name"],
                    "source_pmid": record["pmid"],
                    "trigger_matched": phrase,
                    "trigger_group": group,
                    "negated": negated,
                    "confidence": "auto_extracted",
                    "evidence_sentence": window_text if window else sent.text.strip(),
                }
            )
    return rows


def scan_record(nlp, record, herb_terms_by_name):
    """Single-record convenience wrapper (used by the smoke test); the real
    run uses run_extraction's batched nlp.pipe path instead for throughput."""
    text, status = check_mention(record, herb_terms_by_name)
    if not (status["herb_mention"] and status["drug_mention"]):
        return [], status
    herb_terms = herb_terms_by_name.get(record["herb_name"], [record["herb_name"]])
    return extract_rows_from_doc(nlp(text), record, herb_terms), status


def run_extraction(records, nlp, herb_terms_by_name):
    all_rows = []
    mention_issues = []
    stem_fallback_hits = []

    to_process = []  # (record, text) pairs that passed mention verification
    for record in records:
        text, status = check_mention(record, herb_terms_by_name)

        if not (status["herb_mention"] and status["drug_mention"]):
            mention_issues.append(
                {
                    "herb": record["herb_name"],
                    "drug": record["drug_name"],
                    "pmid": record["pmid"],
                    "herb_mention": status["herb_mention"],
                    "drug_mention": status["drug_mention"],
                }
            )
            continue

        if status["herb_match_kind"] and status["herb_match_kind"].startswith("stem:"):
            stem_fallback_hits.append(
                {
                    "herb": record["herb_name"],
                    "matched_term": status["herb_match_term"],
                    "matched_word": status["herb_match_kind"].split(":", 1)[1],
                    "pmid": record["pmid"],
                }
            )

        to_process.append((record, text))

    texts = (text for _record, text in to_process)
    docs = nlp.pipe(texts)
    for (record, _text), doc in zip(to_process, docs):
        herb_terms = herb_terms_by_name.get(record["herb_name"], [record["herb_name"]])
        all_rows.extend(extract_rows_from_doc(doc, record, herb_terms))

    return all_rows, mention_issues, stem_fallback_hits


def print_report(records, rows, mention_issues, stem_fallback_hits):
    print(f"Records scanned: {len(records)}")
    print(f"Candidate rows generated: {len(rows)}")

    group_counts = Counter(row["trigger_group"] for row in rows)
    print("\nBreakdown by trigger group:")
    for group in TRIGGER_LEXICON:
        print(f"  {group}: {group_counts.get(group, 0)}")

    negated_count = sum(1 for row in rows if row["negated"])
    print(f"\nRows flagged as negated: {negated_count} / {len(rows)}")

    print(f"\nHerb/drug mention verification failures: {len(mention_issues)}")
    for issue in mention_issues:
        reason = []
        if not issue["herb_mention"]:
            reason.append("herb not found")
        if not issue["drug_mention"]:
            reason.append("drug not found")
        print(f"  - {issue['herb']} + {issue['drug']} (PMID {issue['pmid']}): {', '.join(reason)}")

    print(f"\nHerb mentions resolved only via stem-match fallback: {len(stem_fallback_hits)}")
    for hit in stem_fallback_hits:
        print(
            f"  - {hit['herb']}: reference term '{hit['matched_term']}' matched "
            f"text word '{hit['matched_word']}' (PMID {hit['pmid']})"
        )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", default=str(INPUT_PATH))
    parser.add_argument("--output", default=str(OUTPUT_PATH))
    parser.add_argument(
        "--limit", type=int, default=None, help="Process only the first N records (for smoke testing)."
    )
    parser.add_argument(
        "--dry-run", action="store_true", help="Print the report but do not write the output file."
    )
    args = parser.parse_args()

    with open(args.input, encoding="utf-8") as f:
        records = json.load(f)
    if args.limit:
        records = records[: args.limit]

    print(f"Loading {NER_MODEL} ...")
    nlp = spacy.load(NER_MODEL)

    herb_terms_by_name = load_herb_terms()

    rows, mention_issues, stem_fallback_hits = run_extraction(records, nlp, herb_terms_by_name)

    print_report(records, rows, mention_issues, stem_fallback_hits)

    if not args.dry_run:
        out_path = Path(args.output)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(rows, f, indent=2, ensure_ascii=False)
        print(f"\nSaved {len(rows)} candidate rows to {out_path}")


if __name__ == "__main__":
    main()
