import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ApiError,
  DEFAULT_API_URL,
  UNREACHABLE_MESSAGE,
  api,
  apiBaseUrl,
  asApiError,
} from "@/lib/api";
import { fixture } from "../fixtures";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("the base URL", () => {
  it("falls back to the local backend when nothing is set", () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "");
    expect(apiBaseUrl()).toBe(DEFAULT_API_URL);
  });

  it("uses the configured URL and trims a trailing slash", () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "https://api.test/");
    expect(apiBaseUrl()).toBe("https://api.test");
  });

  it("never sends an Authorization header, because there is no key", async () => {
    fetchMock.mockResolvedValue(jsonResponse(fixture("health").response));
    await api.health();
    const [, init] = fetchMock.mock.calls[0]!;
    const headers = (init as RequestInit).headers as Record<string, string> | undefined;
    expect(headers?.Authorization).toBeUndefined();
    expect(JSON.stringify(init)).not.toMatch(/authorization|api[-_]?key|bearer/i);
  });
});

describe("a backend that does not answer", () => {
  it("reports it as unreachable with the wording the pages show", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const error = await api.stats().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).kind).toBe("unreachable");
    expect((error as ApiError).isUnreachable).toBe(true);
    expect((error as ApiError).message).toBe(UNREACHABLE_MESSAGE);
  });

  it("times out rather than hanging, and calls that unreachable", async () => {
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    const error = await api.stats({ timeoutMs: 10 }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).kind).toBe("unreachable");
  });

  it("re-throws a caller's own abort instead of reporting a failure", async () => {
    const controller = new AbortController();
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    const pending = api.stats({ signal: controller.signal }).catch((caught: unknown) => caught);
    controller.abort();
    const error = await pending;
    // A superseded search is not a failure to tell the reader about.
    expect(error).not.toBeInstanceOf(ApiError);
  });
});

describe("a backend that answers with an error", () => {
  it("carries the code through so a page can branch on it", async () => {
    const identical = fixture("check-identical");
    fetchMock.mockResolvedValue(jsonResponse(identical.response, identical.status));
    const error = await api
      .checkPair({ medicine_a: "Haldi", medicine_b: "Turmeric" })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).kind).toBe("api");
    expect((error as ApiError).status).toBe(400);
    expect((error as ApiError).code).toBe("identical_medicine");
  });

  it("uses the backend's own message rather than inventing one", async () => {
    const missing = fixture("recommend-error");
    fetchMock.mockResolvedValue(jsonResponse(missing.response, missing.status));
    const error = await api.recommend({}).catch((caught: unknown) => caught);
    expect((error as ApiError).code).toBe("missing_parameter");
    expect((error as ApiError).message).toBe(
      (missing.response as { error: { message: string } }).error.message,
    );
  });

  it("keeps the supported conditions attached to an unknown-condition error", async () => {
    const unknown = fixture("recommend-unknown-condition");
    fetchMock.mockResolvedValue(jsonResponse(unknown.response, unknown.status));
    const error = await api
      .recommend({ condition_ids: ["nope"] })
      .catch((caught: unknown) => caught);
    expect((error as ApiError).body?.supported_conditions?.length).toBeGreaterThan(0);
  });

  it("gives a status with no error body a generic message, not a blank one", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ nothing: true }, 500));
    const error = await api.stats().catch((caught: unknown) => caught);
    expect((error as ApiError).kind).toBe("api");
    expect((error as ApiError).message).toMatch(/500/);
    expect((error as ApiError).code).toBeNull();
  });

  it("treats the pair check's 404 as an answer, because its body is a state", async () => {
    const notFound = fixture("check-not-found");
    fetchMock.mockResolvedValue(jsonResponse(notFound.response, notFound.status));
    const answer = await api.checkPair({
      medicine_a: "Paracetamol",
      medicine_b: "Turmeric",
    });
    expect(answer.status).toBe("medicine_not_found");
  });

  it("still throws on an unknown medicine id, which is a real 404", async () => {
    const missing = fixture("medicine-not-found");
    fetchMock.mockResolvedValue(jsonResponse(missing.response, missing.status));
    const error = await api.medicine("herb-nope").catch((caught: unknown) => caught);
    expect((error as ApiError).code).toBe("medicine_not_found");
    expect((error as ApiError).status).toBe(404);
  });
});

describe("a backend that answers with something unexpected", () => {
  it("calls a non-JSON body malformed, not unreachable", async () => {
    fetchMock.mockResolvedValue(
      new Response("<html>not this service</html>", { status: 200 }),
    );
    const error = await api.stats().catch((caught: unknown) => caught);
    expect((error as ApiError).kind).toBe("malformed");
    expect((error as ApiError).isUnreachable).toBe(false);
  });

  it("calls an empty body malformed", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 200 }));
    const error = await api.stats().catch((caught: unknown) => caught);
    expect((error as ApiError).kind).toBe("malformed");
  });
});

describe("request shapes", () => {
  it("builds the search URL with the query encoded", async () => {
    fetchMock.mockResolvedValue(jsonResponse(fixture("search-indian-ginseng").response));
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://api.test");
    await api.search({ q: "Indian Ginseng", limit: 8 });
    expect(fetchMock.mock.calls[0]![0]).toBe(
      "http://api.test/medicines/search?q=Indian+Ginseng&limit=8",
    );
  });

  it("leaves a blank optional parameter out rather than sending it empty", async () => {
    fetchMock.mockResolvedValue(jsonResponse(fixture("medicines-all").response));
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://api.test");
    await api.medicines({ category: "", limit: 100 });
    expect(fetchMock.mock.calls[0]![0]).toBe("http://api.test/medicines?limit=100");
  });

  it("posts /recommend as JSON", async () => {
    fetchMock.mockResolvedValue(jsonResponse(fixture("recommend-diabetes-plain").response));
    await api.recommend({ text: "my sugar is high" });
    const [, init] = fetchMock.mock.calls[0]!;
    expect((init as RequestInit).method).toBe("POST");
    expect((init as RequestInit).body).toBe(JSON.stringify({ text: "my sugar is high" }));
    expect(
      ((init as RequestInit).headers as Record<string, string>)["Content-Type"],
    ).toBe("application/json");
  });

  it("asks for fresh data every time, since a re-seed changes the counts", async () => {
    fetchMock.mockResolvedValue(jsonResponse(fixture("stats").response));
    await api.stats();
    expect((fetchMock.mock.calls[0]![1] as RequestInit).cache).toBe("no-store");
  });

  it("encodes a medicine id into the path", async () => {
    fetchMock.mockResolvedValue(jsonResponse(fixture("medicine-turmeric").response));
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://api.test");
    await api.medicine("herb turmeric/../x");
    expect(fetchMock.mock.calls[0]![0]).toBe(
      "http://api.test/medicines/herb%20turmeric%2F..%2Fx",
    );
  });
});

describe("asApiError", () => {
  it("passes an ApiError through unchanged", () => {
    const original = new ApiError({ kind: "api", message: "m", code: "c" });
    expect(asApiError(original)).toBe(original);
  });

  it("wraps anything else so a page always has the same shape to render", () => {
    const wrapped = asApiError(new Error("boom"));
    expect(wrapped).toBeInstanceOf(ApiError);
    expect(wrapped.message).toBe("boom");
    expect(asApiError("a string").message).toBe("a string");
  });
});
