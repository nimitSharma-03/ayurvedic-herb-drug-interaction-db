import { describe, expect, it } from "vitest";

import {
  currentMedicineIndex,
  markOptions,
  markedOptionsFor,
  sourceTypeLabel,
  useEvidenceLabel,
} from "@/lib/options";
import type { CurrentMedicines, RecommendOption, RecommendResponse } from "@/lib/types";
import { fixture, recommendFixtures } from "../fixtures";

const RESULTS = recommendFixtures().filter((item) => item.response.status === "results");

function optionOf(overrides: Partial<RecommendOption> = {}): RecommendOption {
  return {
    medicine_id: "herb-example",
    name: "Example herb",
    category: "ayurvedic",
    medicine_type: "herb",
    scientific_name: null,
    drug_class: null,
    use_kind: "traditional_use",
    evidence_level: "traditional",
    pros: null,
    cons: null,
    cautions: null,
    source_type: "general_knowledge",
    source_note: null,
    uses: null,
    common_side_effects: [],
    tags: [],
    reviewed: false,
    condition_id: "example",
    condition_name: "Example condition",
    ...overrides,
  };
}

const EMPTY_CURRENT: CurrentMedicines = {
  resolved: [],
  drug_classes: [],
  unresolved: [],
  ambiguous: [],
};

describe("marking what the reader already takes", () => {
  it("matches on the medicine id, not on the text they typed", () => {
    const current: CurrentMedicines = {
      ...EMPTY_CURRENT,
      resolved: [
        {
          query: "A brand on the strip",
          medicine_id: "drug-example",
          name: "Example drug",
          medicine_type: "drug",
          category: "allopathic",
          drug_class: "Examples",
          resolved_as: "medicine",
        },
      ],
    };
    const marked = markOptions(
      [optionOf({ medicine_id: "drug-example", name: "Example drug" })],
      current,
    );
    expect(marked[0]!.alreadyTaken).toBe(true);
    expect(marked[0]!.query).toBe("A brand on the strip");
  });

  it("leaves everything else unmarked", () => {
    const marked = markOptions([optionOf()], EMPTY_CURRENT);
    expect(marked[0]!.alreadyTaken).toBe(false);
    expect(marked[0]!.query).toBeNull();
    expect(marked[0]!.viaDrugClass).toBeNull();
  });

  it("keeps the option in the list rather than removing it", () => {
    const item = fixture<RecommendResponse>("recommend-diabetes-metformin");
    const { allopathic } = markedOptionsFor(item.response);
    expect(allopathic).toHaveLength(item.response.allopathic_options.length);
    expect(allopathic.some((entry) => entry.alreadyTaken)).toBe(true);
  });

  it("marks exactly the options the API named in its own caution note", () => {
    const item = fixture<RecommendResponse>("recommend-diabetes-metformin");
    const { ayurvedic, allopathic } = markedOptionsFor(item.response);
    const taken = [...ayurvedic, ...allopathic]
      .filter((entry) => entry.alreadyTaken)
      .map((entry) => entry.option.name);

    expect(taken.length).toBeGreaterThan(0);
    // The backend says so in words; this checks the card agrees with the note.
    const note = item.response.caution_notes.find((text) =>
      text.includes("you already take it"),
    );
    expect(note).toBeDefined();
    for (const name of taken) {
      expect(note, name).toContain(name);
    }
  });

  it("is case-insensitive on the name", () => {
    const current: CurrentMedicines = {
      ...EMPTY_CURRENT,
      resolved: [
        {
          query: "example herb",
          medicine_id: "other-id",
          name: "EXAMPLE HERB",
          medicine_type: "herb",
          category: "ayurvedic",
          drug_class: null,
          resolved_as: "medicine",
        },
      ],
    };
    const marked = markOptions([optionOf({ name: "Example herb" })], current);
    expect(marked[0]!.alreadyTaken).toBe(true);
  });

  it("notes a class the reader named without claiming they take that member", () => {
    const current: CurrentMedicines = {
      ...EMPTY_CURRENT,
      drug_classes: [
        {
          query: "a group name",
          drug_class: "Examples",
          resolved_as: "drug_class",
          members: ["Example drug", "Another drug"],
        },
      ],
    };
    const marked = markOptions(
      [optionOf({ medicine_id: "drug-example", name: "Example drug" })],
      current,
    );
    // Naming a group is not saying which member, so the option is not claimed
    // to be one they take; the card says the group was named instead.
    expect(marked[0]!.alreadyTaken).toBe(false);
    expect(marked[0]!.viaDrugClass).toBe("Examples");
  });

  it("copes with no current_medicines block at all", () => {
    const marked = markOptions([optionOf()], undefined);
    expect(marked[0]!.alreadyTaken).toBe(false);
  });

  it("indexes resolved medicines by both id and name", () => {
    const index = currentMedicineIndex({
      ...EMPTY_CURRENT,
      resolved: [
        {
          query: "typed",
          medicine_id: "drug-x",
          name: "Drug X",
          medicine_type: "drug",
          category: "allopathic",
          drug_class: null,
          resolved_as: "medicine",
        },
      ],
    });
    expect(index.byId.get("drug-x")).toBe("typed");
    expect(index.byName.get("drug x")).toBe("typed");
  });

  it("marks nothing when the reader listed nothing, across every results fixture", () => {
    for (const item of RESULTS) {
      const resolved = item.response.current_medicines?.resolved ?? [];
      const { ayurvedic, allopathic } = markedOptionsFor(item.response);
      const taken = [...ayurvedic, ...allopathic].filter((entry) => entry.alreadyTaken);
      if (resolved.length === 0) {
        expect(taken, item.name).toEqual([]);
      } else {
        const names = new Set(resolved.map((entry) => entry.name.toLowerCase()));
        for (const entry of taken) {
          expect(names.has(entry.option.name.toLowerCase()), item.name).toBe(true);
        }
      }
    }
  });

  it("keeps the API's order, because this project does not rank", () => {
    for (const item of RESULTS) {
      const { ayurvedic, allopathic } = markedOptionsFor(item.response);
      expect(ayurvedic.map((entry) => entry.option.name), item.name).toEqual(
        item.response.ayurvedic_options.map((option) => option.name),
      );
      expect(allopathic.map((entry) => entry.option.name), item.name).toEqual(
        item.response.allopathic_options.map((option) => option.name),
      );
    }
  });
});

describe("labels", () => {
  it("words each evidence grade without implying endorsement", () => {
    expect(useEvidenceLabel("clinical")).toBe("Clinical evidence");
    expect(useEvidenceLabel("preclinical")).toBe("Preclinical evidence");
    expect(useEvidenceLabel("traditional")).toBe("Traditional use");
  });

  it("passes an unknown value straight through rather than guessing", () => {
    expect(useEvidenceLabel("something_new")).toBe("something_new");
    expect(sourceTypeLabel("something_new")).toBe("something_new");
  });

  it("has wording for every source type the fixtures contain", () => {
    const seen = new Set<string>();
    for (const item of RESULTS) {
      for (const option of [
        ...item.response.ayurvedic_options,
        ...item.response.allopathic_options,
      ]) {
        seen.add(option.source_type);
      }
    }
    expect(seen.size).toBeGreaterThan(0);
    for (const sourceType of seen) {
      expect(sourceTypeLabel(sourceType), sourceType).not.toBe(sourceType);
    }
  });
});
