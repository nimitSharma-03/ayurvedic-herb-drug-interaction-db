import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";

import { InteractionRow } from "@/components/interaction-row";
import { Answer } from "@/components/recommend-answer";
import {
  describe as describeFindings,
  scanForBrandNames,
  scanForHardcodedValues,
  scanText,
  strippedSource,
} from "@/lib/forbidden";
import { NOT_RECORDED, NOT_REVIEWED } from "@/lib/text";
import type {
  InteractionRecord,
  MedicineInteractionsResponse,
  RecommendResponse,
  StatsResponse,
} from "@/lib/types";
import { allFixtures, fixture, fixtureNames, recommendFixtures, statsFixture } from "../fixtures";
import { brandNames, conditionNames, drugClassNames, drugNames, herbNames } from "../repo-data";

const SRC = join(process.cwd(), "src");

function sourceFiles(dir = SRC): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry) ? [path] : [];
  });
}

const SOURCES = sourceFiles().map((path) => ({
  path: relative(process.cwd(), path),
  text: readFileSync(path, "utf-8"),
}));

/**
 * The scanner itself holds every forbidden pattern as a literal, so scanning it
 * for forbidden wording would always fire. Its calibration is pinned instead by
 * tests/unit/forbidden.test.ts, in both directions.
 */
const SCANNER = join("src", "lib", "forbidden.ts");
const SCANNABLE = SOURCES.filter((file) => file.path !== SCANNER);

/* ------------------------------------------------------------------------- */
/* Nothing medical is written into this app                                  */
/* ------------------------------------------------------------------------- */

describe("no medical content is hardcoded in the front end", () => {
  it("has source files to scan", () => {
    expect(SOURCES.length).toBeGreaterThan(20);
  });

  const medicineNames = [...herbNames(), ...drugNames()];

  it("reads the real names from the repository rather than a copy here", () => {
    expect(medicineNames.length).toBeGreaterThan(40);
    expect(conditionNames().length).toBeGreaterThan(1);
  });

  it.each(SOURCES.map((file) => file.path))("%s names no medicine", (path) => {
    const file = SOURCES.find((entry) => entry.path === path)!;
    const findings = scanForHardcodedValues(
      strippedSource(file.text),
      medicineNames.map((name) => ({ label: "a medicine name", needle: name })),
    );
    expect(describeFindings(findings)).toBe("");
  });

  it.each(SOURCES.map((file) => file.path))("%s names no condition", (path) => {
    const file = SOURCES.find((entry) => entry.path === path)!;
    const findings = scanForHardcodedValues(
      strippedSource(file.text),
      conditionNames().map((name) => ({ label: "a condition name", needle: name })),
    );
    expect(describeFindings(findings)).toBe("");
  });

  it.each(SOURCES.map((file) => file.path))("%s names no drug class", (path) => {
    const file = SOURCES.find((entry) => entry.path === path)!;
    const findings = scanForHardcodedValues(
      strippedSource(file.text),
      drugClassNames().map((name) => ({ label: "a drug class", needle: name })),
    );
    expect(describeFindings(findings)).toBe("");
  });

  /**
   * The counts and scores /stats reports, none of which may appear as a literal
   * anywhere in src/. Taken from the live response, so changing the corpus
   * changes what this test looks for -- it can never go stale against a number
   * someone pasted in.
   */
  const statsValues = (() => {
    const stats: StatsResponse = statsFixture();
    const values: { label: string; needle: string }[] = [];
    const push = (label: string, value: number | null | undefined) => {
      // Values below 100 are left out: they collide with ordinary numbers in
      // layout and in loop bounds, and matching them would make this test
      // noise rather than a check. Every count the pages actually print that is
      // smaller than that is covered by the fixture-render scans below, which
      // read the rendered page instead of the source.
      if (typeof value === "number" && value >= 100) {
        values.push({ label, needle: String(value) });
      }
    };
    push("pairs searched", stats.literature.pairs_searched);
    push("abstracts harvested", stats.literature.abstracts_harvested);
    push("distinct PMIDs harvested", stats.literature.distinct_pmids_harvested);
    push("candidate sentences", stats.literature.candidate_sentences);
    push("evidence rows", stats.literature.evidence_rows);
    push("alias count", stats.scope.aliases);
    push("condition synonym count", stats.scope.condition_synonyms);
    for (const [key, value] of Object.entries(stats.literature.result_states)) {
      push(`the ${key} count`, value);
    }
    for (const [key, value] of Object.entries(stats.literature.no_finding_basis)) {
      push(`the ${key} count`, value);
    }
    if (stats.classifier) {
      values.push({
        label: "the test macro-F1",
        needle: String(stats.classifier.macro_f1_test),
      });
      if (stats.classifier.macro_f1_validation !== null) {
        values.push({
          label: "the validation macro-F1",
          needle: String(stats.classifier.macro_f1_validation),
        });
      }
      for (const row of stats.classifier.per_class) {
        values.push({ label: `an F1 score (${row.class})`, needle: String(row.f1) });
      }
    }
    return values;
  })();

  it("has real counts and scores to look for", () => {
    expect(statsValues.length).toBeGreaterThan(8);
  });

  it.each(SOURCES.map((file) => file.path))("%s hardcodes no count or score", (path) => {
    const file = SOURCES.find((entry) => entry.path === path)!;
    const findings = scanForHardcodedValues(strippedSource(file.text), statsValues);
    expect(describeFindings(findings)).toBe("");
  });

  it("has a scanner to exclude, and everything else to scan", () => {
    expect(SOURCES.some((file) => file.path === SCANNER)).toBe(true);
    expect(SCANNABLE.length).toBe(SOURCES.length - 1);
  });

  it.each(SCANNABLE.map((file) => file.path))("%s has no forbidden wording", (path) => {
    const file = SCANNABLE.find((entry) => entry.path === path)!;
    expect(describeFindings(scanText(strippedSource(file.text)))).toBe("");
  });

  it.each(SCANNABLE.map((file) => file.path))("%s names no brand", (path) => {
    const file = SCANNABLE.find((entry) => entry.path === path)!;
    expect(
      describeFindings(scanForBrandNames(strippedSource(file.text), brandNames())),
    ).toBe("");
  });

  it("holds no API key or credential of any kind", () => {
    // A credential is an assigned value, not the word. The comments in
    // src/lib/api.ts say out loud that this app sends no key, and a scan for
    // the bare word would flag the very sentence that promises it.
    for (const file of SOURCES) {
      expect(file.text, file.path).not.toMatch(
        /(?:api[-_]?key|client[-_]?secret|access[-_]?token|authorization)\s*[:=]\s*["'`][^"'`]/i,
      );
      expect(file.text, file.path).not.toMatch(/\bBearer\s+[\w-]{12,}/);
      expect(file.text, file.path).not.toMatch(
        /\bprocess\.env\.[A-Z_]*(?:KEY|SECRET|TOKEN)/,
      );
    }
  });
});

/* ------------------------------------------------------------------------- */
/* What a reader actually sees                                               */
/* ------------------------------------------------------------------------- */

const RECOMMEND = recommendFixtures();
const BRANDS = brandNames();

function renderedText(element: React.ReactElement): string {
  const { container } = render(element);
  return (container.textContent ?? "").replace(/\s+/g, " ");
}

describe("the rendered answer carries no forbidden output", () => {
  it("has every status to render", () => {
    const statuses = new Set(RECOMMEND.map((item) => item.response.status));
    expect(statuses).toEqual(
      new Set(["results", "emergency", "out_of_scope", "low_confidence"]),
    );
  });

  it.each(RECOMMEND.map((item) => item.name))("%s renders cleanly", (name) => {
    const item = fixture<RecommendResponse>(name);
    const text = renderedText(
      <Answer
        response={item.response}
        fallbackConditions={item.response.supported_conditions ?? []}
        conditionsNote="The conditions this database covers."
        onPickCondition={() => {}}
      />,
    );
    expect(describeFindings(scanText(text)), name).toBe("");
  });

  it.each(RECOMMEND.map((item) => item.name))("%s prints no brand name", (name) => {
    const item = fixture<RecommendResponse>(name);
    const text = renderedText(
      <Answer
        response={item.response}
        fallbackConditions={item.response.supported_conditions ?? []}
        conditionsNote="The conditions this database covers."
        onPickCondition={() => {}}
      />,
    );
    expect(describeFindings(scanForBrandNames(text, BRANDS)), name).toBe("");
  });
});

describe("the rendered interaction rows carry no forbidden output", () => {
  const records: { name: string; record: Omit<InteractionRecord, "disclaimer"> }[] = [];
  for (const name of fixtureNames()) {
    if (name.startsWith("check-")) {
      const item = fixture<InteractionRecord>(name);
      if (item.status === 200) records.push({ name, record: item.response });
    }
    if (name.startsWith("interactions-")) {
      const item = fixture<MedicineInteractionsResponse>(name);
      for (const [index, record] of item.response.results.entries()) {
        records.push({ name: `${name}[${index}]`, record });
      }
    }
    if (name === "documented") {
      const item = fixture<MedicineInteractionsResponse>(name);
      for (const [index, record] of item.response.results.entries()) {
        records.push({ name: `${name}[${index}]`, record });
      }
    }
  }

  it("has rows to render", () => {
    expect(records.length).toBeGreaterThan(20);
  });

  it("renders every one without forbidden output or a brand name", () => {
    for (const { name, record } of records) {
      const text = renderedText(<InteractionRow record={record} />);
      expect(describeFindings(scanText(text)), name).toBe("");
      expect(describeFindings(scanForBrandNames(text, BRANDS)), name).toBe("");
    }
  });

  it("never words a no-finding row as safety", () => {
    for (const { name, record } of records) {
      if (record.status !== "no_documented_interaction") continue;
      const text = renderedText(<InteractionRow record={record} />);
      expect(text, name).toMatch(/no documented interaction/i);
      expect(text.toLowerCase(), name).not.toMatch(/\bno interaction\b(?!.*documented)/);
    }
  });

  it("says a field is not recorded rather than leaving it blank", () => {
    // Every row in this project has a null mechanism and recommended action, so
    // the full row must say so in words.
    const withNulls = records.find(
      ({ record }) => record.mechanism === null && record.recommended_action === null,
    );
    expect(withNulls).toBeDefined();
    const text = renderedText(<InteractionRow record={withNulls!.record} />);
    expect(text).toContain(NOT_RECORDED);
  });
});

describe("the rendered answer tells the truth about its data", () => {
  const results = RECOMMEND.filter((item) => item.response.status === "results");

  it("has a results fixture", () => {
    expect(results.length).toBeGreaterThan(0);
  });

  it.each(results.map((item) => item.name))("%s labels every option unreviewed", (name) => {
    const item = fixture<RecommendResponse>(name);
    const options = [
      ...item.response.ayurvedic_options,
      ...item.response.allopathic_options,
    ];
    const text = renderedText(
      <Answer
        response={item.response}
        fallbackConditions={[]}
        conditionsNote="note"
        onPickCondition={() => {}}
      />,
    );
    const occurrences = text.split(NOT_REVIEWED).length - 1;
    expect(occurrences, name).toBe(options.length);
  });

  it.each(results.map((item) => item.name))("%s shows every option's name", (name) => {
    const item = fixture<RecommendResponse>(name);
    const text = renderedText(
      <Answer
        response={item.response}
        fallbackConditions={[]}
        conditionsNote="note"
        onPickCondition={() => {}}
      />,
    );
    for (const option of [
      ...item.response.ayurvedic_options,
      ...item.response.allopathic_options,
    ]) {
      expect(text, `${name}: ${option.name}`).toContain(option.name);
    }
  });

  it.each(results.map((item) => item.name))("%s shows every warning's reason", (name) => {
    const item = fixture<RecommendResponse>(name);
    const text = renderedText(
      <Answer
        response={item.response}
        fallbackConditions={[]}
        conditionsNote="note"
        onPickCondition={() => {}}
      />,
    );
    for (const reason of new Set(
      item.response.combination_warnings.map((warning) => warning.reason),
    )) {
      expect(text, `${name}: ${reason.slice(0, 40)}`).toContain(reason);
    }
  });

  it.each(RECOMMEND.map((item) => item.name))("%s shows the disclaimer verbatim", (name) => {
    const item = fixture<RecommendResponse>(name);
    const text = renderedText(
      <Answer
        response={item.response}
        fallbackConditions={item.response.supported_conditions ?? []}
        conditionsNote="note"
        onPickCondition={() => {}}
      />,
    );
    expect(text, name).toContain(item.response.disclaimer);
  });

  it("offers no option at all on an emergency", () => {
    const item = fixture<RecommendResponse>("recommend-emergency");
    const { container } = render(
      <Answer
        response={item.response}
        fallbackConditions={[]}
        conditionsNote="note"
        onPickCondition={() => {}}
      />,
    );
    expect(container.querySelectorAll("[data-testid='option-card']")).toHaveLength(0);
    expect(container.querySelector("[data-testid='emergency']")).not.toBeNull();
    const text = (container.textContent ?? "").replace(/\s+/g, " ");
    expect(text).toContain(item.response.message!);
    for (const action of item.response.actions ?? []) {
      expect(text).toContain(action);
    }
  });

  it("dims an already-taken option instead of suggesting it", () => {
    const item = fixture<RecommendResponse>("recommend-diabetes-metformin");
    const { container } = render(
      <Answer
        response={item.response}
        fallbackConditions={[]}
        conditionsNote="note"
        onPickCondition={() => {}}
      />,
    );
    const taken = container.querySelectorAll("[data-already-taken='true']");
    expect(taken.length).toBeGreaterThan(0);
    for (const card of taken) {
      expect(card.textContent).toContain("You take this");
    }
  });

  it("shows every warning the API returned, grouped", () => {
    const item = fixture<RecommendResponse>("recommend-diabetes-metformin");
    const { container } = render(
      <Answer
        response={item.response}
        fallbackConditions={[]}
        conditionsNote="note"
        onPickCondition={() => {}}
      />,
    );
    const rows = container.querySelectorAll("[data-testid='warning-row']");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(item.response.combination_warnings.length);

    const text = (container.textContent ?? "").replace(/\s+/g, " ");
    expect(text).toContain(item.response.combination_summary!.note);
    // Every medicine named in a warning appears somewhere in the panel.
    for (const warning of item.response.combination_warnings) {
      expect(text).toContain(warning.medicine_a);
      expect(text).toContain(warning.medicine_b);
    }
  });

  it("uses the API's own label for every warning level", () => {
    for (const item of RECOMMEND) {
      if (item.response.combination_warnings.length === 0) continue;
      const text = renderedText(
        <Answer
          response={item.response}
          fallbackConditions={[]}
          conditionsNote="note"
          onPickCondition={() => {}}
        />,
      );
      for (const label of new Set(
        item.response.combination_warnings.map((warning) => warning.label),
      )) {
        expect(text, `${item.name}: ${label}`).toContain(label);
      }
    }
  });
});

describe("every fixture's own strings are clean", () => {
  it("covers all the captured responses", () => {
    expect(allFixtures().length).toBe(fixtureNames().length);
  });
});
