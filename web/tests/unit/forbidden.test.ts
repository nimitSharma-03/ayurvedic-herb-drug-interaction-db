import { describe, expect, it } from "vitest";

import {
  describe as describeFindings,
  scanForBrandNames,
  scanForHardcodedValues,
  scanText,
  strippedSource,
} from "@/lib/forbidden";
import { allFixtures, stringsIn } from "../fixtures";
import { brandNames } from "../repo-data";

/**
 * The scan's own calibration, pinned in both directions.
 *
 * It has to catch a claim of safety and it has to leave alone the sentence this
 * project is required to print for a pair it holds no record of. A scan that
 * drifted either way would be useless: too loose and a claim gets through, too
 * strict and the honest wording gets banned and someone softens it.
 */
describe("the safety-claim scan is calibrated", () => {
  const MUST_CATCH = [
    "This is safe to take with your other medicines.",
    "Turmeric is safe alongside metformin.",
    "The combination is completely safe.",
    "This herb is harmless.",
    "Taking them together is risk-free.",
    "It is perfectly safe.",
    "This pair appears safe.",
    "It is safe for anyone with diabetes.",
  ];

  const MUST_ALLOW = [
    "No documented interaction in this database. This does not mean the combination is safe.",
    "Absence of a documented interaction is not evidence of safety.",
    "This drug has a narrow safety margin.",
    "Nothing here is safe to assume without a doctor.",
    "It is not safe to stop a prescribed medicine on your own.",
    "The database holds no safety data for pregnancy.",
    "A long safety record does not apply to this combination.",
  ];

  it.each(MUST_CATCH)("catches %j", (text) => {
    expect(scanText(text), text).not.toHaveLength(0);
  });

  it.each(MUST_ALLOW)("allows %j", (text) => {
    expect(describeFindings(scanText(text))).toBe("");
  });
});

describe("the dose scan is calibrated", () => {
  const MUST_CATCH = [
    "Take 500 mg a day.",
    "Two 250mg tablets.",
    "5 ml of the extract.",
    "Twice a day with food.",
    "Give 10 units of insulin.",
    "1 tsp of powder.",
    "Take it bd.",
  ];

  const MUST_ALLOW = [
    "520 herb and drug pairs were searched.",
    "PMID 22198821 (randomised double-blind placebo-controlled trial).",
    "Lowers blood sugar in type 2 diabetes, alongside diet and exercise.",
    "Across 1,240 abstracts in 988 distinct papers.",
    "The threshold is 0.29.",
  ];

  it.each(MUST_CATCH)("catches %j", (text) => {
    expect(scanText(text), text).not.toHaveLength(0);
  });

  it.each(MUST_ALLOW)("allows %j", (text) => {
    expect(describeFindings(scanText(text))).toBe("");
  });
});

describe("the brand-name scan", () => {
  const brands = brandNames();

  it("reads the real brand list from the repository, not from a copy here", () => {
    expect(brands.length).toBeGreaterThan(10);
  });

  it("catches a brand name", () => {
    const first = brands[0]!;
    expect(scanForBrandNames(`Ask for ${first} at the chemist.`, brands)).not.toHaveLength(
      0,
    );
  });

  it("does not catch a generic name that a brand is only a fragment of", () => {
    // Several brands are prefixes of the generic they stand for, so matching
    // without word boundaries would flag the generic name the API does print.
    expect(scanForBrandNames("Warfarin and Metformin.", brands)).toHaveLength(0);
  });
});

/**
 * Every string the backend sends is already checked by its own tests. This
 * checks the fixtures too, so the scan used on this app's rendered output is
 * known to pass on real API text; a scan that failed here would be
 * mis-calibrated rather than finding a real problem.
 */
describe("the real API responses pass the scan", () => {
  const fixtures = allFixtures();
  const brands = brandNames();

  it("has fixtures to scan", () => {
    expect(fixtures.length).toBeGreaterThan(20);
  });

  it.each(fixtures.map((item) => item.name))("%s has no forbidden output", (name) => {
    const item = fixtures.find((entry) => entry.name === name)!;
    const findings = stringsIn(item.response).flatMap((text) => scanText(text));
    expect(describeFindings(findings)).toBe("");
  });

  it.each(fixtures.map((item) => item.name))("%s prints no brand name", (name) => {
    const item = fixtures.find((entry) => entry.name === name)!;
    // The `query` field echoes what the caller sent, which is the one place a
    // brand legitimately appears, so it is excluded from this scan.
    const strings = stringsIn(item.response).filter(
      (text) => !isEchoedQuery(item.response, text),
    );
    expect(describeFindings(scanForBrandNames(strings.join("\n"), brands))).toBe("");
  });
});

function isEchoedQuery(response: unknown, text: string): boolean {
  const queries = new Set<string>();
  collectQueries(response, queries);
  return queries.has(text);
}

function collectQueries(value: unknown, out: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectQueries(item, out);
  } else if (value !== null && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (key === "query" && typeof item === "string") out.add(item);
      else collectQueries(item, out);
    }
  }
}

describe("source stripping", () => {
  it("removes layout classes so a scan over source does not trip on them", () => {
    const stripped = strippedSource('<div className="h-13 mg-2 w-40">Text</div>');
    expect(stripped).not.toContain("h-13");
    expect(stripped).toContain("Text");
  });

  it("removes comments but keeps string literals", () => {
    const stripped = strippedSource(
      '// 520 pairs\nconst label = "pairs searched"; /* 1240 */',
    );
    expect(stripped).not.toContain("520");
    expect(stripped).not.toContain("1240");
    expect(stripped).toContain("pairs searched");
  });
});

describe("scanForHardcodedValues", () => {
  it("matches a whole token and not a fragment of a longer one", () => {
    const values = [{ label: "a count", needle: "53" }];
    expect(scanForHardcodedValues("there are 53 of them", values)).not.toHaveLength(0);
    expect(scanForHardcodedValues("value 531 and 253", values)).toHaveLength(0);
  });

  it("matches a name case-insensitively", () => {
    const values = [{ label: "a medicine name", needle: "Turmeric" }];
    expect(scanForHardcodedValues("turmeric is listed", values)).not.toHaveLength(0);
  });
});
