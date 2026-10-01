/**
 * The typed API client.
 *
 * One request function, one error type, and a named method per endpoint. All of
 * it works in a server component and in the browser, because the base URL comes
 * from NEXT_PUBLIC_API_URL either way and no request carries a credential.
 *
 * There are no API keys anywhere in this app. The backend needs none
 * (docs/BACKEND_API.md, "Environment variables"), so nothing here reads a
 * secret or sends an Authorization header.
 *
 * Errors are modelled rather than thrown as strings, because the pages have to
 * tell three failures apart and say different things about each:
 *
 *   unreachable   nothing answered, or the request timed out. The reader is
 *                 told to start the backend; this is not a data problem.
 *   api           the backend answered with a status and a code. That code is
 *                 the answer (medicine_not_found, identical_medicine, ...), so
 *                 it is carried through for the page to branch on.
 *   malformed     something answered but it was not the JSON this client asked
 *                 for, which usually means the URL points at the wrong service.
 */

import type {
  ConditionsResponse,
  DocumentedInteractionsResponse,
  HealthResponse,
  InteractionRecord,
  MedicineDetail,
  MedicineInteractionsResponse,
  MedicineListResponse,
  MedicineNotFoundResponse,
  RecommendRequest,
  RecommendResponse,
  SearchResponse,
  StatsResponse,
  ApiErrorBody,
} from "./types";

export const DEFAULT_API_URL = "http://127.0.0.1:8000";
export const DEFAULT_TIMEOUT_MS = 15_000;

/** The copy shown whenever the backend cannot be reached at all. */
export const UNREACHABLE_MESSAGE =
  "The database server is not responding. Start it with python -m hdi.api.";

export type ApiFailureKind = "unreachable" | "api" | "malformed";

export class ApiError extends Error {
  readonly kind: ApiFailureKind;
  readonly status: number | null;
  readonly code: string | null;
  readonly body: ApiErrorBody | null;
  readonly payload: unknown;

  constructor(options: {
    kind: ApiFailureKind;
    message: string;
    status?: number | null;
    code?: string | null;
    body?: ApiErrorBody | null;
    payload?: unknown;
  }) {
    super(options.message);
    this.name = "ApiError";
    this.kind = options.kind;
    this.status = options.status ?? null;
    this.code = options.code ?? null;
    this.body = options.body ?? null;
    this.payload = options.payload ?? null;
  }

  /** True when the backend never answered, which is a setup problem. */
  get isUnreachable(): boolean {
    return this.kind === "unreachable";
  }
}

export function apiBaseUrl(): string {
  const raw = process.env.NEXT_PUBLIC_API_URL?.trim();
  return (raw || DEFAULT_API_URL).replace(/\/+$/, "");
}

function isErrorBody(value: unknown): value is ApiErrorBody {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { code?: unknown }).code === "string" &&
    typeof (value as { message?: unknown }).message === "string"
  );
}

/**
 * Pull the error body out of whatever the backend sent.
 *
 * The 404 from a pair check nests `error` inside a body that also carries
 * `status` and the disclaimer, so the envelope is checked before the bare
 * object (docs/BACKEND_API.md, "Validation and errors").
 */
function errorBodyOf(payload: unknown): ApiErrorBody | null {
  if (typeof payload !== "object" || payload === null) return null;
  const nested = (payload as { error?: unknown }).error;
  if (isErrorBody(nested)) return nested;
  if (isErrorBody(payload)) return payload;
  return null;
}

export interface RequestOptions {
  /** Abort and report `unreachable` after this many milliseconds. */
  timeoutMs?: number;
  /** Caller's own abort signal, for a search box that supersedes its request. */
  signal?: AbortSignal;
  /**
   * Statuses whose body is a valid answer rather than a failure. A pair check
   * passes 404 here, because the 404 body carries the medicine_not_found state
   * the page has to render.
   */
  expectStatuses?: number[];
}

interface RawRequest extends RequestOptions {
  method: "GET" | "POST";
  path: string;
  body?: unknown;
}

async function request<T>({
  method,
  path,
  body,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  signal,
  expectStatuses = [],
}: RawRequest): Promise<T> {
  const url = `${apiBaseUrl()}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort);

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
      // Health data changes when the database is re-seeded, and a stale count
      // on a page about provenance would be worse than a slower page.
      cache: "no-store",
    });
  } catch (cause) {
    // A caller-initiated abort is not a failure to report; it is a superseded
    // request, and the caller is the one who knows that.
    if (signal?.aborted) throw cause;
    throw new ApiError({
      kind: "unreachable",
      message: UNREACHABLE_MESSAGE,
      payload: cause,
    });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      throw new ApiError({
        kind: "malformed",
        message: `${url} answered with something that is not JSON.`,
        status: response.status,
      });
    }
  }

  if (!response.ok && !expectStatuses.includes(response.status)) {
    const errorBody = errorBodyOf(payload);
    throw new ApiError({
      kind: "api",
      message: errorBody?.message ?? `The database server returned ${response.status}.`,
      status: response.status,
      code: errorBody?.code ?? null,
      body: errorBody,
      payload,
    });
  }

  if (payload === null) {
    throw new ApiError({
      kind: "malformed",
      message: `${url} answered with an empty body.`,
      status: response.status,
    });
  }

  return payload as T;
}

function query(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const encoded = search.toString();
  return encoded ? `?${encoded}` : "";
}

export const api = {
  health(options?: RequestOptions) {
    return request<HealthResponse>({ method: "GET", path: "/health", ...options });
  },

  stats(options?: RequestOptions) {
    return request<StatsResponse>({ method: "GET", path: "/stats", ...options });
  },

  conditions(options?: RequestOptions) {
    return request<ConditionsResponse>({ method: "GET", path: "/conditions", ...options });
  },

  medicines(
    params: { category?: string; limit?: number; offset?: number } = {},
    options?: RequestOptions,
  ) {
    return request<MedicineListResponse>({
      method: "GET",
      path: `/medicines${query({ ...params })}`,
      ...options,
    });
  },

  search(
    params: { q: string; category?: string; limit?: number },
    options?: RequestOptions,
  ) {
    return request<SearchResponse>({
      method: "GET",
      path: `/medicines/search${query({ ...params })}`,
      ...options,
    });
  },

  medicine(id: string, options?: RequestOptions) {
    return request<MedicineDetail>({
      method: "GET",
      path: `/medicines/${encodeURIComponent(id)}`,
      ...options,
    });
  },

  medicineInteractions(
    id: string,
    params: {
      category?: string;
      status?: string;
      include_evidence?: boolean;
      limit?: number;
      offset?: number;
    } = {},
    options?: RequestOptions,
  ) {
    return request<MedicineInteractionsResponse>({
      method: "GET",
      path: `/medicines/${encodeURIComponent(id)}/interactions${query({ ...params })}`,
      ...options,
    });
  },

  /**
   * The pair check. A 404 is expected rather than thrown, because its body is
   * the medicine_not_found state the page renders; a 400 or 409 is still a
   * thrown ApiError carrying `identical_medicine` or `ambiguous_medicine`.
   */
  checkPair(
    params: { medicine_a: string; medicine_b: string },
    options?: RequestOptions,
  ) {
    return request<InteractionRecord | MedicineNotFoundResponse>({
      method: "GET",
      path: `/interactions/check${query({ ...params })}`,
      expectStatuses: [404],
      ...options,
    });
  },

  documentedInteractions(
    params: { pair_kind?: string; limit?: number } = {},
    options?: RequestOptions,
  ) {
    return request<DocumentedInteractionsResponse>({
      method: "GET",
      path: `/interactions/documented${query({ ...params })}`,
      ...options,
    });
  },

  /**
   * POST /recommend. All four statuses are HTTP 200 and come back as data; a
   * 400 carrying supported_conditions is thrown so the caller can offer them.
   */
  recommend(body: RecommendRequest, options?: RequestOptions) {
    return request<RecommendResponse>({
      method: "POST",
      path: "/recommend",
      body,
      // Classifying free text runs a model over the request, so this one gets
      // longer than a database read.
      timeoutMs: 25_000,
      ...options,
    });
  },
};

/** Narrow an unknown caught value to an ApiError, for a page's error branch. */
export function asApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  return new ApiError({
    kind: "malformed",
    message: error instanceof Error ? error.message : String(error),
    payload: error,
  });
}
