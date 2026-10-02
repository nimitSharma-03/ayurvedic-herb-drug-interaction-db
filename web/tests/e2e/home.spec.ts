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
        name: "Describe a problem. See what the literature records.",
        level: 1,
      }),
    ).toBeVisible();
    // The form itself, not a link to it: a reader types here without a page in
    // between.
    await expect(page.getByTestId("problem-text")).toBeVisible();
    await expect(page.getByRole("button", { name: "Show options" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Check a pair" }).first()).toBeVisible();
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

/**
 * The hero's isometric tiles.
 *
 * Decorative, so none of this is about what they look like. What is worth
 * testing is that they are kept out of the accessibility tree, that they never
 * sit between the reader and the hero's own buttons, and that nothing in the
 * hero is drawn by anything heavier than the markup the server already sent.
 */
test.describe("the hero's isometric tiles", () => {
  test("are hidden from assistive technology and do not swallow the CTAs", async ({
    page,
  }) => {
    await page.goto("/");

    const field = page.getByTestId("hero-iso-field");
    await expect(field).toHaveAttribute("aria-hidden", "true");
    // Pure markup: nothing here needs a canvas or a WebGL context.
    await expect(page.locator("canvas")).toHaveCount(0);

    await page
      .getByTestId("hero")
      .getByRole("link", { name: "Check a pair" })
      .click();
    await expect(page).toHaveURL(/\/check$/);
  });

  test("still compose the hero with every script blocked", async ({ page }) => {
    // Whatever is on screen was sent by the server, tiles included.
    await page.route("**/_next/static/chunks/**", (route) => route.abort());
    await page.goto("/");

    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByTestId("hero-iso-field").locator("svg").first()).toBeVisible();
    await page.unroute("**/_next/static/chunks/**");
  });

  test.describe("for a reader who asked for less motion", () => {
    test.use({ reducedMotion: "reduce" });

    test("hold completely still", async ({ page }) => {
      await page.goto("/");
      const field = page.getByTestId("hero-iso-field");
      await expect(field).toBeVisible();

      const first = await field.screenshot();
      await page.waitForTimeout(1500);
      const second = await field.screenshot();
      expect(
        Buffer.compare(first, second),
        "a hero tile moved under prefers-reduced-motion",
      ).toBe(0);
    });
  });
});

/**
 * The hero is one screen.
 *
 * The headline and both calls to action have to be on screen before the reader
 * scrolls, at the laptop sizes this is actually read on. Checked by asking the
 * browser where each element is, rather than by measuring the hero box, so a
 * change to the header height or to the type scale that pushes a button under
 * the fold fails here.
 */
test.describe("the hero fits one screen", () => {
  const laptops = [
    { width: 1366, height: 768 },
    { width: 1440, height: 900 },
    { width: 1536, height: 864 },
  ];

  for (const viewport of laptops) {
    test(`at ${viewport.width}x${viewport.height}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto("/");

      const hero = page.getByTestId("hero");
      const targets = [
        hero.getByRole("heading", { level: 1 }),
        hero.getByRole("link", { name: "Describe a problem" }),
        hero.getByRole("link", { name: "Check a pair" }),
      ];

      expect(await page.evaluate(() => window.scrollY)).toBe(0);
      for (const target of targets) {
        const box = await target.boundingBox();
        expect(box, "the element is not laid out at all").not.toBeNull();
        expect(
          box!.y + box!.height,
          `${viewport.width}x${viewport.height}: the hero does not fit one screen`,
        ).toBeLessThanOrEqual(viewport.height);
      }
    });
  }
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
