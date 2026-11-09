import { defineConfig, devices } from "@playwright/test";

/**
 * Browser tests on a production build (service workers only run there).
 *
 *   npm run e2e:build   build against the fake Supabase in tests/e2e/support
 *   npm run e2e         start it (and the fake) and run tests/e2e
 *
 * Against a running deployment instead: E2E_BASE_URL=https://… with
 * E2E_EMAIL and E2E_PASSWORD of a test account; nothing is started then.
 */
const external = process.env.E2E_BASE_URL;
const baseURL = external ?? "http://localhost:3100";

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "*.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    trace: "off",
    ...devices["Pixel 7"],
  },
  webServer: external
    ? undefined
    : [
        {
          command: "node tests/e2e/support/fake-supabase.mjs",
          url: "http://127.0.0.1:54321/__state",
          reuseExistingServer: true,
        },
        {
          command: "node tests/e2e/support/with-fake-env.mjs npx next start -p 3100",
          url: "http://localhost:3100/login",
          reuseExistingServer: true,
          timeout: 120_000,
        },
      ],
});
