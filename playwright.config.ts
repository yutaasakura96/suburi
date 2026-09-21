import { loadEnvConfig } from "@next/env";
import { defineConfig, devices } from "@playwright/test";
import { E2E_URL, MOCK_OPENAI_BASE_URL } from "./e2e/database";

// Load .env files exactly as `next start` does (.env.local ahead of .env, never over the real
// environment), so the tests mint sessions with the secret the server verifies them with. CI sets
// the variables directly.
loadEnvConfig(process.cwd());

const serverEnv = Object.fromEntries(
  Object.entries({
    ...process.env,
    DATABASE_URL: E2E_URL,
    DATABASE_URL_UNPOOLED: E2E_URL,
    // Model calls go to e2e/mock-openai.ts, never to OpenAI, and the key is never a real one — so a
    // request the mock misses fails instead of spending (06, 2026-09-21).
    OPENAI_API_KEY: "e2e-not-a-real-key",
    OPENAI_BASE_URL: MOCK_OPENAI_BASE_URL,
  }).filter((entry): entry is [string, string] => entry[1] !== undefined),
);
// The test processes read the same config (e2e/cv.spec.ts mints a session through lib/auth).
process.env.DATABASE_URL = E2E_URL;
process.env.DATABASE_URL_UNPOOLED = E2E_URL;
process.env.OPENAI_API_KEY = serverEnv.OPENAI_API_KEY;

// Chromium only, against a production build (docs/11-testing-plan.md §2). Run `npm run build` first.
export default defineConfig({
  testDir: "e2e",
  forbidOnly: true,
  retries: 0,
  globalSetup: "./e2e/global-setup.ts",
  use: { baseURL: "http://localhost:3100" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // Off 3000 so a running `next dev` never collides with the production build under test.
  webServer: {
    command: "npm run start -- -p 3100",
    url: "http://localhost:3100",
    reuseExistingServer: false,
    env: serverEnv,
  },
});
