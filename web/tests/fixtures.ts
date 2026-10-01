/**
 * Loading the captured responses.
 *
 * Every file in tests/fixtures/ is a real response from a running backend,
 * saved by the capture that built them, with its request, its HTTP status and
 * its body. Nothing in them was written by hand, which is why they can be used
 * both as test input and as the check that this app's types match reality.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import type { RecommendResponse, StatsResponse } from "@/lib/types";

export const FIXTURE_DIR = join(process.cwd(), "tests", "fixtures");

export interface Fixture<T = unknown> {
  name: string;
  request: { method: string; path: string; body: unknown };
  status: number;
  response: T;
}

export function fixtureNames(): string[] {
  return readdirSync(FIXTURE_DIR)
    .filter((file) => file.endsWith(".json") && file !== "index.json")
    .map((file) => file.replace(/\.json$/, ""))
    .sort();
}

export function fixture<T = unknown>(name: string): Fixture<T> {
  const raw = readFileSync(join(FIXTURE_DIR, `${name}.json`), "utf-8");
  return { name, ...(JSON.parse(raw) as Omit<Fixture<T>, "name">) };
}

export function allFixtures(): Fixture[] {
  return fixtureNames().map((name) => fixture(name));
}

export function recommendFixtures(): Fixture<RecommendResponse>[] {
  return fixtureNames()
    .filter((name) => name.startsWith("recommend-"))
    .map((name) => fixture<RecommendResponse>(name))
    .filter((item) => item.status === 200);
}

export function statsFixture(): StatsResponse {
  return fixture<StatsResponse>("stats").response;
}

/**
 * Every string anywhere in a fixture, so a scan can read what the backend
 * actually sends rather than a sample of it.
 */
export function stringsIn(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) stringsIn(item, out);
  } else if (value !== null && typeof value === "object") {
    for (const item of Object.values(value)) stringsIn(item, out);
  }
  return out;
}
