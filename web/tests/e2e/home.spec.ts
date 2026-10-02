import { expect, test, type Page } from "@playwright/test";

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

/**
 * The hero visual.
 *
 * It is decorative, so none of this is about what it looks like. What is worth
 * testing is everything around it: that the flat version is on screen before
 * any of it loads, that the 3D takes over when it can, that it costs nothing at
 * all on a machine that cannot draw it, and that a reader who asked for less
 * motion gets a still picture rather than a slower one.
 */
test.describe("the hero visual", () => {
  /** The 3D chunk is far larger than any other chunk this app serves, so its
   *  size alone identifies it in the network log. */
  const THREE_D_BYTES = 500_000;

  function chunkSizes(page: Page): number[] {
    const sizes: number[] = [];
    page.on("response", async (response) => {
      if (!response.url().includes("/_next/static/chunks/")) return;
      try {
        sizes.push((await response.body()).length);
      } catch {
        // Served from cache, or redirected; nothing arrived to measure.
      }
    });
    return sizes;
  }

  test("the flat emblem is in the markup, before any script runs", async ({ page }) => {
    // Every chunk blocked: whatever is on screen was sent by the server.
    await page.route("**/_next/static/chunks/**", (route) => route.abort());
    await page.goto("/");

    const visual = page.getByTestId("hero-visual");
    await expect(visual).toBeVisible();
    await expect(visual).toHaveAttribute("data-hero-status", "flat");
    await expect(visual.getByRole("img")).toBeVisible();
    await page.unroute("**/_next/static/chunks/**");
  });

  test("the 3D scene takes over, and does not swallow the hero's own links", async ({
    page,
  }) => {
    await page.goto("/");
    const visual = page.getByTestId("hero-visual");
    await expect(visual).toHaveAttribute("data-hero-status", "drawn", {
      timeout: 30_000,
    });
    await expect(page.locator("canvas")).toBeVisible();

    // The canvas is laid over the hero's text column. A reader must still be
    // able to use what is underneath it.
    await page.getByRole("link", { name: "Check two medicines" }).first().click();
    await expect(page).toHaveURL(/\/check$/);
  });

  test("keeps orbiting once it has settled", async ({ page }) => {
    await page.goto("/");
    const visual = page.getByTestId("hero-visual");
    await expect(visual).toHaveAttribute("data-hero-status", "drawn", {
      timeout: 30_000,
    });
    // Past the end of the entrance, so what is compared is the idle motion.
    await page.waitForTimeout(3500);

    const canvas = page.locator("canvas");
    const first = await canvas.screenshot();
    await page.waitForTimeout(1200);
    const second = await canvas.screenshot();
    expect(Buffer.compare(first, second)).not.toBe(0);
  });

  test("downloads no 3D at all when WebGL is unavailable", async ({ page }) => {
    await page.addInitScript(() => {
      // Exactly what a blocklisted driver or a locked-down browser looks like.
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function patched(
        this: HTMLCanvasElement,
        ...args: Parameters<typeof original>
      ) {
        if (String(args[0]).startsWith("webgl")) return null;
        return original.apply(this, args);
      } as typeof original;
    });

    const sizes = chunkSizes(page);
    await page.goto("/");

    const visual = page.getByTestId("hero-visual");
    await expect(visual).toHaveAttribute("data-hero-status", "flat");
    await expect(visual.getByRole("img")).toBeVisible();

    // Long enough that a chunk would have arrived if one had been asked for.
    await page.waitForTimeout(2000);
    await expect(page.locator("canvas")).toHaveCount(0);
    expect(
      Math.max(0, ...sizes),
      "three.js was downloaded by a browser that cannot use it",
    ).toBeLessThan(THREE_D_BYTES);
    await expectNoForbiddenOutput(page);
  });

  test.describe("for a reader who asked for less motion", () => {
    test.use({ reducedMotion: "reduce" });

    test("shows the settled scene and then holds completely still", async ({ page }) => {
      await page.goto("/");
      const visual = page.getByTestId("hero-visual");
      await expect(visual).toHaveAttribute("data-hero-status", "drawn", {
        timeout: 30_000,
      });

      const canvas = page.locator("canvas");
      const first = await canvas.screenshot();
      await page.waitForTimeout(1500);
      const second = await canvas.screenshot();
      expect(
        Buffer.compare(first, second),
        "the hero moved under prefers-reduced-motion",
      ).toBe(0);
    });
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
