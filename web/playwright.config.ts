import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end against the real backend.
 *
 * Nothing is stubbed. The suite drives a browser against a running Next.js
 * server which talks to a running `python -m hdi.api`, so every medical value
 * on screen during these tests came out of the database. A test that passed
 * against a mock would prove nothing about this project's honesty rules.
 *
 * The web server is started by Playwright. The backend is not: it needs the
 * seeded database and it is the thing under test as much as the front end is,
 * so `tests/e2e/global-setup.ts` checks it is up and fails with the command to
 * start it rather than quietly running against nothing.
 */
const WEB_PORT = Number(process.env.E2E_PORT ?? 3100);
const WEB_URL = `http://127.0.0.1:${WEB_PORT}`;
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000";

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: WEB_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } },
    },
  ],
  webServer: {
    command: `npm run start -- --port ${WEB_PORT}`,
    url: WEB_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { NEXT_PUBLIC_API_URL: API_URL },
    stdout: "ignore",
    stderr: "pipe",
  },
});
