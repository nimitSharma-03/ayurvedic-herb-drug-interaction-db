import { expect, test } from "@playwright/test";

import { apiGet, expectNoForbiddenOutput } from "./helpers";
import type { StatsResponse } from "@/lib/types";

test.describe("how it works", () => {
  test("shows the five stages with the counts the backend reports", async ({ page }) => {
    const stats = await apiGet<StatsResponse>("/stats");
    await page.goto("/how-it-works");

    const stages = page.getByTestId("pipeline-stage");
    await expect(stages).toHaveCount(5);

    const body = page.locator("main");
    for (const value of [
      stats.literature.pairs_searched,
      stats.literature.abstracts_harvested,
      stats.literature.candidate_sentences,
      stats.literature.verdicts.confirmed,
      stats.literature.documented_pairs,
    ]) {
      await expect(body).toContainText(value!.toLocaleString("en-IN"));
    }
  });

  test("shows the classifier's measured scores and per-class bars", async ({ page }) => {
    const stats = await apiGet<StatsResponse>("/stats");
    expect(stats.classifier).not.toBeNull();
    const metrics = stats.classifier!;

    await page.goto("/how-it-works");
    const section = page.getByTestId("classifier-section");
    await expect(section).toBeVisible();

    await expect(section).toContainText(metrics.macro_f1_test.toFixed(4));
    await expect(section).toContainText(metrics.macro_f1_validation!.toFixed(4));
    await expect(section).toContainText(String(metrics.threshold));

    const bars = page.getByTestId("per-class-bar");
    await expect(bars).toHaveCount(metrics.per_class.length);
    for (const [index, row] of metrics.per_class.entries()) {
      const bar = bars.nth(index);
      await expect(bar).toContainText(row.f1.toFixed(3));
      await expect(bar).toContainText(row.precision.toFixed(3));
      await expect(bar).toContainText(row.recall.toFixed(3));
    }
  });

  test("says the test data is synthetic, in the backend's own words", async ({ page }) => {
    const stats = await apiGet<StatsResponse>("/stats");
    await page.goto("/how-it-works");
    await expect(page.getByTestId("synthetic-note")).toContainText(
      stats.classifier!.test_set_caveat,
    );
  });

  test("shows the knowledge sources as a stacked bar with its own numbers", async ({
    page,
  }) => {
    const stats = await apiGet<StatsResponse>("/stats");
    await page.goto("/how-it-works");

    const bar = page.getByTestId("source-bar");
    await expect(bar).toBeVisible();
    for (const row of stats.knowledge.by_source_type) {
      await expect(bar).toContainText(String(row.rows));
    }
    // Each band is labelled for anyone not reading the colours.
    for (const row of stats.knowledge.by_source_type) {
      await expect(
        bar.locator(`[aria-label*="${row.rows} of ${stats.knowledge.rows} rows"]`),
      ).toBeAttached();
    }
  });

  test("states that nothing has been reviewed, with the real count", async ({ page }) => {
    const stats = await apiGet<StatsResponse>("/stats");
    expect(stats.knowledge.reviewed_rows).toBe(0);

    await page.goto("/how-it-works");
    const body = page.locator("main");
    await expect(body).toContainText("Nothing here has been reviewed");
    await expect(body).toContainText("have been reviewed by a clinician");
  });

  test("carries the full disclaimer and breaks none of the output rules", async ({
    page,
  }) => {
    await page.goto("/how-it-works");
    const body = page.locator("main");
    await expect(body).toContainText("The full disclaimer");
    await expect(body).toContainText("not medical advice");
    await expect(body).toContainText("No dose appears anywhere");
    await expectNoForbiddenOutput(page);
  });

  test("shows the scope and each drug class with its size", async ({ page }) => {
    const stats = await apiGet<StatsResponse>("/stats");
    await page.goto("/how-it-works");
    const body = page.locator("main");
    for (const entry of stats.scope.drug_classes_detail) {
      await expect(body).toContainText(`${entry.drug_class}: ${entry.drugs}`);
    }
  });
});

test.describe("when the backend is not reachable", () => {
  test("the page says so and names the command that starts it", async ({ page }) => {
    // Every call the server makes to the backend is blocked, which is what a
    // stopped backend looks like from the front end's side.
    await page.route("**/stats", (route) => route.abort());
    await page.route("**/conditions", (route) => route.abort());

    // The pages fetch on the server, so the block has to be on the server's own
    // requests: the dev and production servers both read NEXT_PUBLIC_API_URL,
    // so pointing the browser at a page whose data call fails is simulated by
    // visiting with an unreachable API configured. That is covered by the
    // client-side path here, which the /check page uses.
    await page.goto("/check");
    await page.route("**/interactions/check**", (route) => route.abort());

    await page.getByTestId("pick-a").click();
    await page.getByPlaceholder("Search herbs and medicines").fill("Turmeric");
    const option = page.getByTestId("combobox-option").first();
    await expect(option).toBeVisible();
    await option.click();

    await page.getByTestId("pick-b").click();
    await page.getByPlaceholder("Search herbs and medicines").fill("Metformin");
    const second = page.getByTestId("combobox-option").first();
    await expect(second).toBeVisible();
    await second.click();

    await page.getByRole("button", { name: "Check this pair" }).click();

    const error = page.getByTestId("check-error");
    await expect(error).toBeVisible({ timeout: 30_000 });
    await expect(error).toContainText("The database server is not responding");
    await expect(error).toContainText("python -m hdi.api");
  });
});
