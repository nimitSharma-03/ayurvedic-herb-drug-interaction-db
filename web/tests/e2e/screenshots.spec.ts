import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";

import { ask, setDarkTheme, setLightTheme } from "./helpers";

/**
 * Every page and every state, light and dark, into docs/screenshots/.
 *
 * These are a record of what this front end really shows, taken against the
 * real backend, so every value in them came out of the database. They are not
 * comparison baselines: nothing here asserts against a reference image, which
 * would fail on a font-rendering difference and say nothing about the project.
 */
const OUT = join(process.cwd(), "..", "docs", "screenshots");

test.beforeAll(async () => {
  await mkdir(OUT, { recursive: true });
});

async function shoot(
  page: Page,
  name: string,
  theme: "light" | "dark",
  fullPage = true,
) {
  await page.screenshot({
    path: join(OUT, `${name}-${theme}.png`),
    fullPage,
    animations: "disabled",
  });
}

/**
 * Run one scene in both themes, from a clean page each time.
 *
 * `fullPage` is turned off for the drawer, which is fixed to the viewport: a
 * full-page capture of it shows a panel floating against several screens of
 * page behind it, which is not what a reader sees.
 */
function scene(
  name: string,
  open: (page: Page) => Promise<void>,
  options: { fullPage?: boolean } = {},
) {
  for (const theme of ["light", "dark"] as const) {
    test(`${name} (${theme})`, async ({ page }) => {
      await page.goto("/");
      if (theme === "dark") await setDarkTheme(page);
      else await setLightTheme(page);

      await open(page);
      // Let the reveal and count-up animations settle so the capture shows the
      // finished page rather than a frame of it.
      await page.waitForTimeout(1200);
      await shoot(page, name, theme, options.fullPage ?? true);
    });
  }
}

scene("home", async (page) => {
  await page.goto("/");
  await expect(page.getByTestId("pipeline-card")).toBeVisible();
  // The 3D hero is captured once it has drawn; the wait in `scene` then lets
  // its entrance finish, so the shot is of the settled composition.
  await expect(page.getByTestId("hero-visual")).toHaveAttribute(
    "data-hero-status",
    "drawn",
    { timeout: 30_000 },
  );
  await page.waitForTimeout(2600);
});

scene("medicines-search", async (page) => {
  await page.goto("/medicines");
  await page.getByTestId("medicine-search").fill("Indian Ginseng");
  await expect(page.getByTestId("search-result").first()).toBeVisible();
});

scene("ask-empty", async (page) => {
  await page.goto("/ask");
  await expect(page.getByTestId("problem-text")).toBeVisible();
});

scene("ask-results", async (page) => {
  await ask(page, "my sugar is high", ["Metformin"]);
  await expect(page.getByTestId("results")).toBeVisible();
});

scene(
  "ask-warnings-drawer",
  async (page) => {
    await ask(page, "my sugar is high", ["Metformin"]);
    await page
      .locator('[data-testid="warning-row"][data-level="literature_verified"]')
      .first()
      .click();
    await expect(page.getByTestId("warning-drawer")).toBeVisible();
  },
  { fullPage: false },
);

scene("ask-emergency", async (page) => {
  await ask(page, "I have chest pain");
  await expect(page.getByTestId("emergency")).toBeVisible();
});

scene("ask-out-of-scope", async (page) => {
  await ask(page, "I have a headache");
  await expect(page.getByTestId("out-of-scope")).toBeVisible();
});

scene("ask-cautions", async (page) => {
  await page.goto("/ask");
  await page.getByTestId("problem-text").fill("blood pressure is high");
  await page.getByTestId("caution-pregnant_or_breastfeeding").click();
  await page.getByTestId("caution-kidney_or_liver_disease").click();
  await page.getByRole("button", { name: "Show options" }).click();
  await expect(page.getByTestId("ask-loading")).toBeHidden({ timeout: 40_000 });
  await expect(page.getByTestId("caution-notes")).toBeVisible();
});

async function runCheck(page: Page, a: string, b: string) {
  await page.goto("/check");
  for (const [which, name] of [
    ["pick-a", a],
    ["pick-b", b],
  ] as const) {
    await page.getByTestId(which).click();
    await page.getByPlaceholder("Search herbs and medicines").fill(name);
    const option = page.getByTestId("combobox-option").filter({ hasText: name }).first();
    await expect(option).toBeVisible();
    await option.click();
  }
  await page.getByRole("button", { name: "Check this pair" }).click();
  await expect(page.getByTestId("check-loading")).toBeHidden({ timeout: 30_000 });
}

scene("check-empty", async (page) => {
  await page.goto("/check");
  await expect(page.getByTestId("pick-a")).toBeVisible();
});

scene("check-documented", async (page) => {
  await runCheck(page, "Turmeric", "Metformin");
  await expect(page.getByTestId("interaction-row")).toHaveAttribute(
    "data-status",
    "interaction_found",
  );
});

scene("check-no-documented", async (page) => {
  await runCheck(page, "Turmeric", "Aspirin");
  await expect(page.getByTestId("interaction-row")).toHaveAttribute(
    "data-status",
    "no_documented_interaction",
  );
});

scene("check-insufficient", async (page) => {
  await runCheck(page, "Turmeric", "Ashwagandha");
  await expect(page.getByTestId("insufficient-reason")).toBeVisible();
});

scene("check-swapped", async (page) => {
  await runCheck(page, "Turmeric", "Metformin");
  await page.getByTestId("swap").click();
  await expect(page.getByTestId("same-either-order")).toBeVisible();
});

scene("check-same-medicine", async (page) => {
  await page.goto("/check");
  for (const which of ["pick-a", "pick-b"] as const) {
    await page.getByTestId(which).click();
    await page.getByPlaceholder("Search herbs and medicines").fill("Turmeric");
    const option = page.getByTestId("combobox-option").first();
    await expect(option).toBeVisible();
    await option.click();
  }
  await expect(page.getByTestId("same-medicine")).toBeVisible();
});

scene("check-not-found", async (page) => {
  await page.goto("/check");
  await page.getByTestId("pick-a").click();
  await page.getByPlaceholder("Search herbs and medicines").fill("Paracetamol");
  await expect(page.getByText(/Nothing in this database matches that/).first()).toBeVisible();
});

scene("medicines", async (page) => {
  await page.goto("/medicines");
  await expect(page.getByTestId("medicine-card").first()).toBeVisible();
});

scene("medicines-filtered", async (page) => {
  await page.goto("/medicines");
  await page.getByTestId("filter-drug").click();
  await expect(page.getByTestId("medicine-card").first()).toBeVisible();
});

scene("medicine-herb", async (page) => {
  await page.goto("/medicines/herb-turmeric");
  await expect(page.getByTestId("recorded-use").first()).toBeVisible();
});

scene("medicine-drug", async (page) => {
  await page.goto("/medicines/drug-warfarin");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

scene("medicine-no-uses", async (page) => {
  await page.goto("/medicines/herb-ashoka");
  await expect(page.getByTestId("empty-section").first()).toBeVisible();
});

scene("how-it-works", async (page) => {
  await page.goto("/how-it-works");
  await expect(page.getByTestId("classifier-section")).toBeVisible();
});

scene("not-found", async (page) => {
  await page.goto("/nowhere-at-all");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "That page is not here",
  );
});

scene("api-unreachable", async (page) => {
  await page.goto("/check");
  await page.route("**/interactions/check**", (route) => route.abort());
  for (const [which, name] of [
    ["pick-a", "Turmeric"],
    ["pick-b", "Metformin"],
  ] as const) {
    await page.getByTestId(which).click();
    await page.getByPlaceholder("Search herbs and medicines").fill(name);
    const option = page.getByTestId("combobox-option").filter({ hasText: name }).first();
    await expect(option).toBeVisible();
    await option.click();
  }
  await page.getByRole("button", { name: "Check this pair" }).click();
  await expect(page.getByTestId("check-error")).toBeVisible({ timeout: 30_000 });
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 360, height: 760 } });

  for (const theme of ["light", "dark"] as const) {
    test(`home and results at 360px (${theme})`, async ({ page }) => {
      await page.goto("/");
      if (theme === "dark") await setDarkTheme(page);
      await page.waitForTimeout(900);
      await shoot(page, "mobile-home", theme);

      await ask(page, "my sugar is high", ["Metformin"]);
      await expect(page.getByTestId("results")).toBeVisible();
      await page.waitForTimeout(900);
      await shoot(page, "mobile-ask-results", theme);
    });
  }
});
