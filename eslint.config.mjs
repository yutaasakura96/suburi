import { defineConfig, globalIgnores } from "eslint/config";
import nextPlugin from "@next/eslint-plugin-next";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

// Assembled by hand rather than from eslint-config-next: its react, import and jsx-a11y
// plugins do not support ESLint 10 yet (docs/06-decision-log.md). Return to it when they do.
export default defineConfig([
  ...tseslint.configs.recommended,
  reactHooks.configs.flat.recommended,
  {
    plugins: { "@next/next": nextPlugin },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
    },
  },
  {
    rules: {
      "no-restricted-properties": [
        "error",
        {
          object: "process",
          property: "env",
          message: "Read configuration through getConfig() in lib/config.ts.",
        },
      ],
    },
  },
  {
    // lib/config.ts is the reader. playwright.config.ts builds the environment the server under
    // test boots with, so it has to write it. The dev:session guard reads the environment before
    // getConfig() may, and its tests build the environment the script runs with.
    // instrumentation-client.ts reads the two constants next.config.ts inlines from lib/config.ts
    // at build; the browser has no environment to read. The measurement and ear-check scripts need
    // the OpenAI key and nothing else of the app's configuration, and run where no database is.
    files: [
      "scripts/measure-round-latency.mts",
      "scripts/measure-question-generation.mts",
      "scripts/measure-model-answers.mts",
      "scripts/ear-check.mts",
      "lib/config.ts",
      "instrumentation-client.ts",
      "playwright.config.ts",
      "scripts/dev-session.mts",
      "scripts/dev-session-guard.test.ts",
      "e2e/dev-session.spec.ts",
    ],
    rules: { "no-restricted-properties": "off" },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "playwright-report/**",
    "test-results/**",
  ]),
]);
