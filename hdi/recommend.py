"""The recommendation service: free text in, options and combination warnings out.

    validate -> red-flag screen -> classify -> look up options -> check combinations

This module holds the whole service. hdi/api.py only validates the request shape
and calls `recommend`; no medical logic lives in the route, which is the layering
docs/BACKEND_API.md already describes for the other endpoints.

What this is not
----------------
It is not a prescription and it does not rank. The options for a condition come
back in evidence order and then alphabetically, because this project has no basis
for saying one herb is better than another and must not look as though it does.
No dose, no brand name and no form of the words "safe to take" appears anywhere
in a response. A pair with no record reads "No documented interaction in this
database. This does not mean the combination is safe."

Where each warning comes from
-----------------------------
  literature_verified         the curated interaction table marks the pair
                              documented. Only these carry a PMID and an
                              evidence sentence.
  mechanism_based             a tag-pair rule in combination_rules.csv fired.
                              Plausible pharmacology, nobody's published finding.
  no_documented_interaction   the pair is in the harvested corpus and nothing was
                              found. Not a safety claim.
  insufficient_evidence       the pair was never harvested, and no rule applies.

The first is the only label allowed to say "literature-verified"
(docs/PROJECT_SCOPE.md). Everything derived from tags says it is not.

No model file other than the exported classifier, no network call and no LLM is
on this path. tests/test_recommend.py asserts that by reading this module's
source.
"""

from hdi import catalog, classify, db, knowledge, safety
from hdi.interactions import check_pair

MAX_TEXT_LENGTH = 500
MAX_CURRENT_MEDICINES = 20
MAX_CONDITION_IDS = 10

STATUS_EMERGENCY = "emergency"
STATUS_RESULTS = "results"
STATUS_OUT_OF_SCOPE = "out_of_scope"
STATUS_LOW_CONFIDENCE = "low_confidence"

LEVEL_LITERATURE_VERIFIED = "literature_verified"
LEVEL_MECHANISM_BASED = "mechanism_based"
LEVEL_NO_DOCUMENTED = "no_documented_interaction"
LEVEL_INSUFFICIENT = "insufficient_evidence"

# The label attached to every warning, so a consumer rendering `level` as a
# badge cannot accidentally present a tag match as a published finding.
LEVEL_LABELS = {
    LEVEL_LITERATURE_VERIFIED: "Literature-verified",
    LEVEL_MECHANISM_BASED: "Mechanism-based caution (not literature-verified)",
    LEVEL_NO_DOCUMENTED: "No documented interaction in this database",
    LEVEL_INSUFFICIENT: "Insufficient evidence",
}

NO_RECORD_SENTENCE = (
    "No documented interaction in this database. This does not mean the combination is safe."
)

INSUFFICIENT_SENTENCE = (
    "No evidence has been collected for this pair and no mechanism rule applies, so there "
    "is no basis to say whether they interact."
)

DISCLAIMER = (
    "This is information, not medical advice. It is generated from a research database "
    "that has not been reviewed by a clinician, and it is not a prescription or a "
    "diagnosis. Talk to a doctor or pharmacist before taking anything here, and do not "
    "start or stop a prescribed medicine on the basis of this response."
)

OUT_OF_SCOPE_NOTE = (
    "This database only covers the conditions its 40 Ayurvedic herbs and 13 conventional "
    "drugs are recorded for. What you described is outside that, so no options are listed "
    "rather than a guess being offered."
)

LOW_CONFIDENCE_NOTE = (
    "What you wrote could not be matched to a supported condition confidently enough to "
    "answer. The supported conditions are listed below; choosing one and sending it as "
    "condition_ids will skip this step."
)

CLASSIFIER_NOTE = (
    "Conditions were detected by a classifier trained on synthetic phrasings, so it can "
    "misread wording nobody anticipated. Check the detected conditions before relying on "
    "the options."
)

# Warning ordering. A conflict with something the user already takes comes first
# whatever its level: that is the one they can act on today.
_LEVEL_RANK = {
    LEVEL_LITERATURE_VERIFIED: 0,
    LEVEL_MECHANISM_BASED: 1,
    LEVEL_NO_DOCUMENTED: 2,
    LEVEL_INSUFFICIENT: 3,
}
_RULE_LEVEL_RANK = {"high": 0, "moderate": 1, "low": 2, None: 3}


class RequestError(Exception):
    """A rejected request, carrying the machine-readable code the route returns."""

    def __init__(self, code, message, **extra):
        super().__init__(message)
        self.code = code
        self.message = message
        self.extra = extra


# ---------------------------------------------------------------------------
# request validation
# ---------------------------------------------------------------------------

def _validate_text(value, required):
    if value is None:
        if required:
            raise RequestError("missing_parameter", "Field 'text' is required.")
        return ""
    if not isinstance(value, str):
        raise RequestError("invalid_parameter", "Field 'text' must be a string.")
    if len(value) > MAX_TEXT_LENGTH:
        raise RequestError(
            "invalid_parameter",
            f"Field 'text' must be at most {MAX_TEXT_LENGTH} characters, got {len(value)}.",
        )
    return value


def _validate_list(value, field, maximum):
    if value is None:
        return []
    if not isinstance(value, list):
        raise RequestError("invalid_parameter", f"Field '{field}' must be a list.")
    if len(value) > maximum:
        raise RequestError(
            "invalid_parameter",
            f"Field '{field}' must hold at most {maximum} entries, got {len(value)}.",
        )
    cleaned = []
    for entry in value:
        if not isinstance(entry, str):
            raise RequestError(
                "invalid_parameter", f"Every entry in '{field}' must be a string."
            )
        entry = entry.strip()
        if entry:
            cleaned.append(entry)
    return cleaned


def _validate_cautions(value):
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise RequestError("invalid_parameter", "Field 'cautions' must be an object.")
    for key, flag in value.items():
        if not isinstance(flag, bool):
            raise RequestError(
                "invalid_parameter", f"Caution flag '{key}' must be true or false."
            )
    return value


# ---------------------------------------------------------------------------
# current medicines
# ---------------------------------------------------------------------------

def _resolve_current(conn, entries):
    """Resolve what the user says they already take.

    Three outcomes per entry, all reported back so the response says plainly what
    it understood:

      a medicine       resolved by id, name, synonym, generic name or brand name
      a drug class     they named a class, not a product ("blood thinner")
      unresolved       nothing in the frozen scope matched; no guess is made

    A class carries the tags shared by every drug in it, so a caution raised
    against "blood thinner" holds whichever one they actually take.
    """
    medicines, classes, unresolved, ambiguous = [], [], [], []
    for entry in entries:
        medicine_id, error = catalog.resolve_medicine(conn, entry)
        if medicine_id is not None:
            summary = catalog.medicine_summary(conn, medicine_id)
            medicines.append(
                {
                    "query": entry,
                    "medicine_id": medicine_id,
                    "name": summary["name"],
                    "medicine_type": summary["medicine_type"],
                    "category": summary["category"],
                    "drug_class": summary["drug_class"],
                    "resolved_as": "medicine",
                }
            )
            continue
        if isinstance(error, tuple) and error[0] == "ambiguous":
            ambiguous.append({"query": entry, "candidates": error[1]})
            continue

        drug_class = catalog.resolve_drug_class(conn, entry)
        if drug_class:
            classes.append(
                {
                    "query": entry,
                    "drug_class": drug_class,
                    "resolved_as": "drug_class",
                    "members": [
                        catalog.medicine_summary(conn, mid)["name"]
                        for mid in catalog.medicines_in_class(conn, drug_class)
                    ],
                }
            )
            continue
        unresolved.append(entry)
    return medicines, classes, unresolved, ambiguous


# ---------------------------------------------------------------------------
# combination checking
# ---------------------------------------------------------------------------

def _pair_kind_key(type_a, type_b):
    if type_a == "herb" and type_b == "herb":
        return "herb+herb"
    if type_a == "drug" and type_b == "drug":
        return "drug+drug"
    return "herb+drug"


def _matching_rules(rules, tags_a, tags_b, pair_kind):
    """Rules that fire for a tag pair, in either direction.

    A rule written (hypoglycemic, bradycardic) must fire whether the herb or the
    drug is the hypoglycemic one, so both assignments are tried. A rule whose two
    tags are the same fires only when both sides carry it.
    """
    fired = []
    for rule in rules:
        if rule["applies_to"] != pair_kind:
            continue
        a, b = rule["tag_a"], rule["tag_b"]
        if (a in tags_a and b in tags_b) or (b in tags_a and a in tags_b):
            fired.append(rule)
    return fired


def _literature_warning(record, name_a, name_b, against_current):
    """A warning from a documented pair in the curated interaction table."""
    # Deduplicated by PMID and sentence: hdi.extract legitimately emits the same
    # trigger phrase twice from one abstract, so the curated set holds repeated
    # rows for a pair. Printing a citation twice would read as two sources.
    citations, seen = [], set()
    for evidence in record.get("evidence", []):
        if evidence["confidence"] != "human_verified":
            continue
        key = (evidence["pmid"], evidence["evidence_sentence"])
        if key in seen:
            continue
        seen.add(key)
        citations.append(
            {
                "pmid": evidence["pmid"],
                "evidence_sentence": evidence["evidence_sentence"],
                "source_url": evidence["source_url"],
            }
        )
    return {
        "level": LEVEL_LITERATURE_VERIFIED,
        "label": LEVEL_LABELS[LEVEL_LITERATURE_VERIFIED],
        "medicine_a": name_a,
        "medicine_b": name_b,
        "reason": record["description"],
        "severity": record["severity"],
        "against_current_medicine": against_current,
        "citations": citations,
        "rules": [],
    }


def _mechanism_warning(rules, name_a, name_b, against_current):
    highest = min(rules, key=lambda r: _RULE_LEVEL_RANK[r["level"]])
    reasons = []
    for rule in rules:
        if rule["reason_sentence"] not in reasons:
            reasons.append(rule["reason_sentence"])
    return {
        "level": LEVEL_MECHANISM_BASED,
        "label": LEVEL_LABELS[LEVEL_MECHANISM_BASED],
        "medicine_a": name_a,
        "medicine_b": name_b,
        "reason": " ".join(reasons),
        "severity": None,
        "caution_level": highest["level"],
        "against_current_medicine": against_current,
        # Mechanism cautions are reasoning, not findings, so they carry no
        # citation. Inventing one would be the exact failure this project
        # forbids (docs/PROJECT_SCOPE.md).
        "citations": [],
        "rules": [
            {
                "rule_id": r["rule_id"],
                # The ordered pair, not the set: a rule whose two tags are the
                # same (two hypoglycemic things together) is a real rule, and a
                # set would collapse it to one tag and hide what fired.
                "tags": sorted((r["tag_a"], r["tag_b"])),
                "level": r["level"],
            }
            for r in rules
        ],
    }


def _plain_warning(level, name_a, name_b, reason, against_current):
    return {
        "level": level,
        "label": LEVEL_LABELS[level],
        "medicine_a": name_a,
        "medicine_b": name_b,
        "reason": reason,
        "severity": None,
        "against_current_medicine": against_current,
        "citations": [],
        "rules": [],
    }


def check_combination(conn, left, right, rules, tag_map, against_current):
    """One pair: the documented record if there is one, else a rule, else neither.

    `left` and `right` are dicts with `medicine_id`, `name` and `medicine_type`.
    The documented check goes through hdi.interactions.check_pair, the same
    function /interactions/check uses, so order-independence and alias
    resolution behave identically here.
    """
    name_a, name_b = left["name"], right["name"]
    pair_kind = _pair_kind_key(left["medicine_type"], right["medicine_type"])

    record, error = check_pair(conn, left["medicine_id"], right["medicine_id"])
    if error is not None:
        # Both sides are ids this service just resolved, so the only reachable
        # error is the two being the same medicine, which the caller filters.
        return None

    if record["status"] == db.STATUS_INTERACTION_FOUND:
        return _literature_warning(record, name_a, name_b, against_current)

    fired = _matching_rules(
        rules,
        tag_map.get(left["medicine_id"], set()),
        tag_map.get(right["medicine_id"], set()),
        pair_kind,
    )
    if fired:
        return _mechanism_warning(fired, name_a, name_b, against_current)

    if record["status"] == db.STATUS_NO_DOCUMENTED_INTERACTION:
        return _plain_warning(
            LEVEL_NO_DOCUMENTED, name_a, name_b, NO_RECORD_SENTENCE, against_current
        )
    return _plain_warning(
        LEVEL_INSUFFICIENT, name_a, name_b, INSUFFICIENT_SENTENCE, against_current
    )


def _class_warning(conn, suggestion, current_class, rules):
    """A pair where the user named a drug class rather than a product."""
    shared = knowledge.tags_for_class(conn, current_class["drug_class"])
    if not shared:
        return None
    suggestion_tags = knowledge.tags_for(conn, suggestion["medicine_id"])
    pair_kind = _pair_kind_key(suggestion["medicine_type"], "drug")
    fired = _matching_rules(rules, suggestion_tags, shared, pair_kind)
    if not fired:
        return None
    warning = _mechanism_warning(
        fired, suggestion["name"], current_class["drug_class"], True
    )
    warning["medicine_b_is_drug_class"] = True
    return warning


def _warning_sort_key(warning):
    return (
        0 if warning["against_current_medicine"] else 1,
        _LEVEL_RANK[warning["level"]],
        _RULE_LEVEL_RANK.get(warning.get("caution_level")),
        warning["medicine_a"].lower(),
        str(warning["medicine_b"]).lower(),
    )


# Levels worth printing for a pair of two things we merely *offered*.
#
# Every pair is checked, but a response listing "no documented interaction" for
# all 70-odd suggestion pairs buries the handful that matter. A no-finding result
# is reported when it is about something the user told us they already take --
# there the absence is the answer to a question they actually asked -- and
# counted but not listed otherwise. The counts travel in `combination_summary`,
# so nothing is hidden, only unlisted.
_ALWAYS_REPORTED_LEVELS = (LEVEL_LITERATURE_VERIFIED, LEVEL_MECHANISM_BASED)


def _combination_warnings(conn, suggestions, current_medicines, current_classes):
    """Every pair worth reporting: suggestion x suggestion, and suggestion x current.

    Pairs between two medicines the user already takes are not checked. They are
    a prescribing decision already made by whoever prescribed them, and this
    service was not asked about them.

    Returns (warnings, summary).
    """
    rules = knowledge.combination_rules(conn)
    ids = {s["medicine_id"] for s in suggestions}
    ids.update(c["medicine_id"] for c in current_medicines)
    tag_map = knowledge.tags_for_many(conn, ids)

    warnings = []
    checked = 0
    omitted = 0
    ordered = sorted(suggestions, key=lambda s: (s["medicine_type"], s["name"]))

    def record(warning, always):
        nonlocal checked, omitted
        checked += 1
        if warning is None:
            return
        if always or warning["level"] in _ALWAYS_REPORTED_LEVELS:
            warnings.append(warning)
        else:
            omitted += 1

    # Among the options we offered, the herb x drug axis is the one that matters:
    # the realistic risk is someone adding a herb to the conventional medicine
    # they are prescribed. Enumerating every herb x herb pair as well would
    # repeat "both lower blood sugar" dozens of times for a diabetes query and
    # bury the pairs a reader can act on. Herb x herb and drug x drug are still
    # checked wherever a user actually names one (suggestion x current, below).
    herbs = [s for s in ordered if s["medicine_type"] == "herb"]
    drugs = [s for s in ordered if s["medicine_type"] == "drug"]
    for herb in herbs:
        for drug in drugs:
            record(check_combination(conn, herb, drug, rules, tag_map, False), False)

    for suggestion in ordered:
        for current in current_medicines:
            if suggestion["medicine_id"] == current["medicine_id"]:
                continue
            # Against something they already take, "we looked and found nothing"
            # is the answer to their question, so it is always listed.
            record(check_combination(conn, suggestion, current, rules, tag_map, True), True)
        for current_class in current_classes:
            warning = _class_warning(conn, suggestion, current_class, rules)
            checked += 1
            if warning is not None:
                warnings.append(warning)

    warnings.sort(key=_warning_sort_key)
    summary = {
        "pairs_checked": checked,
        "warnings_listed": len(warnings),
        "pairs_with_no_finding_not_listed": omitted,
        "note": (
            "Checked: every suggested herb against every suggested drug, and every "
            "suggestion against each medicine you said you already take. Suggestion pairs "
            "with no documented interaction and no mechanism rule are counted here rather "
            "than listed. Absence of a listing is not a safety claim."
        ),
    }
    return warnings, summary


def _already_taking_notes(suggestions, current_medicines):
    """Say so when a suggested option is something they already take."""
    taken = {c["medicine_id"]: c["name"] for c in current_medicines}
    return [
        f"{taken[s['medicine_id']]} is listed as an option below and you have said you "
        f"already take it. Do not add a second source of it."
        for s in suggestions
        if s["medicine_id"] in taken
    ]


# ---------------------------------------------------------------------------
# response assembly
# ---------------------------------------------------------------------------

def _base_response(status):
    return {"status": status, "disclaimer": DISCLAIMER}


def _emergency_response(matches, screen):
    """No options, no interactions, no condition list. Only what to do now."""
    response = _base_response(STATUS_EMERGENCY)
    response.update(
        {
            "red_flags": [
                {"category": m["category"], "label": m["label"], "message": m["message"]}
                for m in matches
            ],
            "message": (
                "What you described may be a medical emergency. This is not the place to "
                "look for options right now."
            ),
            "actions": screen.emergency_actions(matches),
            "detected_conditions": [],
            "ayurvedic_options": [],
            "allopathic_options": [],
            "combination_warnings": [],
            "caution_notes": [],
        }
    )
    return response


def recommend(conn, text=None, current_medicines=None, cautions=None, condition_ids=None,
              classifier_path=None, red_flags_path=None):
    """Run the pipeline and return the response payload.

    Raises RequestError for a rejected request. Every other outcome is a 200 with
    a `status` saying which of the four it is.
    """
    current_medicines = _validate_list(current_medicines, "current_medicines",
                                      MAX_CURRENT_MEDICINES)
    requested_conditions = _validate_list(condition_ids, "condition_ids", MAX_CONDITION_IDS)
    cautions = _validate_cautions(cautions)
    text = _validate_text(text, required=not requested_conditions)

    # Red flags first, before the classifier and before any lookup.
    screen = safety.load_red_flags(red_flags_path)
    matches = screen.check(text)
    if matches:
        return _emergency_response(matches, screen)

    if not knowledge.has_knowledge_data(conn):
        raise RequestError(
            "knowledge_unavailable",
            "The condition and use tables are empty. Run `python -m hdi.seed`.",
        )

    supported = knowledge.list_conditions(conn)
    supported_ids = [c["condition_id"] for c in supported]

    notes = safety.caution_notes(cautions)
    ignored_flags = safety.unknown_caution_flags(cautions)

    # condition_ids skips the classifier entirely, which is how a client acts on
    # a previous low_confidence answer.
    if requested_conditions:
        unknown = [c for c in requested_conditions if c not in supported_ids]
        if unknown:
            raise RequestError(
                "invalid_parameter",
                f"Unknown condition_ids: {unknown}.",
                supported_conditions=supported,
            )
        detected = [
            {"condition_id": c, "confidence": None, "source": "supplied_by_caller"}
            for c in dict.fromkeys(requested_conditions)
        ]
        status = STATUS_RESULTS
    else:
        if not text.strip():
            raise RequestError(
                "invalid_parameter",
                "Field 'text' must not be blank when 'condition_ids' is not given.",
            )
        try:
            classifier = classify.load_classifier(classifier_path)
        except classify.ClassifierUnavailable as exc:
            raise RequestError("classifier_unavailable", str(exc))

        status, above, _ = classifier.classify(text)
        detected = [
            {
                "condition_id": d["condition_id"],
                "confidence": d["confidence"],
                "source": "classifier",
            }
            for d in above
            if d["condition_id"] in supported_ids
        ]
        if status == classify.STATUS_RESULTS and not detected:
            # The model named something the knowledge layer has no rows for.
            status = STATUS_LOW_CONFIDENCE

    if status == STATUS_OUT_OF_SCOPE:
        response = _base_response(STATUS_OUT_OF_SCOPE)
        response.update(
            {
                "detected_conditions": [],
                "note": OUT_OF_SCOPE_NOTE,
                "supported_conditions": supported,
                "ayurvedic_options": [],
                "allopathic_options": [],
                "combination_warnings": [],
                "caution_notes": notes,
            }
        )
        if ignored_flags:
            response["ignored_caution_flags"] = ignored_flags
        return response

    if status == STATUS_LOW_CONFIDENCE:
        response = _base_response(STATUS_LOW_CONFIDENCE)
        response.update(
            {
                "detected_conditions": [],
                "note": LOW_CONFIDENCE_NOTE,
                "supported_conditions": supported,
                "ayurvedic_options": [],
                "allopathic_options": [],
                "combination_warnings": [],
                "caution_notes": notes,
            }
        )
        if ignored_flags:
            response["ignored_caution_flags"] = ignored_flags
        return response

    # ---- results --------------------------------------------------------
    condition_names = {c["condition_id"]: c["name"] for c in supported}
    for entry in detected:
        entry["name"] = condition_names[entry["condition_id"]]

    ayurvedic, allopathic = [], []
    for entry in detected:
        for option in knowledge.options_for_condition(conn, entry["condition_id"], "herb"):
            option["condition_id"] = entry["condition_id"]
            option["condition_name"] = entry["name"]
            ayurvedic.append(option)
        for option in knowledge.options_for_condition(conn, entry["condition_id"], "drug"):
            option["condition_id"] = entry["condition_id"]
            option["condition_name"] = entry["name"]
            allopathic.append(option)

    resolved, resolved_classes, unresolved, ambiguous = _resolve_current(
        conn, current_medicines
    )

    # One entry per distinct medicine for the pair check, even where a medicine
    # was offered for two detected conditions.
    suggestions = {}
    for option in ayurvedic + allopathic:
        suggestions.setdefault(
            option["medicine_id"],
            {
                "medicine_id": option["medicine_id"],
                "name": option["name"],
                "medicine_type": option["medicine_type"],
            },
        )

    warnings, combination_summary = _combination_warnings(
        conn, list(suggestions.values()), resolved, resolved_classes
    )

    notes = list(notes)
    notes.extend(_already_taking_notes(list(suggestions.values()), resolved))
    if unresolved:
        notes.append(
            "These were not recognised and were not checked for interactions: "
            + ", ".join(unresolved)
            + ". Only the 40 herbs and 13 drugs in this database can be checked."
        )
    if ambiguous:
        notes.append(
            "These names matched more than one medicine and were not checked: "
            + ", ".join(a["query"] for a in ambiguous)
            + ". Send a medicine id instead."
        )
    if resolved_classes:
        notes.append(
            "You named a group of medicines rather than a specific one: "
            + ", ".join(sorted({c["drug_class"] for c in resolved_classes}))
            + ". Only cautions that hold for every medicine in the group are shown."
        )
    if any(e["source"] == "classifier" for e in detected):
        notes.append(CLASSIFIER_NOTE)

    response = _base_response(STATUS_RESULTS)
    response.update(
        {
            "detected_conditions": detected,
            "ayurvedic_options": ayurvedic,
            "allopathic_options": allopathic,
            "combination_warnings": warnings,
            "combination_summary": combination_summary,
            "caution_notes": notes,
            "current_medicines": {
                "resolved": resolved,
                "drug_classes": resolved_classes,
                "unresolved": unresolved,
                "ambiguous": ambiguous,
            },
            "evidence_note": (
                "Every option here is unreviewed research data: `reviewed` is false on all "
                "of them and `source_type` says where each came from. Only warnings with "
                f"level '{LEVEL_LITERATURE_VERIFIED}' rest on a published finding."
            ),
        }
    )
    if ignored_flags:
        response["ignored_caution_flags"] = ignored_flags
    return response
