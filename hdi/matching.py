"""Herb/drug mention matching, with a stem fallback for spelling variants.

PubMed's esearch already guarantees that every collected record's title or
abstract contains one of the herb's literal search terms (that's how the
query was built), so an exact case-insensitive substring match succeeds for
the overwhelming majority of records. The stem fallback exists for the
residual cases where the abstract uses a spelling variant that isn't
verbatim in herbs.csv's synonym list -- the same class of issue as a herb
being listed as both "Guggul" and "Guggulu": two spellings that share a long
prefix but differ in their final vowel/suffix. Truncating both the
reference term and the candidate word to a common-prefix stem before
comparing catches that without needing real linguistic stemming.
"""

import re

WORD_RE = re.compile(r"[A-Za-z]+")


def word_stem(word, min_len=5):
    w = word.lower()
    if len(w) <= min_len:
        return w
    return w[: max(min_len, len(w) - 2)]


def find_herb_mention(search_terms, text):
    """Return (matched_term, match_kind) or (None, None).

    match_kind is "exact" for a literal substring hit, or "stem:<word>" when
    only the prefix-stem fallback matched -- callers use that to report how
    often the fallback was actually needed.
    """
    text_lower = text.lower()

    for term in search_terms:
        if term.lower() in text_lower:
            return term, "exact"

    text_words = set(WORD_RE.findall(text_lower))
    for term in search_terms:
        if " " in term:
            continue  # multi-word botanical names don't stem meaningfully
        stem = word_stem(term)
        for w in text_words:
            if len(w) >= 4 and word_stem(w) == stem:
                return term, f"stem:{w}"

    return None, None


def find_drug_mention(drug_name, text):
    """Same matching strategy as find_herb_mention, for a single drug name."""
    return find_herb_mention([drug_name], text)
