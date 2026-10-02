import { expect, test, type Page } from "@playwright/test";

import { apiGet, expectNoBrandNames, expectNoForbiddenOutput } from "./helpers";
import type {
  InteractionRecord,
  MedicineDetail,
  MedicineListResponse,
} from "@/lib/types";

async function pick(page: Page, which: "pick-a" | "pick-b", name: string) {
  await page.getByTestId(which).click();
  const input = page.getByPlaceholder("Search herbs and medicines");
  await input.fill(name);
  const option = page.getByTestId("combobox-option").filter({ hasText: name }).first();
  await expect(option).toBeVisible();
  await option.click();
  await expect(page.getByTestId(which)).toContainText(name);
}

async function runCheck(page: Page, a: string, b: string) {
  await pick(page, "pick-a", a);
  await pick(page, "pick-b", b);
  await page.getByRole("button", { name: "Check this pair" }).click();
  await expect(page.getByTestId("check-loading")).toBeHidden({ timeout: 30_000 });
}

test.describe("checking two medicines", () => {
  test("a documented pair is reported as documented, with its evidence", async ({
    page,
  }) => {
    const expected = await apiGet<InteractionRecord>(
      "/interactions/check?medicine_a=Turmeric&medicine_b=Metformin",
    );
    expect(expected.status).toBe("interaction_found");

    await page.goto("/check");
    await runCheck(page, "Turmeric", "Metformin");

    const row = page.getByTestId("interaction-row");
    await expect(row).toBeVisible();
    await expect(row).toHaveAttribute("data-status", "interaction_found");
    await expect(row).toContainText("Documented interaction");
    await expect(row).toContainText(expected.description);

    // The evidence is behind a disclosure, with a PubMed link per PMID.
    await row.getByRole("group").getByText(/Evidence sentences/).click();
    const pmids = [...new Set(expected.evidence.map((entry) => entry.pmid))];
    expect(pmids.length).toBeGreaterThan(0);
    for (const pmid of pmids) {
      await expect(row.getByRole("link", { name: new RegExp(`PMID ${pmid}`) }).first()).toHaveAttribute(
        "href",
        new RegExp(`pubmed\\.ncbi\\.nlm\\.nih\\.gov/${pmid}`),
      );
    }

    await expect(page.getByTestId("disclaimer")).toContainText(
      expected.disclaimer.slice(0, 50),
    );
    await expectNoForbiddenOutput(page);
    await expectNoBrandNames(page);
  });

  test("a swap gives the same answer, and the page says so", async ({ page }) => {
    await page.goto("/check");
    await runCheck(page, "Turmeric", "Metformin");
    const before = await page.getByTestId("interaction-row").innerText();

    await page.getByTestId("swap").click();
    await expect(page.getByTestId("check-loading")).toBeHidden({ timeout: 30_000 });

    await expect(page.getByTestId("same-either-order")).toBeVisible();
    await expect(page.getByTestId("same-either-order")).toContainText(
      "Same answer in either order",
    );

    // The two inputs have changed places.
    await expect(page.getByTestId("pick-a")).toContainText("Metformin");
    await expect(page.getByTestId("pick-b")).toContainText("Turmeric");

    // And the finding itself is unchanged, apart from which name is first.
    const after = await page.getByTestId("interaction-row").innerText();
    const strip = (text: string) => text.replace(/Turmeric|Metformin/g, "·");
    expect(strip(after)).toBe(strip(before));
  });

  test("a pair with nothing documented never reads as safety", async ({ page }) => {
    const expected = await apiGet<InteractionRecord>(
      "/interactions/check?medicine_a=Turmeric&medicine_b=Aspirin",
    );
    expect(expected.status).toBe("no_documented_interaction");

    await page.goto("/check");
    await runCheck(page, "Turmeric", "Aspirin");

    const row = page.getByTestId("interaction-row");
    await expect(row).toHaveAttribute("data-status", "no_documented_interaction");
    await expect(row).toContainText("No documented interaction");
    // The backend's exact wording, not a rephrasing of it.
    await expect(row).toContainText(expected.description);
    await expectNoForbiddenOutput(page);
  });

  test("a herb-and-herb pair is insufficient evidence, with the reason", async ({
    page,
  }) => {
    const expected = await apiGet<InteractionRecord>(
      "/interactions/check?medicine_a=Turmeric&medicine_b=Ashwagandha",
    );
    expect(expected.status).toBe("insufficient_evidence");

    await page.goto("/check");
    await runCheck(page, "Turmeric", "Ashwagandha");

    const row = page.getByTestId("interaction-row");
    await expect(row).toHaveAttribute("data-status", "insufficient_evidence");
    await expect(row).toContainText("Insufficient evidence");
    await expect(page.getByTestId("insufficient-reason")).toContainText(
      expected.evidence_basis!,
    );
    await expectNoForbiddenOutput(page);
  });

  test("the same medicine twice is refused before a request is made", async ({ page }) => {
    await page.goto("/check");
    await pick(page, "pick-a", "Turmeric");
    await pick(page, "pick-b", "Turmeric");
    await expect(page.getByTestId("same-medicine")).toBeVisible();
    await expect(page.getByRole("button", { name: "Check this pair" })).toBeDisabled();
  });

  test("picking a medicine by another of its names lands on the same record", async ({
    page,
  }) => {
    // Haldi is a recorded synonym for Turmeric. Searching it offers Turmeric,
    // and choosing it fills in Turmeric: the alias finds the medicine, and the
    // field then holds the name the database uses for it.
    await page.goto("/check");
    await page.getByTestId("pick-b").click();
    await page.getByPlaceholder("Search herbs and medicines").fill("Haldi");
    const option = page.getByTestId("combobox-option").first();
    await expect(option).toBeVisible();
    await option.click();
    await expect(page.getByTestId("pick-b")).toContainText("Turmeric");

    // So choosing Turmeric on the other side is the same medicine twice, and
    // the form says so without asking the backend.
    await pick(page, "pick-a", "Turmeric");
    await expect(page.getByTestId("same-medicine")).toBeVisible();
    await expect(page.getByRole("button", { name: "Check this pair" })).toBeDisabled();
  });

  test("two different names for one medicine are reported by the backend as that", async ({
    page,
  }) => {
    // Arriving with an alias already in the first field, the two strings differ,
    // so the request goes out and the backend resolves both to one record.
    await page.goto("/check?a=Haldi");
    await expect(page.getByTestId("pick-a")).toContainText("Haldi");
    await pick(page, "pick-b", "Turmeric");

    await page.getByRole("button", { name: "Check this pair" }).click();
    await expect(page.getByTestId("check-loading")).toBeHidden({ timeout: 30_000 });

    const panel = page.getByTestId("same-medicine-resolved");
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("an interaction requires two different medicines");
  });

  test("a name outside the database says so rather than inventing a record", async ({
    page,
  }) => {
    await page.goto("/check");
    await page.getByTestId("pick-a").click();
    const input = page.getByPlaceholder("Search herbs and medicines");
    await input.fill("Paracetamol");
    await expect(
      page.getByText(/Nothing in this database matches that/).first(),
    ).toBeVisible();
    await expect(page.getByTestId("combobox-option")).toHaveCount(0);
  });

  test("a medicine page links straight into the check with that medicine filled in", async ({
    page,
  }) => {
    await page.goto("/medicines/herb-turmeric");
    await page
      .getByRole("link", { name: "Check this against another medicine" })
      .click();
    await expect(page).toHaveURL(/\/check\?a=Turmeric/);
    await expect(page.getByTestId("pick-a")).toContainText("Turmeric");
  });
});

test.describe("browsing medicines", () => {
  test("lists them all and filters by kind and by name", async ({ page }) => {
    const all = await apiGet<MedicineListResponse>("/medicines?limit=100");
    const herbs = await apiGet<MedicineListResponse>(
      "/medicines?category=ayurvedic&limit=100",
    );
    const drugs = await apiGet<MedicineListResponse>(
      "/medicines?category=allopathic&limit=100",
    );

    await page.goto("/medicines");
    await expect(page.getByTestId("medicine-card")).toHaveCount(all.count);

    await page.getByTestId("filter-herb").click();
    await expect(page.getByTestId("medicine-card")).toHaveCount(herbs.count);

    await page.getByTestId("filter-drug").click();
    await expect(page.getByTestId("medicine-card")).toHaveCount(drugs.count);

    await page.getByTestId("filter-all").click();
    const first = all.results[0]!.name;
    await page.getByTestId("browse-filter").fill(first);
    await expect(page.getByTestId("medicine-card").first()).toContainText(first);

    await page.getByTestId("browse-filter").fill("zzzz-not-a-medicine");
    await expect(page.getByTestId("browse-empty")).toBeVisible();
    await expectNoBrandNames(page);
  });

  test("a card opens that medicine's page", async ({ page }) => {
    await page.goto("/medicines");
    await page.getByTestId("medicine-card").first().click();
    await expect(page).toHaveURL(/\/medicines\/.+/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
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

    await page.goto("/medicines");
    await page.getByTestId("medicine-search").fill(alias);

    const result = page.getByTestId("search-result").first();
    await expect(result).toBeVisible();
    await expect(result).toContainText(name);
    await expect(result.getByTestId("matched-on")).toContainText(`matched ${alias}`);

    await result.click();
    await expect(page).toHaveURL(/\/medicines\/.+/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(name);
  });

  test("the search says so plainly when a name is outside the database", async ({
    page,
  }) => {
    await page.goto("/medicines");
    await page.getByTestId("medicine-search").fill("Paracetamol");
    await expect(page.getByTestId("search-empty")).toBeVisible();
    await expect(page.getByTestId("search-result")).toHaveCount(0);
  });

  test("the search box is reachable and usable by keyboard alone", async ({ page }) => {
    await page.goto("/medicines");
    const search = page.getByTestId("medicine-search");
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
});

test.describe("a medicine page", () => {
  test("shows everything the backend holds for it", async ({ page }) => {
    const expected = await apiGet<MedicineDetail>("/medicines/herb-turmeric");
    await page.goto("/medicines/herb-turmeric");

    await expect(page.getByRole("heading", { level: 1 })).toContainText(expected.name);
    await expect(page.locator("body")).toContainText(expected.scientific_name!);

    for (const alias of expected.aliases) {
      await expect(page.locator("body")).toContainText(alias.alias);
    }

    const uses = page.getByTestId("recorded-use");
    await expect(uses).toHaveCount(expected.recorded_uses.length);
    for (const [index, use] of expected.recorded_uses.entries()) {
      const card = uses.nth(index);
      await expect(card).toContainText(use.condition_name);
      await expect(card).toContainText("Not yet expert-reviewed");
      for (const field of [use.uses, use.pros, use.cons, use.cautions]) {
        if (field) await expect(card).toContainText(field);
      }
    }

    // Its documented interactions, from the backend.
    const documented = await apiGet<{ results: { status: string }[] }>(
      "/medicines/herb-turmeric/interactions?limit=200",
    );
    const found = documented.results.filter(
      (record) => record.status === "interaction_found",
    );
    await expect(
      page.locator('[data-testid="interaction-row"][data-status="interaction_found"]'),
    ).toHaveCount(found.length);

    await expect(page.getByTestId("disclaimer")).toBeVisible();
    await expectNoForbiddenOutput(page);
    await expectNoBrandNames(page);
  });

  test("says a field is not recorded rather than leaving it blank", async ({ page }) => {
    await page.goto("/medicines/herb-turmeric");
    await expect(page.getByTestId("not-recorded").first()).toContainText(
      "Not recorded yet",
    );
  });

  test("a medicine with no recorded use says so instead of showing nothing", async ({
    page,
  }) => {
    const expected = await apiGet<MedicineDetail>("/medicines/herb-ashoka");
    expect(expected.recorded_uses).toHaveLength(0);

    await page.goto("/medicines/herb-ashoka");
    await expect(page.getByTestId("recorded-use")).toHaveCount(0);
    await expect(page.getByTestId("empty-section").first()).toBeVisible();
    await expect(page.locator("body")).toContainText("not that it has none");
  });

  test("an unknown medicine is a 404 page, not an error", async ({ page }) => {
    const response = await page.goto("/medicines/herb-not-a-real-one");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "That page is not here",
    );
  });

  test("an unknown path is the same 404 page", async ({ page }) => {
    const response = await page.goto("/nowhere-at-all");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "That page is not here",
    );
  });
});
