"""Trigger lexicon and negation cues used by hdi.extract.

Trigger phrases are matched as case-insensitive substrings within a single
sentence. Grouping them lets the extraction report break candidate counts
down by the kind of interaction language that fired, without needing that
grouping to be a persisted output field.
"""

TRIGGER_LEXICON = {
    "potentiation": [
        "potentiates",
        "potentiate",
        "potentiation",
        "synergistic",
        "synergism",
        "synergy",
        "additive effect",
        "enhances the effect",
        "enhanced the effect",
        "augments the effect",
    ],
    "risk_increase": [
        "increases the risk",
        "increased the risk",
        "increases risk of",
        "increased risk of",
        "elevated risk",
        "higher risk of",
    ],
    "contraindication": [
        "contraindicated",
        "should not be used with",
        "should be avoided",
        "should not be co-administered",
        "avoid concomitant use",
        "concomitant use is not recommended",
    ],
    "antagonism": [
        "antagonizes",
        "antagonistic",
        "antagonism",
        "reduces the efficacy",
        "reduced efficacy",
        "reduced the efficacy",
        "decreases the efficacy",
        "decreased efficacy",
        "inhibits the effect",
        "diminished effect",
    ],
    "pharmacokinetic": [
        "cyp3a4",
        "cyp2c9",
        "cyp2d6",
        "cytochrome p450",
        "altered pharmacokinetics",
        "affects the metabolism",
        "induces metabolism",
        "inhibits metabolism",
        "bioavailability was",
        "plasma concentration",
    ],
    "general_interaction": [
        "interacts with",
        "drug interaction",
        "herb-drug interaction",
        "clinically significant interaction",
        "may interact",
        "potential interaction",
    ],
}

# Lowercased lemmas/dep labels treated as negation cues by hdi.extract.is_negated.
# token.dep_ == "neg" covers particles like "not"/"n't" attached to a verb;
# the lemma set covers cues spaCy tags with other dep labels (e.g. "no" as a
# determiner on "interaction", "without" as a preposition).
NEGATION_CUES = {
    "no",
    "not",
    "n't",
    "without",
    "never",
    "neither",
    "nor",
    "fail",
    "failed",
    "failure",
    "absence",
    "absent",
    "lack",
    "lacked",
    "unable",
}
