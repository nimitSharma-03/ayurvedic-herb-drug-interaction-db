import { expect, test } from "@playwright/test";

import {
  apiGet,
  expectNoForbiddenOutput,
  expectNoHorizontalScroll,
  setDarkTheme,
  setLightTheme,
} from "./helpers";
import type { StatsResponse } from "@/lib/types";

test.describe("the home page", () => {
  test("shows the headline, the lead and both buttons", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", {
        name: "Check what your herbs and medicines do together",
        level: 1,
      }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Describe a problem" }).first()).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Check two medicines" }).first(),
    ).toBeVisible();
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

  test("finds a medicine by one of its other names and says which one matched", async ({
    page,
  }) => {
    // Indian Ginseng is a recorded synonym, not the medicine's own name, so a
    // result for it proves the alias path end to end.
    const alias = "Indian Ginseng";
    const expected = await apiGet<{ results: { name: string; matched_on: string }[] }>(
      `/medicines/search?q=${encodeURIComponent(alias)}`,
    );
    expect(expected.results.length).toBeGreaterThan(0);
    const name = expected.results[0]!.name;
    expect(expected.results[0]!.matched_on).toBe("exact_alias");
    expect(name.toLowerCase()).not.toBe(alias.toLowerCase());

    await page.goto("/");
    await page.getByTestId("home-search").fill(alias);

    const result = page.getByTestId("search-result").first();
    await expect(result).toBeVisible();
    await expect(result).toContainText(name);
    await expect(result.getByTestId("matched-on")).toContainText(`matched ${alias}`);

    await result.click();
    await expect(page).toHaveURL(/\/medicines\/.+/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(name);
  });

  test("says so plainly when a name is outside the database", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("home-search").fill("Paracetamol");
    await expect(page.getByTestId("search-empty")).toBeVisible();
    await expect(page.getByTestId("search-result")).toHaveCount(0);
  });

  test("the search box is reachable and usable by keyboard alone", async ({ page }) => {
    await page.goto("/");
    const search = page.getByTestId("home-search");
    await search.focus();
    await search.type("ashwa", { delay: 20 });
    await expect(page.getByTestId("search-result").first()).toBeVisible();

    await search.press("ArrowDown");
    await expect(page.getByTestId("search-result").first()).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await search.press("Enter");
    await expect(page).toHaveURL(/\/medicines\/.+/);
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
