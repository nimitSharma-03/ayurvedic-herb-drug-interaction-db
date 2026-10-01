import { describe, expect, it } from "vitest";

import { pmidsIn, pubmedUrl } from "@/lib/text";
import type {
  InteractionRecord,
  MedicineDetail,
  MedicineInteractionsResponse,
  RecommendResponse,
  SearchResponse,
  StatsResponse,
} from "@/lib/types";
import { fixture, fixtureNames, recommendFixtures, statsFixture } from "../fixtures";

/**
 * The types were written from these responses, so this checks they still match.
 *
 * Every field the app reads is asserted to be present and of the declared kind
 * in the real response. A backend change that renamed or dropped one fails
 * here, with the field named, rather than rendering as `undefined` on a page.
 */

function keysOf(value: unknown): string[] {
  return value !== null && typeof value === "object" ? Object.keys(value) : [];
}

describe("search results", () => {
  const names = fixtureNames().filter((name) => name.startsWith("search-"));

  it("has search fixtures", () => {
    expect(names.length).toBeGreaterThan(3);
  });

  it.each(names)("%s has the declared shape", (name) => {
    const { response } = fixture<SearchResponse>(name);
    expect(typeof response.query).toBe("string");
    expect(typeof response.count).toBe("number");
    expect(Array.isArray(response.results)).toBe(true);
    expect(response.results).toHaveLength(response.count);
    for (const result of response.results) {
      expect(keysOf(result).sort()).toEqual(
        [
          "category",
          "drug_class",
          "evidence_level",
          "generic_name",
          "id",
          "matched_on",
          "medicine_type",
          "name",
          "scientific_name",
        ].sort(),
      );
      expect(["herb", "drug"]).toContain(result.medicine_type);
      expect(typeof result.matched_on).toBe("string");
    }
  });

  it("says an alias matched when an alias is what was typed", () => {
    const { response } = fixture<SearchResponse>("search-indian-ginseng");
    expect(response.results[0]!.matched_on).toBe("exact_alias");
  });

  it("returns nothing for a name outside the frozen scope", () => {
    const { response } = fixture<SearchResponse>("search-empty");
    expect(response.count).toBe(0);
    expect(response.results).toEqual([]);
  });
});

describe("medicine detail", () => {
  const names = fixtureNames().filter(
    (name) => name.startsWith("medicine-") && name !== "medicine-not-found",
  );

  it("has detail fixtures", () => {
    expect(names.length).toBeGreaterThan(3);
  });

  it.each(names)("%s has every field the page reads", (name) => {
    const { response } = fixture<MedicineDetail>(name);
    for (const field of [
      "id",
      "name",
      "category",
      "medicine_type",
      "aliases",
      "sources",
      "data_completeness",
      "interaction_summary",
      "recorded_uses",
    ]) {
      expect(keysOf(response), field).toContain(field);
    }
    expect(Array.isArray(response.aliases)).toBe(true);
    expect(Array.isArray(response.recorded_uses)).toBe(true);
    expect(typeof response.data_completeness.note).toBe("string");
  });

  it.each(names)("%s reports no use row as reviewed", (name) => {
    const { response } = fixture<MedicineDetail>(name);
    for (const use of response.recorded_uses) {
      expect(use.reviewed, `${name} ${use.condition_id}`).toBe(false);
    }
  });

  it.each(names)("%s lists no brand name among its aliases", (name) => {
    const { response } = fixture<MedicineDetail>(name);
    for (const alias of response.aliases) {
      expect(alias.alias_type, `${name} ${alias.alias}`).not.toBe("brand_name");
    }
  });

  it("carries sourced uses where the project has them", () => {
    const { response } = fixture<MedicineDetail>("medicine-metformin");
    expect(response.recorded_uses.length).toBeGreaterThan(0);
    for (const use of response.recorded_uses) {
      expect(typeof use.condition_name).toBe("string");
      expect(["traditional", "preclinical", "clinical"]).toContain(use.evidence_level);
      expect(["fetched_source", "repo_abstract", "general_knowledge"]).toContain(
        use.source_type,
      );
    }
  });

  it("returns an empty list rather than null where it has none", () => {
    const { response } = fixture<MedicineDetail>("medicine-no-uses");
    expect(response.recorded_uses).toEqual([]);
  });
});

describe("interaction records", () => {
  const checks = fixtureNames().filter((name) => name.startsWith("check-"));

  it.each(checks)("%s matches one of the declared shapes", (name) => {
    const item = fixture<InteractionRecord | { error: { code: string } }>(name);
    if (item.status === 200) {
      const record = item.response as InteractionRecord;
      expect([
        "interaction_found",
        "no_documented_interaction",
        "insufficient_evidence",
      ]).toContain(record.status);
      expect(typeof record.description).toBe("string");
      expect(typeof record.disclaimer).toBe("string");
      expect(keysOf(record.medicine_a)).toContain("id");
      expect(keysOf(record.medicine_b)).toContain("id");
      expect(Array.isArray(record.evidence)).toBe(true);
      // Null means "we have no record of this", not false.
      expect([true, false, null]).toContain(record.interaction_found);
    } else {
      expect(keysOf(item.response)).toContain("error");
    }
  });

  it("is order-independent: the same pair gives the same record either way", () => {
    const forward = fixture<InteractionRecord>("check-turmeric-metformin").response;
    const reverse = fixture<InteractionRecord>("check-metformin-turmeric").response;
    expect(reverse.id).toBe(forward.id);
    expect(reverse.status).toBe(forward.status);
    expect(reverse.severity).toBe(forward.severity);
    expect(reverse.evidence_level).toBe(forward.evidence_level);
    expect(reverse.description).toBe(forward.description);
    // The echoed order follows the caller, which is what a page displays.
    expect(reverse.medicine_a.id).toBe(forward.medicine_b.id);
  });

  it("is order-independent for a pair with nothing documented too", () => {
    const forward = fixture<InteractionRecord>("check-no-documented").response;
    const reverse = fixture<InteractionRecord>("check-aspirin-turmeric").response;
    expect(reverse.status).toBe(forward.status);
    expect(reverse.description).toBe(forward.description);
  });

  it("leaves mechanism, significance and action null on every record", () => {
    const records: Omit<InteractionRecord, "disclaimer">[] = [];
    for (const name of fixtureNames()) {
      if (name.startsWith("interactions-") || name === "documented") {
        records.push(...fixture<MedicineInteractionsResponse>(name).response.results);
      }
    }
    expect(records.length).toBeGreaterThan(20);
    for (const record of records) {
      expect(record.mechanism).toBeNull();
      expect(record.clinical_significance).toBeNull();
      expect(record.recommended_action).toBeNull();
    }
  });
});

describe("the recommend response", () => {
  const items = recommendFixtures();

  it("covers all four statuses", () => {
    expect(new Set(items.map((item) => item.response.status))).toEqual(
      new Set(["results", "emergency", "out_of_scope", "low_confidence"]),
    );
  });

  it.each(items.map((item) => item.name))("%s has the fields every status carries", (name) => {
    const { response } = fixture<RecommendResponse>(name);
    for (const field of [
      "status",
      "disclaimer",
      "detected_conditions",
      "ayurvedic_options",
      "allopathic_options",
      "combination_warnings",
      "caution_notes",
    ]) {
      expect(keysOf(response), field).toContain(field);
    }
  });

  it.each(items.map((item) => item.name))("%s lists options only when it has results", (name) => {
    const { response } = fixture<RecommendResponse>(name);
    const options = [...response.ayurvedic_options, ...response.allopathic_options];
    if (response.status === "results") {
      expect(options.length, name).toBeGreaterThan(0);
      expect(response.combination_summary, name).toBeDefined();
    } else {
      expect(options, name).toEqual([]);
      expect(response.combination_warnings, name).toEqual([]);
    }
  });

  it("gives an emergency a message, red flags and actions and nothing else", () => {
    const { response } = fixture<RecommendResponse>("recommend-emergency");
    expect(response.status).toBe("emergency");
    expect(response.red_flags?.length).toBeGreaterThan(0);
    expect(response.actions?.length).toBeGreaterThan(0);
    expect(typeof response.message).toBe("string");
    expect(response.detected_conditions).toEqual([]);
  });

  it("offers the supported conditions on both of the no-match statuses", () => {
    for (const name of ["recommend-out-of-scope", "recommend-low-confidence"]) {
      const { response } = fixture<RecommendResponse>(name);
      expect(response.supported_conditions?.length, name).toBeGreaterThan(0);
      expect(typeof response.note, name).toBe("string");
      for (const condition of response.supported_conditions!) {
        expect(typeof condition.condition_id).toBe("string");
        expect(typeof condition.name).toBe("string");
        expect(Array.isArray(condition.drug_classes)).toBe(true);
      }
    }
  });

  it("marks a condition chosen by the reader as chosen, not classified", () => {
    const { response } = fixture<RecommendResponse>("recommend-by-condition");
    expect(response.status).toBe("results");
    for (const condition of response.detected_conditions) {
      expect(condition.source).not.toBe("classifier");
    }
  });

  it("reports every option as unreviewed", () => {
    for (const item of items) {
      for (const option of [
        ...item.response.ayurvedic_options,
        ...item.response.allopathic_options,
      ]) {
        expect(option.reviewed, `${item.name} ${option.name}`).toBe(false);
      }
    }
  });

  it("declares every warning's level and a label that matches it", () => {
    for (const item of items) {
      for (const warning of item.response.combination_warnings) {
        expect([
          "literature_verified",
          "mechanism_based",
          "no_documented_interaction",
          "insufficient_evidence",
        ]).toContain(warning.level);
        const saysVerified = /literature-verified/i.test(warning.label);
        const isVerified = warning.level === "literature_verified";
        // Only the first level may claim a published finding, and its label is
        // the only one that reads as a plain claim.
        expect(saysVerified && !/not literature-verified/i.test(warning.label)).toBe(
          isVerified,
        );
      }
    }
  });

  it("counts exactly the warnings it listed", () => {
    for (const item of items) {
      const summary = item.response.combination_summary;
      if (!summary) continue;
      expect(summary.warnings_listed, item.name).toBe(
        item.response.combination_warnings.length,
      );
    }
  });

  it("never claims to have checked fewer pairs than it reports on", () => {
    // An inequality, not an equality. `pairs_checked` also counts a check
    // against a whole drug class the reader named, and a class check that
    // produces nothing is not added to `pairs_with_no_finding_not_listed`. So
    // the two reported buckets can be fewer than the pairs checked, and the
    // page prints the three figures as the API gives them rather than asserting
    // arithmetic between them.
    for (const item of items) {
      const summary = item.response.combination_summary;
      if (!summary) continue;
      expect(
        summary.warnings_listed + summary.pairs_with_no_finding_not_listed,
        item.name,
      ).toBeLessThanOrEqual(summary.pairs_checked);
    }
  });
});

describe("the stats response", () => {
  const stats: StatsResponse = statsFixture();

  it("has every block the pages read", () => {
    expect(keysOf(stats).sort()).toEqual(
      [
        "classifier",
        "classifier_note",
        "database",
        "knowledge",
        "literature",
        "note",
        "scope",
      ].sort(),
    );
  });

  it("reconciles the literature counts", () => {
    expect(
      Object.values(stats.literature.result_states).reduce((sum, value) => sum + value, 0),
    ).toBe(stats.literature.pairs_searched);
    expect(
      Object.values(stats.literature.verdicts).reduce((sum, value) => sum + value, 0),
    ).toBe(stats.literature.evidence_rows);
  });

  it("reconciles the scope counts", () => {
    expect(stats.scope.herbs + stats.scope.drugs).toBe(stats.scope.medicines);
    expect(
      stats.scope.drug_classes_detail.reduce((sum, entry) => sum + entry.drugs, 0),
    ).toBe(stats.scope.drugs);
  });

  it("reconciles the knowledge counts", () => {
    expect(
      stats.knowledge.by_source_type.reduce((sum, row) => sum + row.rows, 0),
    ).toBe(stats.knowledge.rows);
    expect(stats.knowledge.reviewed_rows).toBe(0);
  });

  it("carries the classifier metrics the page displays", () => {
    expect(stats.classifier).not.toBeNull();
    const metrics = stats.classifier!;
    expect(metrics.test_set_is_synthetic).toBe(true);
    expect(typeof metrics.test_set_caveat).toBe("string");
    expect(metrics.per_class.length).toBeGreaterThan(1);
    expect(metrics.macro_f1_test).toBeGreaterThan(0);
    expect(metrics.macro_f1_test).toBeLessThanOrEqual(1);
    for (const row of metrics.per_class) {
      for (const value of [row.precision, row.recall, row.f1]) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("PMIDs read out of a source note", () => {
  it("finds the PMID a repo-abstract row cites", () => {
    const { response } = fixture<MedicineDetail>("medicine-garlic");
    const notes = response.recorded_uses
      .map((use) => use.source_note)
      .filter((note): note is string => typeof note === "string");
    const found = notes.flatMap((note) => pmidsIn(note));
    expect(found.length).toBeGreaterThan(0);
    for (const pmid of found) {
      expect(pmid).toMatch(/^\d{4,9}$/);
    }
  });

  it("finds nothing in a note that cites no paper", () => {
    expect(pmidsIn("openFDA SPL label, set_id 0003458f effective 20241113")).toEqual([]);
    expect(pmidsIn(null)).toEqual([]);
    expect(pmidsIn("")).toEqual([]);
  });

  it("reads several PMIDs out of one note", () => {
    expect(pmidsIn("PMID 10675182, 15916450, 19719333")).toEqual([
      "10675182",
      "15916450",
      "19719333",
    ]);
  });

  it("builds a PubMed URL that matches the one the API sends", () => {
    const item = recommendFixtures().find((entry) =>
      entry.response.combination_warnings.some((warning) => warning.citations.length > 0),
    );
    expect(item).toBeDefined();
    const citation = item!.response.combination_warnings.flatMap(
      (warning) => warning.citations,
    )[0]!;
    expect(pubmedUrl(citation.pmid)).toBe(citation.source_url);
  });
});
