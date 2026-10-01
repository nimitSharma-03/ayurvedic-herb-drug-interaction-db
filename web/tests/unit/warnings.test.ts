import { describe, expect, it } from "vitest";

import {
  citationsFor,
  groupWarnings,
  groupedWarningsFor,
  hubsFor,
  levelRank,
  lineStyleFor,
  resolveSides,
  resolveWarnings,
  rulesFor,
  severitiesFor,
  warningTotals,
} from "@/lib/warnings";
import type { CombinationWarning, RecommendResponse } from "@/lib/types";
import { fixture, recommendFixtures } from "../fixtures";

const WITH_WARNINGS = recommendFixtures().filter(
  (item) => item.response.combination_warnings.length > 0,
);

function warningOf(overrides: Partial<CombinationWarning> = {}): CombinationWarning {
  return {
    level: "mechanism_based",
    label: "Mechanism-based caution (not literature-verified)",
    medicine_a: "Herb one",
    medicine_b: "Drug one",
    reason: "A shared reason.",
    severity: null,
    against_current_medicine: false,
    citations: [],
    rules: [],
    ...overrides,
  };
}

/**
 * A name lookup like the one a real response produces, so the synthetic
 * warnings below resolve their sides the way API data does: the drug is the
 * hub of a herb-and-drug pair, whichever side the backend put it on.
 */
function lookup() {
  const entries = [
    ...["Herb one", "Herb two", "Herb three"].map((name) => ({
      name,
      medicineType: "herb" as const,
      medicineId: name.toLowerCase().replace(/ /g, "-"),
      isCurrent: false,
    })),
    ...["Drug one", "Drug two"].map((name) => ({
      name,
      medicineType: "drug" as const,
      medicineId: name.toLowerCase().replace(/ /g, "-"),
      isCurrent: false,
    })),
  ];
  return new Map(entries.map((entry) => [entry.name.toLowerCase(), entry]));
}

/** groupWarnings over synthetic warnings, with that lookup applied. */
function group(warnings: CombinationWarning[]) {
  const names = lookup();
  return groupWarnings(warnings.map((warning) => resolveSides(warning, names)));
}

describe("warning levels", () => {
  it("ranks the four levels in the order the backend sorts them", () => {
    expect(levelRank("literature_verified")).toBeLessThan(levelRank("mechanism_based"));
    expect(levelRank("mechanism_based")).toBeLessThan(
      levelRank("no_documented_interaction"),
    );
    expect(levelRank("no_documented_interaction")).toBeLessThan(
      levelRank("insufficient_evidence"),
    );
  });

  it("draws a published finding solid and everything else not", () => {
    expect(lineStyleFor("literature_verified")).toBe("solid");
    expect(lineStyleFor("mechanism_based")).toBe("dashed");
    expect(lineStyleFor("no_documented_interaction")).toBe("dotted");
    expect(lineStyleFor("insufficient_evidence")).toBe("dotted");
  });
});

describe("grouping", () => {
  it("collapses warnings that share a level, a hub and a reason", () => {
    const groups = group(
      [
        warningOf({ medicine_a: "Herb one", medicine_b: "Drug one" }),
        warningOf({ medicine_a: "Herb two", medicine_b: "Drug one" }),
        warningOf({ medicine_a: "Herb three", medicine_b: "Drug one" }),
      ],
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]!.warnings).toHaveLength(3);
  });

  it("keeps a different reason in its own row", () => {
    const groups = group(
      [
        warningOf({ reason: "Reason one." }),
        warningOf({ medicine_a: "Herb two", reason: "Reason two." }),
      ],
    );
    expect(groups).toHaveLength(2);
  });

  it("keeps a different level in its own row even with the same reason", () => {
    const groups = group(
      [
        warningOf({ level: "mechanism_based" }),
        warningOf({ level: "insufficient_evidence", label: "Insufficient evidence" }),
      ],
    );
    expect(groups).toHaveLength(2);
    expect(new Set(groups.map((group) => group.level)).size).toBe(2);
  });

  it("keeps a different drug in its own row even with the same reason", () => {
    const groups = group(
      [
        warningOf({ medicine_b: "Drug one" }),
        warningOf({ medicine_b: "Drug two" }),
      ],
    );
    expect(groups).toHaveLength(2);
  });

  it("lists each conflicting medicine once in the row", () => {
    const groups = group(
      [
        warningOf({ medicine_a: "Herb one" }),
        warningOf({ medicine_a: "Herb one" }),
        warningOf({ medicine_a: "Herb two" }),
      ],
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]!.spokes.map((side) => side.name)).toEqual(["Herb one", "Herb two"]);
    // Both duplicates are still carried, so nothing is dropped from the count.
    expect(groups[0]!.warnings).toHaveLength(3);
  });

  it("marks a row as against a current medicine when any of its warnings is", () => {
    const groups = group(
      [
        warningOf({ medicine_a: "Herb one", against_current_medicine: false }),
        warningOf({ medicine_a: "Herb two", against_current_medicine: true }),
      ],
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]!.againstCurrentMedicine).toBe(true);
  });

  it("gives every row a distinct id", () => {
    for (const item of WITH_WARNINGS) {
      const groups = groupedWarningsFor(item.response);
      const ids = groups.map((group) => group.id);
      expect(new Set(ids).size, item.name).toBe(ids.length);
    }
  });
});

describe("hub resolution", () => {
  it("makes the medicine the reader already takes the hub", () => {
    const item = fixture<RecommendResponse>("recommend-diabetes-metformin");
    const resolved = resolveWarnings(item.response);
    const againstCurrent = resolved.filter(
      (entry) => entry.warning.against_current_medicine,
    );
    expect(againstCurrent.length).toBeGreaterThan(0);
    for (const entry of againstCurrent) {
      expect(entry.hub.isCurrent, `${entry.hub.name}/${entry.spoke.name}`).toBe(true);
      expect(entry.spoke.isCurrent).toBe(false);
    }
  });

  it("makes the drug the hub of a herb-and-drug pair when neither is taken", () => {
    const lookup = new Map([
      ["herb one", { name: "Herb one", medicineType: "herb" as const, medicineId: "h1", isCurrent: false }],
      ["drug one", { name: "Drug one", medicineType: "drug" as const, medicineId: "d1", isCurrent: false }],
    ]);
    const resolved = resolveSides(
      warningOf({ medicine_a: "Herb one", medicine_b: "Drug one" }),
      lookup,
    );
    expect(resolved.hub.name).toBe("Drug one");
    expect(resolved.spoke.name).toBe("Herb one");
  });

  it("keeps the API's order when it cannot tell the two apart", () => {
    const resolved = resolveSides(
      warningOf({ medicine_a: "First", medicine_b: "Second" }),
      new Map(),
    );
    expect(resolved.hub.name).toBe("First");
    expect(resolved.spoke.name).toBe("Second");
    expect(resolved.hub.medicineType).toBeNull();
  });

  it("treats every member of a class the reader named as something they take", () => {
    const item = fixture<RecommendResponse>("recommend-bp-cautions");
    const classes = item.response.current_medicines?.drug_classes ?? [];
    expect(classes.length).toBeGreaterThan(0);
    const members = new Set(classes.flatMap((klass) => klass.members));

    for (const entry of resolveWarnings(item.response)) {
      for (const side of [entry.hub, entry.spoke]) {
        if (members.has(side.name)) {
          expect(side.isCurrent, side.name).toBe(true);
        }
      }
    }
  });

  it("puts hubs the reader takes before the rest", () => {
    const item = fixture<RecommendResponse>("recommend-diabetes-metformin");
    const hubs = hubsFor(groupedWarningsFor(item.response));
    const currentFlags = hubs.map((hub) => hub.hub.isCurrent);
    const firstFalse = currentFlags.indexOf(false);
    if (firstFalse !== -1) {
      expect(currentFlags.slice(firstFalse).every((flag) => flag === false)).toBe(true);
    }
  });
});

describe("nothing is dropped or invented", () => {
  it("places every warning in exactly one row, for every fixture", () => {
    expect(WITH_WARNINGS.length).toBeGreaterThan(0);
    for (const item of WITH_WARNINGS) {
      const groups = groupedWarningsFor(item.response);
      const grouped = groups.flatMap((group) => group.warnings);
      expect(grouped.length, item.name).toBe(item.response.combination_warnings.length);
      // Identity, not equality: the same warning object, exactly once.
      for (const warning of item.response.combination_warnings) {
        expect(grouped.filter((entry) => entry === warning).length, item.name).toBe(1);
      }
    }
  });

  it("reconciles the row totals with the API's own summary", () => {
    for (const item of WITH_WARNINGS) {
      const totals = warningTotals(groupedWarningsFor(item.response));
      expect(totals.warnings, item.name).toBe(
        item.response.combination_summary?.warnings_listed,
      );
      expect(totals.groups, item.name).toBeLessThanOrEqual(totals.warnings);
    }
  });

  it("puts every hub's rows back together into the whole list", () => {
    for (const item of WITH_WARNINGS) {
      const groups = groupedWarningsFor(item.response);
      const viaHubs = hubsFor(groups).flatMap((hub) => hub.groups);
      expect(viaHubs.length, item.name).toBe(groups.length);
      expect(new Set(viaHubs).size, item.name).toBe(groups.length);
    }
  });

  it("never changes a warning's level or label", () => {
    for (const item of WITH_WARNINGS) {
      for (const group of groupedWarningsFor(item.response)) {
        for (const warning of group.warnings) {
          expect(warning.level, item.name).toBe(group.level);
          expect(warning.label, item.name).toBe(group.label);
          expect(warning.reason, item.name).toBe(group.reason);
        }
      }
    }
  });

  it("gives a mechanism-based row no citations at all", () => {
    for (const item of WITH_WARNINGS) {
      for (const group of groupedWarningsFor(item.response)) {
        if (group.level === "mechanism_based") {
          expect(citationsFor(group), `${item.name} ${group.id}`).toEqual([]);
        }
      }
    }
  });

  it("gives a literature-verified row at least one PMID", () => {
    const verified = WITH_WARNINGS.flatMap((item) =>
      groupedWarningsFor(item.response).filter(
        (group) => group.level === "literature_verified",
      ),
    );
    expect(verified.length).toBeGreaterThan(0);
    for (const group of verified) {
      const citations = citationsFor(group);
      expect(citations.length, group.id).toBeGreaterThan(0);
      for (const citation of citations) {
        expect(citation.pmid).toMatch(/^\d+$/);
        expect(citation.evidence_sentence.length).toBeGreaterThan(0);
      }
    }
  });

  it("de-duplicates the citations and rules folded into a row", () => {
    const shared = {
      pmid: "1234567",
      evidence_sentence: "One sentence.",
      source_url: "https://pubmed.ncbi.nlm.nih.gov/1234567/",
    };
    const rule = { rule_id: "rule-001", tags: ["a", "b"], level: "high" };
    const groups = group(
      [
        warningOf({ medicine_a: "Herb one", citations: [shared], rules: [rule] }),
        warningOf({ medicine_a: "Herb two", citations: [shared], rules: [rule] }),
      ],
    );
    expect(citationsFor(groups[0]!)).toHaveLength(1);
    expect(rulesFor(groups[0]!)).toHaveLength(1);
  });

  it("lists every severity folded into a row rather than choosing one", () => {
    const groups = group(
      [
        warningOf({ level: "literature_verified", label: "Literature-verified", severity: "minor" }),
        warningOf({
          level: "literature_verified",
          label: "Literature-verified",
          medicine_a: "Herb two",
          severity: "moderate",
        }),
      ],
    );
    expect(groups).toHaveLength(1);
    expect(severitiesFor(groups[0]!).sort()).toEqual(["minor", "moderate"]);
  });

  it("handles a response with no warnings without inventing a row", () => {
    const item = fixture<RecommendResponse>("recommend-emergency");
    expect(groupedWarningsFor(item.response)).toEqual([]);
    expect(hubsFor([])).toEqual([]);
    expect(warningTotals([])).toEqual({
      warnings: 0,
      groups: 0,
      byLevel: {
        literature_verified: 0,
        mechanism_based: 0,
        no_documented_interaction: 0,
        insufficient_evidence: 0,
      },
    });
  });

  it("is stable: the same response groups the same way every time", () => {
    for (const item of WITH_WARNINGS) {
      const first = groupedWarningsFor(item.response).map(
        (group) => `${group.level}|${group.hub.name}|${group.spokes.map((s) => s.name).join(",")}`,
      );
      const second = groupedWarningsFor(item.response).map(
        (group) => `${group.level}|${group.hub.name}|${group.spokes.map((s) => s.name).join(",")}`,
      );
      expect(second, item.name).toEqual(first);
    }
  });
});

describe("the diabetes answer in particular", () => {
  it("collapses the repeated blood-sugar warnings into far fewer rows", () => {
    const item = fixture<RecommendResponse>("recommend-diabetes-metformin");
    const warnings = item.response.combination_warnings;
    const groups = groupedWarningsFor(item.response);
    expect(warnings.length).toBeGreaterThan(20);
    expect(groups.length).toBeLessThan(warnings.length / 2);
  });

  it("puts the literature-verified rows first", () => {
    const item = fixture<RecommendResponse>("recommend-diabetes-metformin");
    const levels = groupedWarningsFor(item.response).map((group) => group.level);
    expect(levels[0]).toBe("literature_verified");
  });
});
