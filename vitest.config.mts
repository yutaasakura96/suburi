import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: [
      {
        test: {
          name: "unit",
          environment: "node",
          include: ["**/*.test.ts"],
          exclude: ["**/*.integration.test.ts", "node_modules/**", "e2e/**"],
        },
      },
      {
        test: {
          name: "integration",
          environment: "node",
          include: ["**/*.integration.test.ts"],
          globalSetup: ["db/test/global-setup.ts"],
          exclude: ["node_modules/**"],
        },
      },
    ],
  },
});
