"""Red-flag screening and caution flags.

Red-flag screening runs **before** anything else in the recommendation
pipeline: before validation of the optional fields, before the classifier, and
before any database lookup. A match short-circuits to an emergency response
that lists no herbs, no drugs and no interactions at all. Someone describing a
heart attack should not be reading about Arjuna, and the surest way to guarantee
that is to never reach the code that would offer it.

The patterns live in data/reference/red_flags.json, not here, so adding a
wording is a data change. They are written to err towards triggering: a false
alarm costs a wasted referral, a miss costs a delayed emergency. Bare words that
usually describe a past event ("stroke", "heart attack") are deliberately absent
so someone giving their history is classified rather than sent to an emergency
room -- data/reference/red_flags.json records that reasoning next to the
patterns.

Caution flags are the opposite: they never change the status and never remove an
option. They add notes. Deciding that a herb is unsuitable in pregnancy is a
clinical judgement this project has no sourced basis for, so it reports the
caution and leaves the decision where it belongs.
"""

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RED_FLAGS_JSON = ROOT / "data" / "reference" / "red_flags.json"

STATUS_EMERGENCY = "emergency"

# Caution flags a request may set. Each only ever adds a note.
CAUTION_FLAGS = {
    "pregnant_or_breastfeeding": (
        "You have said you are pregnant or breastfeeding. Many herbs and several of "
        "these medicines are not suitable then, and this database holds no "
        "pregnancy-specific safety data. Check every item with a doctor or pharmacist "
        "before taking it."
    ),
    "under_18": (
        "You have said this is for someone under 18. Almost none of the evidence behind "
        "these entries comes from children, and doses and risks differ. A doctor should "
        "decide anything given to a child."
    ),
    "kidney_or_liver_disease": (
        "You have said there is kidney or liver disease. Both organs clear medicines and "
        "herbs from the body, so reduced function can turn an ordinary amount into too "
        "much. Every item here needs a doctor's review in that situation."
    ),
}

_cache = {}


class RedFlagsUnavailable(RuntimeError):
    """The red-flag file is missing or unreadable.

    Raised rather than screening nothing: a pipeline that silently skipped
    emergency screening would be more dangerous than one that refuses to run.
    """


class RedFlagScreen:
    """Compiled red-flag patterns, grouped by category."""

    def __init__(self, document):
        self.version = document.get("version")
        self.emergency_number = document["emergency_number"]
        self.additional_help = document.get("additional_help", {})
        self._categories = []
        for category in document["categories"]:
            self._categories.append(
                {
                    "id": category["id"],
                    "label": category["label"],
                    "message": category["message"],
                    "patterns": [
                        re.compile(p, re.IGNORECASE) for p in category["patterns"]
                    ],
                }
            )

    @property
    def category_ids(self):
        return [c["id"] for c in self._categories]

    def check(self, text):
        """Every red-flag category the text matches, in file order.

        All matches are returned, not just the first: someone reporting both
        black stools and fainting is telling us two things, and the response
        names both.
        """
        if not text:
            return []
        matches = []
        for category in self._categories:
            matched = next(
                (p.pattern for p in category["patterns"] if p.search(text)), None
            )
            if matched is not None:
                matches.append(
                    {
                        "category": category["id"],
                        "label": category["label"],
                        "message": category["message"],
                        "matched_pattern": matched,
                    }
                )
        return matches

    def emergency_actions(self, matches):
        """What to tell someone to do, given the categories that fired."""
        number = self.emergency_number
        actions = [
            f"Call {number['number']} now ({number['label']}), or get to the nearest "
            f"emergency department."
        ]
        for match in matches:
            extra = self.additional_help.get(match["category"])
            if extra:
                actions.append(
                    f"You can also call {extra['number']} ({extra['label']}) to talk to "
                    f"someone right away."
                )
        actions.append(
            "Do not wait to look up herbs or medicines, and do not change any prescribed "
            "medicine on your own."
        )
        seen, unique = set(), []
        for action in actions:
            if action not in seen:
                seen.add(action)
                unique.append(action)
        return unique


def load_red_flags(path=None):
    """Load and cache the compiled screen, keyed by path and modification time."""
    path = Path(path or RED_FLAGS_JSON)
    try:
        stamp = path.stat().st_mtime_ns
    except OSError as exc:
        raise RedFlagsUnavailable(f"{path} is not readable") from exc

    key = (str(path.resolve()), stamp)
    if key not in _cache:
        try:
            document = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise RedFlagsUnavailable(f"{path} could not be parsed: {exc}") from exc
        try:
            screen = RedFlagScreen(document)
        except (KeyError, re.error) as exc:
            raise RedFlagsUnavailable(f"{path} is malformed: {exc}") from exc
        _cache.clear()
        _cache[key] = screen
    return _cache[key]


def check_red_flags(text, path=None):
    return load_red_flags(path).check(text)


def caution_notes(cautions):
    """Notes for the caution flags a request set.

    Unknown keys are ignored rather than rejected: a client sending a flag this
    version does not know about should still get its answer, with the flags that
    are understood honoured.
    """
    if not isinstance(cautions, dict):
        return []
    return [
        CAUTION_FLAGS[flag]
        for flag in CAUTION_FLAGS
        if flag in cautions and bool(cautions.get(flag))
    ]


def unknown_caution_flags(cautions):
    """Flags the caller sent that this version does not act on, so it can be told."""
    if not isinstance(cautions, dict):
        return []
    return sorted(k for k in cautions if k not in CAUTION_FLAGS)
