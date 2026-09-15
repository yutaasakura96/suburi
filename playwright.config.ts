import { defineConfig, devices } from "@playwright/test";

// Chromium only, against a production build (docs/11-testing-plan.md §2). Run `npm run build` first.
export default defineConfig({
  testDir: "e2e",
  forbidOnly: true,
  retries: 0,
  use: { baseURL: "http://localhost:3100" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // Off 3000 so a running `next dev` never collides with the production build under test.
  webServer: {
    command: "npm run start -- -p 3100",
    url: "http://localhost:3100",
    reuseExistingServer: false,
  },
});
