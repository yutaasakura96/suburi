import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: [
      {
        // The route modules and page loaders import through tsconfig's `@/` path.
        resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
        test: {
          name: "unit",
          environment: "node",
          include: ["**/*.test.ts"],
          exclude: ["**/*.integration.test.ts", "node_modules/**", "e2e/**"],
        },
      },
      {
        resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
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
