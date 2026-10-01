import { cache } from "react";

import { api, asApiError, type ApiError } from "./api";
import type { ConditionsResponse, StatsResponse } from "./types";

/**
 * Server-side loaders for the data several places on a page need.
 *
 * Wrapped in React's `cache` so one render calls the backend once even when the
 * layout's footer and the page body both want the same thing. The cache lives
 * for a single request, so the numbers are still read fresh on every page view
 * -- which matters, since re-seeding the database changes them.
 *
 * Each loader resolves to a result object rather than throwing. A page that
 * cannot reach the backend has to render the "start the backend" state, and a
 * footer that cannot reach it has to render without its scope line, and neither
 * of those is an exception worth unwinding a render for.
 */

export type Loaded<T> = { ok: true; data: T } | { ok: false; error: ApiError };

async function load<T>(fetcher: () => Promise<T>): Promise<Loaded<T>> {
  try {
    return { ok: true, data: await fetcher() };
  } catch (error) {
    return { ok: false, error: asApiError(error) };
  }
}

export const loadStats = cache(
  (): Promise<Loaded<StatsResponse>> => load(() => api.stats()),
);

export const loadConditions = cache(
  (): Promise<Loaded<ConditionsResponse>> => load(() => api.conditions()),
);
