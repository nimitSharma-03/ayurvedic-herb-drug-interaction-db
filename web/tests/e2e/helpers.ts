import { expect, type Page } from "@playwright/test";

/** Where the backend is, for tests that need to compare against it directly. */
export const API_URL = (
  process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000"
).replace(/\/+$/, "");

export async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`${path} answered ${response.status}`);
  return (await response.json()) as T;
}

/**
 * Switch to the dark theme and wait for it to take.
 *
 * Returns after the attribute is on <html>, so a screenshot taken next is of
 * the dark page rather than of the light one mid-transition.
 */
export async function setDarkTheme(page: Page) {
  const toggle = page.getByTestId("theme-toggle");
  if ((await toggle.getAttribute("data-theme-state")) !== "dark") {
    await toggle.click();
  }
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
}

export async function setLightTheme(page: Page) {
  const toggle = page.getByTestId("theme-toggle");
  if ((await toggle.getAttribute("data-theme-state")) === "dark") {
    await toggle.click();
  }
  await expect(toggle).toHaveAttribute("data-theme-state", "light");
}

/**
 * Fill the problem box and submit, then wait for an answer or an error.
 *
 * `path` is where the form is being driven from: the same form is on the home
 * page and on /ask, and both have to answer.
 */
export async function ask(
  page: Page,
  text: string,
  currentMedicines: string[] = [],
  path = "/ask",
) {
  await page.goto(path);
  await page.getByTestId("problem-text").fill(text);

  for (const medicine of currentMedicines) {
    const field = page.getByTestId("current-medicines");
    await field.fill(medicine);
    await field.press("Enter");
    await expect(page.getByTestId("medicine-token").filter({ hasText: medicine })).toBeVisible();
  }

  await page.getByRole("button", { name: "Show options" }).click();
  await expect(page.getByTestId("ask-loading")).toBeHidden({ timeout: 40_000 });
}

/** Assert nothing overflows the viewport sideways. */
export async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth };
  });
  // One pixel of slack for sub-pixel layout rounding.
  expect(
    overflow.scrollWidth,
    `page scrolls sideways: ${overflow.scrollWidth} > ${overflow.clientWidth}`,
  ).toBeLessThanOrEqual(overflow.clientWidth + 1);
}

/**
 * The forbidden-output scan, run over what a real browser rendered.
 *
 * Same rules and the same calibration as src/lib/forbidden.ts and as the
 * backend's own checks. Duplicated here rather than imported because this file
 * runs in Playwright's Node context, not through the app's bundler.
 */
const OUTRIGHT: { rule: string; pattern: RegExp }[] = [
  {
    rule: "looks like a dose",
    pattern:
      /\b\d+\s*(?:mg|mcg|ug|gm|grams?|ml|cc|iu|units?|tablets?|capsules?|tsp|tbsp)\b/gi,
  },
  {
    rule: "looks like a dosing frequency",
    pattern: /\b(?:twice|thrice|once)\s+(?:a|per)\s+day\b/gi,
  },
  { rule: "uses the forbidden phrase 'safe to take'", pattern: /safe to take/gi },
  {
    rule: "claims safety",
    pattern: /\b(?:perfectly|completely|totally|entirely|generally) safe\b/gi,
  },
  { rule: "claims safety", pattern: /\bharmless\b/gi },
  { rule: "claims safety", pattern: /\brisk[- ]free\b/gi },
];

const SAFETY_CLAIM =
  /\b(?:is|are|was|were|be|been|seems?|appears?|remains?|stays?)\s+(?:\w+\s+){0,2}safer?\b|\bsafer?\s+(?:to|for|with|in|alongside)\b/i;
const NEGATION =
  /\b(?:not|never|no|none|nothing|nor|cannot|can't|does ?n[o']t|do ?n[o']t|is ?n[o']t|was ?n[o']t|absence|without|un\w+)\b/i;

export function forbiddenInText(text: string): string[] {
  const normalized = text.replace(/ /g, " ").replace(/\s+/g, " ");
  const problems: string[] = [];

  for (const { rule, pattern } of OUTRIGHT) {
    for (const match of normalized.matchAll(pattern)) {
      problems.push(`${rule}: ${match[0]}`);
    }
  }
  for (const sentence of normalized.split(/(?<=[.!?;])\s+/)) {
    const claim = SAFETY_CLAIM.exec(sentence);
    if (claim && !NEGATION.test(sentence)) {
      problems.push(`claims safety without negating it: ${sentence.trim()}`);
    }
  }
  return problems;
}

/** Assert the page a browser just rendered breaks none of the honesty rules. */
export async function expectNoForbiddenOutput(page: Page) {
  const text = (await page.locator("body").innerText()) ?? "";
  expect(forbiddenInText(text).join("\n")).toBe("");
}

/** Brand names, read from the repository, so this list is never written here. */
export async function brandNames(): Promise<string[]> {
  const { readFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const csv = await readFile(
    join(process.cwd(), "..", "data", "reference", "medicine_aliases.csv"),
    "utf-8",
  );
  const [header, ...rows] = csv.trim().split(/\r?\n/);
  const columns = header!.split(",");
  const aliasIndex = columns.indexOf("alias");
  const typeIndex = columns.indexOf("alias_type");
  return rows
    .map((row) => row.split(","))
    .filter((cells) => cells[typeIndex] === "brand_name")
    .map((cells) => cells[aliasIndex]!.trim())
    .filter(Boolean);
}

export async function expectNoBrandNames(page: Page, typed: string[] = []) {
  const text = (await page.locator("body").innerText()) ?? "";
  const lowerTyped = typed.map((value) => value.toLowerCase());
  const found: string[] = [];
  for (const brand of await brandNames()) {
    if (lowerTyped.includes(brand.toLowerCase())) continue;
    if (new RegExp(`\\b${brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text)) {
      found.push(brand);
    }
  }
  expect(found.join(", ")).toBe("");
}
