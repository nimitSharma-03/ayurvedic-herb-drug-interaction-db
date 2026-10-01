import { expect, test } from "@playwright/test";

import {
  apiGet,
  ask,
  expectNoBrandNames,
  expectNoForbiddenOutput,
} from "./helpers";
import type { ConditionsResponse, RecommendResponse } from "@/lib/types";

async function recommend(body: unknown): Promise<RecommendResponse> {
  const response = await fetch(
    `${(process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000").replace(/\/+$/, "")}/recommend`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    },
  );
  return (await response.json()) as RecommendResponse;
}

test.describe("describing a problem", () => {
  test("the text box counts characters and stops at the limit", async ({ page }) => {
    await page.goto("/ask");
    const box = page.getByTestId("problem-text");
    await box.fill("a".repeat(600));
    await expect(box).toHaveValue("a".repeat(500));
    await expect(page.locator("text=500 of 500 characters")).toBeVisible();
  });

  test("the token field suggests medicines and takes a name it does not know", async ({
    page,
  }) => {
    await page.goto("/ask");
    const field = page.getByTestId("current-medicines");

    await field.fill("ashwa");
    const suggestion = page.getByTestId("token-suggestion").first();
    await expect(suggestion).toBeVisible();
    const suggested = (await suggestion.innerText()).split("\n")[0]!.trim();
    await suggestion.click();
    await expect(
      page.getByTestId("medicine-token").filter({ hasText: suggested }),
    ).toBeVisible();

    // A lay group name is not a medicine, and the backend still understands it,
    // so the field must not refuse it.
    await field.fill("blood thinner");
    await field.press("Enter");
    await expect(
      page.getByTestId("medicine-token").filter({ hasText: "blood thinner" }),
    ).toBeVisible();
  });

  test("high blood sugar with a current medicine gives options and warnings", async ({
    page,
  }) => {
    const text = "my sugar is high";
    const taken = "Metformin";
    const expected = await recommend({ text, current_medicines: [taken] });
    expect(expected.status).toBe("results");

    await ask(page, text, [taken]);

    await expect(page.getByTestId("results")).toBeVisible();

    // The conditions it read, each with its confidence.
    const detected = page.getByTestId("detected-conditions");
    for (const condition of expected.detected_conditions) {
      await expect(detected).toContainText(condition.name);
    }
    await expect(page.getByTestId("classifier-note")).toBeVisible();

    // Both columns, with every option the backend offered.
    const herbCards = page.getByTestId("options-herb").getByTestId("option-card");
    const drugCards = page.getByTestId("options-drug").getByTestId("option-card");
    await expect(herbCards).toHaveCount(expected.ayurvedic_options.length);
    await expect(drugCards).toHaveCount(expected.allopathic_options.length);

    // Every card says it has not been reviewed.
    const total = expected.ayurvedic_options.length + expected.allopathic_options.length;
    await expect(page.getByTestId("option-card")).toHaveCount(total);
    for (let index = 0; index < total; index += 1) {
      await expect(page.getByTestId("option-card").nth(index)).toContainText(
        "Not yet expert-reviewed",
      );
    }

    // The medicine the reader already takes is marked, not offered.
    const takenCard = page.locator(`[data-testid="option-card"][data-already-taken="true"]`);
    await expect(takenCard).toHaveCount(1);
    await expect(takenCard).toContainText(taken);
    await expect(takenCard.getByTestId("you-take-this")).toBeVisible();

    await expect(page.getByTestId("disclaimer").first()).toContainText(
      expected.disclaimer.slice(0, 60),
    );
    await expectNoForbiddenOutput(page);
    await expectNoBrandNames(page, [taken]);
  });

  test("the combinations panel shows a red row and an amber row, grouped", async ({
    page,
  }) => {
    const text = "my sugar is high";
    const taken = "Metformin";
    const expected = await recommend({ text, current_medicines: [taken] });
    const levels = new Set(expected.combination_warnings.map((w) => w.level));
    expect(levels.has("literature_verified")).toBe(true);
    expect(levels.has("mechanism_based")).toBe(true);

    await ask(page, text, [taken]);

    const panel = page.getByTestId("warning-graph");
    await expect(panel).toBeVisible();

    // Each of the reader's medicines is a hub.
    const hub = page.getByTestId("warning-hub-node").filter({ hasText: taken });
    await expect(hub).toBeVisible();

    const verified = page.locator('[data-testid="warning-row"][data-level="literature_verified"]');
    const mechanism = page.locator('[data-testid="warning-row"][data-level="mechanism_based"]');
    await expect(verified.first()).toBeVisible();
    await expect(mechanism.first()).toBeVisible();

    // Grouped: fewer rows than warnings, and one row lists several medicines.
    const rows = await page.getByTestId("warning-row").count();
    expect(rows).toBeGreaterThan(0);
    expect(rows).toBeLessThan(expected.combination_warnings.length);
    const spokesInFirstMechanismRow = await mechanism
      .first()
      .getByTestId("warning-spoke")
      .count();
    expect(spokesInFirstMechanismRow).toBeGreaterThan(1);

    // Every medicine named in any warning is somewhere in the panel.
    const panelText = await panel.innerText();
    for (const warning of expected.combination_warnings) {
      expect(panelText).toContain(warning.medicine_a);
      expect(panelText).toContain(warning.medicine_b);
    }
    // And the API's own summary note, verbatim.
    await expect(page.getByTestId("combination-summary")).toContainText(
      expected.combination_summary!.note.slice(0, 60),
    );

    // The lines are drawn as SVG strokes.
    await expect(panel.locator("svg path").first()).toBeAttached();
  });

  test("clicking a literature-verified row opens the drawer with its citations", async ({
    page,
  }) => {
    await ask(page, "my sugar is high", ["Metformin"]);

    const verified = page
      .locator('[data-testid="warning-row"][data-level="literature_verified"]')
      .first();
    await verified.click();

    const drawer = page.getByTestId("warning-drawer");
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText("Literature-verified");
    await expect(drawer).toContainText("Reason");
    await expect(drawer).toContainText("Severity");
    await expect(drawer).toContainText("Evidence");

    // A citation, with a PubMed link and the evidence sentence.
    const citation = drawer.getByTestId("drawer-citation").first();
    await expect(citation).toBeVisible();
    const link = citation.getByRole("link").first();
    await expect(link).toHaveAttribute("href", /pubmed\.ncbi\.nlm\.nih\.gov\/\d+/);

    // The two fields this project has no source for say so.
    await expect(drawer).toContainText("Mechanism");
    await expect(drawer).toContainText("Not recorded yet");

    await drawer.getByRole("button", { name: "Close" }).click();
    await expect(drawer).toBeHidden();
  });

  test("a mechanism-based row's drawer says it has no citation, rather than showing none", async ({
    page,
  }) => {
    await ask(page, "my sugar is high", ["Metformin"]);
    await page
      .locator('[data-testid="warning-row"][data-level="mechanism_based"]')
      .first()
      .click();

    const drawer = page.getByTestId("warning-drawer");
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText("not literature-verified");
    await expect(drawer.getByTestId("drawer-citation")).toHaveCount(0);
    await expect(drawer).toContainText("inventing a source");
  });

  test("the drawer closes with Escape and returns focus to the page", async ({ page }) => {
    await ask(page, "my sugar is high", ["Metformin"]);
    await page.getByTestId("warning-row").first().click();
    await expect(page.getByTestId("warning-drawer")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("warning-drawer")).toBeHidden();
  });

  test("chest pain is an emergency with no options at all", async ({ page }) => {
    const text = "I have chest pain";
    const expected = await recommend({ text });
    expect(expected.status).toBe("emergency");

    await ask(page, text);

    const panel = page.getByTestId("emergency");
    await expect(panel).toBeVisible();
    await expect(panel).toContainText(expected.message!);

    for (const flag of expected.red_flags ?? []) {
      await expect(panel).toContainText(flag.label);
      await expect(panel).toContainText(flag.message);
    }
    for (const action of expected.actions ?? []) {
      await expect(panel).toContainText(action);
    }

    const call = page.getByTestId("call-112");
    await expect(call).toBeVisible();
    await expect(call).toHaveAttribute("href", "tel:112");

    // No options, and no combinations panel either.
    await expect(page.getByTestId("option-card")).toHaveCount(0);
    await expect(page.getByTestId("warning-graph")).toHaveCount(0);
    await expect(page.getByTestId("results")).toHaveCount(0);
    await expectNoForbiddenOutput(page);
  });

  test("a headache is out of scope, and a condition chip re-runs the search", async ({
    page,
  }) => {
    const text = "I have a headache";
    const expected = await recommend({ text });
    expect(expected.status).toBe("out_of_scope");

    await ask(page, text);

    const panel = page.getByTestId("out-of-scope");
    await expect(panel).toBeVisible();
    await expect(panel).toContainText(expected.note!);
    await expect(page.getByTestId("option-card")).toHaveCount(0);

    const conditions = await apiGet<ConditionsResponse>("/conditions");
    const chips = page.getByTestId("condition-chip");
    await expect(chips).toHaveCount(conditions.results.length);

    const first = conditions.results[0]!;
    await page
      .locator(`[data-testid="condition-chip"][data-condition-id="${first.condition_id}"]`)
      .click();

    await expect(page.getByTestId("ask-loading")).toBeHidden({ timeout: 40_000 });
    await expect(page.getByTestId("results")).toBeVisible();
    await expect(page.getByTestId("detected-conditions")).toContainText(first.name);
    await expect(page.getByTestId("option-card").first()).toBeVisible();
    // A condition the reader chose is not a classifier guess, so that note goes.
    await expect(page.getByTestId("classifier-note")).toHaveCount(0);
    await expectNoForbiddenOutput(page);
  });

  test("something unmatchable is reported as low confidence, with the same chips", async ({
    page,
  }) => {
    const text = "i am unwell";
    const expected = await recommend({ text });
    test.skip(
      expected.status !== "low_confidence",
      `the backend read "${text}" as ${expected.status}, so there is nothing to show here`,
    );

    await ask(page, text);
    const panel = page.getByTestId("low-confidence");
    await expect(panel).toBeVisible();
    await expect(panel).toContainText(expected.note!);
    await expect(page.getByTestId("condition-chip").first()).toBeVisible();
    await expect(page.getByTestId("option-card")).toHaveCount(0);
  });

  test("the caution checkboxes add the backend's notes and remove nothing", async ({
    page,
  }) => {
    const text = "blood pressure is high";
    const withCautions = await recommend({
      text,
      cautions: { pregnant_or_breastfeeding: true, kidney_or_liver_disease: true },
    });
    const without = await recommend({ text });
    expect(withCautions.caution_notes.length).toBeGreaterThan(
      without.caution_notes.length,
    );
    // The point of the flags: notes, never a shorter list.
    expect(withCautions.ayurvedic_options.length).toBe(without.ayurvedic_options.length);

    await page.goto("/ask");
    await page.getByTestId("problem-text").fill(text);
    await page.getByTestId("caution-pregnant_or_breastfeeding").click();
    await page.getByTestId("caution-kidney_or_liver_disease").click();
    await page.getByRole("button", { name: "Show options" }).click();
    await expect(page.getByTestId("ask-loading")).toBeHidden({ timeout: 40_000 });

    const notes = page.getByTestId("caution-notes");
    await expect(notes).toBeVisible();
    for (const note of withCautions.caution_notes) {
      await expect(notes).toContainText(note);
    }
    await expect(page.getByTestId("option-card")).toHaveCount(
      withCautions.ayurvedic_options.length + withCautions.allopathic_options.length,
    );
  });

  test("it says what it made of each medicine the reader named", async ({ page }) => {
    const text = "blood pressure is high";
    const named = ["Haldi", "blood thinner", "Paracetamol"];
    const expected = await recommend({ text, current_medicines: named });

    await ask(page, text, named);

    const readback = page.getByTestId("current-readback");
    await expect(readback).toBeVisible();
    for (const resolved of expected.current_medicines?.resolved ?? []) {
      await expect(readback).toContainText(resolved.name);
    }
    for (const klass of expected.current_medicines?.drug_classes ?? []) {
      await expect(readback).toContainText(klass.drug_class);
    }
    for (const unresolved of expected.current_medicines?.unresolved ?? []) {
      await expect(readback).toContainText(unresolved);
    }
  });

  test("an option card links to that medicine's own page", async ({ page }) => {
    await ask(page, "my sugar is high");
    const card = page
      .locator(`[data-testid="option-card"][data-already-taken="false"]`)
      .first();
    const id = await card.getAttribute("data-medicine-id");
    expect(id).toBeTruthy();
    await card.getByTestId("option-link").click();
    await expect(page).toHaveURL(new RegExp(`/medicines/${id}$`));
  });
});
