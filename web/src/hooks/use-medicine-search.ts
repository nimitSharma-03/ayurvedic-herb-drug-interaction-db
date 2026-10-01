"use client";

import * as React from "react";

import { api, asApiError, type ApiError } from "@/lib/api";
import type { SearchResult } from "@/lib/types";

/**
 * Debounced medicine search against the backend.
 *
 * Ranking and alias resolution both belong to the backend: it searches names,
 * botanical names, generic names, ingredients and declared aliases, orders the
 * hits by match quality and says on each one which name matched. So nothing is
 * filtered or re-sorted here, and the list is handed on in the order it
 * arrived.
 *
 * The state holds the query its results belong to, and `loading` is derived
 * from that query differing from the one being typed. That way results for
 * "ash" are never shown under "ashwagandha" while the newer request is still
 * out, and the hook needs no loading flag to keep in step with the request.
 * Each keystroke also aborts the request before it.
 */
export const SEARCH_DEBOUNCE_MS = 180;

export interface MedicineSearchState {
  query: string;
  results: SearchResult[];
  loading: boolean;
  error: ApiError | null;
  /** True once a search for exactly this query has come back with nothing. */
  empty: boolean;
}

interface Settled {
  query: string;
  results: SearchResult[];
  error: ApiError | null;
}

const NOTHING_YET: Settled = { query: "\u0000", results: [], error: null };

export function useMedicineSearch(
  query: string,
  options: { category?: string; limit?: number; minLength?: number } = {},
): MedicineSearchState {
  const { category, limit = 8, minLength = 2 } = options;
  const [settled, setSettled] = React.useState<Settled>(NOTHING_YET);

  const trimmed = query.trim();
  const searchable = trimmed.length >= minLength;

  React.useEffect(() => {
    if (!searchable) return;

    const controller = new AbortController();
    const timer = setTimeout(() => {
      api
        .search({ q: trimmed, category, limit }, { signal: controller.signal })
        .then((response) => {
          if (controller.signal.aborted) return;
          setSettled({ query: trimmed, results: response.results, error: null });
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          setSettled({ query: trimmed, results: [], error: asApiError(error) });
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [trimmed, searchable, category, limit]);

  const current = searchable && settled.query === trimmed;

  return {
    query: trimmed,
    results: current ? settled.results : [],
    loading: searchable && !current,
    error: current ? settled.error : null,
    empty: current && settled.error === null && settled.results.length === 0,
  };
}
