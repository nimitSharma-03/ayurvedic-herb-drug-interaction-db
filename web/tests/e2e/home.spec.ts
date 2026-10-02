import { expect, test } from "@playwright/test";

import {
  apiGet,
  ask,
  expectNoForbiddenOutput,
  expectNoHorizontalScroll,
  setDarkTheme,
  setLightTheme,
} from "./helpers";
import type { StatsResponse } from "@/lib/types";

test.describe("the home page", () => {
  test("shows the headline, the problem form and the link to the pair check", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", {
        name: "Check what your herbs and medicines do together",
        level: 1,
      }),
    ).toBeVisible();
    // The form itself, not a link to it: a reader types here without a page in
    // between.
    await expect(page.getByTestId("problem-text")).toBeVisible();
    await expect(page.getByRole("button", { name: "Show options" })).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Check two medicines" }).first(),
    ).toBeVisible();
    await expectNoForbiddenOutput(page);
  });

  test("answers a problem described on the home page itself", async ({ page }) => {
    await ask(page, "my sugar is high", [], "/");
    await expect(page.getByTestId("results")).toBeVisible();
    await expectNoForbiddenOutput(page);
  });

  test("shows the pipeline counts the backend reports, not written-in ones", async ({
    page,
  }) => {
    const stats = await apiGet<StatsResponse>("/stats");
    await page.goto("/");

    const card = page.getByTestId("pipeline-card");
    await expect(card).toBeVisible();

    // The count-up ends on the real value, so waiting for it settles the test
    // and checks the animation does not leave a wrong number on screen.
    for (const value of [
      stats.literature.pairs_searched,
      stats.literature.abstracts_harvested,
      stats.literature.candidate_sentences,
      stats.literature.documented_pairs,
    ]) {
      expect(value).not.toBeNull();
      await expect(card).toContainText(value!.toLocaleString("en-IN"), {
        timeout: 10_000,
      });
    }
  });

  test("shows the scope from the backend", async ({ page }) => {
    const stats = await apiGet<StatsResponse>("/stats");
    await page.goto("/");
    const strip = page.getByTestId("scope-strip");
    await expect(strip).toContainText(String(stats.scope.herbs));
    await expect(strip).toContainText(String(stats.scope.drugs));
    await expect(strip).toContainText(String(stats.scope.conditions));
  });

  test("the footer carries the disclaimer, the scope and the how-it-works link", async ({
    page,
  }) => {
    const stats = await apiGet<StatsResponse>("/stats");
    await page.goto("/");
    const footer = page.locator("footer");
    await expect(footer).toContainText("Not medical advice");
    await expect(footer).toContainText(String(stats.scope.herbs));
    await expect(footer.getByRole("link", { name: "How it works" })).toBeVisible();
  });
});

test.describe("the theme", () => {
  test("switches, is remembered, and does not flash on the next page", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", "dark");

    await setDarkTheme(page);
    const darkBackground = await page.evaluate(
      () => getComputedStyle(document.body).backgroundColor,
    );

    // Remembered across a navigation, and applied before the first paint: the
    // attribute is already on <html> when the new document's HTML is parsed.
    await page.goto("/medicines");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    expect(
      await page.evaluate(() => getComputedStyle(document.body).backgroundColor),
    ).toBe(darkBackground);

    await setLightTheme(page);
    const lightBackground = await page.evaluate(
      () => getComputedStyle(document.body).backgroundColor,
    );
    expect(lightBackground).not.toBe(darkBackground);

    await page.reload();
    await expect(page.getByTestId("theme-toggle")).toHaveAttribute(
      "data-theme-state",
      "light",
    );
  });

  test("the inline script sets the theme before anything renders", async ({ page }) => {
    await page.goto("/");
    await setDarkTheme(page);

    // Block the page's own scripts: whatever theme survives was applied by the
    // blocking inline script in <head>, which is the thing that prevents a
    // flash of the light page.
    await page.route("**/_next/static/chunks/**", (route) => route.abort());
    await page.goto("/how-it-works");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.unroute("**/_next/static/chunks/**");
  });
});

test.describe("narrow screens", () => {
  test.use({ viewport: { width: 360, height: 760 } });

  const paths = ["/", "/ask", "/check", "/medicines", "/how-it-works", "/medicines/herb-turmeric"];

  for (const path of paths) {
    test(`${path} renders at 360px with no sideways scroll`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expectNoHorizontalScroll(page);
    });
  }
});
