/**
 * Check the backend is up and seeded before a single test runs.
 *
 * Without this, a stopped backend produces a page full of "the database server
 * is not responding" and a dozen confusing assertion failures. With it, the run
 * stops immediately and says what to start.
 */
const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000").replace(
  /\/+$/,
  "",
);

export default async function globalSetup() {
  let health: { status?: string; database?: Record<string, string> };
  try {
    const response = await fetch(`${API_URL}/health`, {
      signal: AbortSignal.timeout(10_000),
    });
    health = (await response.json()) as typeof health;
  } catch (cause) {
    throw new Error(
      `The backend at ${API_URL} is not responding, so the end-to-end suite has ` +
        `nothing real to test against.\n\n` +
        `  python -m hdi.seed\n` +
        `  python -m hdi.api\n\n` +
        `Set NEXT_PUBLIC_API_URL if it is somewhere else. (${String(cause)})`,
    );
  }

  if (health.status !== "ok") {
    throw new Error(`${API_URL}/health did not report ok: ${JSON.stringify(health)}`);
  }

  const medicines = Number(health.database?.medicines ?? 0);
  if (!medicines) {
    throw new Error(
      `The backend at ${API_URL} is running but its database is empty. ` +
        `Build it with: python -m hdi.seed`,
    );
  }

  const stats = await fetch(`${API_URL}/stats`, { signal: AbortSignal.timeout(10_000) });
  if (!stats.ok) {
    throw new Error(
      `${API_URL}/stats answered ${stats.status}. The front end needs it for every count ` +
        `it shows, so the suite would be testing placeholders.`,
    );
  }

  // The search box, /ask and /check all call the backend from the browser, so
  // the backend has to allow the origin the suite serves the app on. Without
  // this check a CORS refusal shows up as "the database server is not
  // responding" in a dozen tests, which is the one message that does not point
  // at the real problem.
  const origin = `http://127.0.0.1:${process.env.E2E_PORT ?? 3100}`;
  const preflight = await fetch(`${API_URL}/medicines/search?q=test`, {
    method: "OPTIONS",
    headers: { Origin: origin, "Access-Control-Request-Method": "GET" },
    signal: AbortSignal.timeout(10_000),
  });
  if (preflight.headers.get("access-control-allow-origin") === null) {
    throw new Error(
      `The backend at ${API_URL} does not allow browser requests from ${origin}, so every ` +
        `search, option lookup and pair check in this suite would fail as "not ` +
        `responding".\n\nStart it with:\n\n` +
        `  $env:ALLOWED_ORIGINS = "${origin},http://localhost:${process.env.E2E_PORT ?? 3100}"\n` +
        `  python -m hdi.api\n`,
    );
  }

  // Setup output, not application logging: it names what the suite is about to
  // run against, so a failing run says which backend it reached.
  console.log(`backend ready at ${API_URL} with ${medicines} medicines`);
}
