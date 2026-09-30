import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ROUTE_MAX_DURATION_SECONDS, invocationDeadline } from "./deps";

// Next reads `maxDuration` only as a literal, so each model-calling round route spells the number, and
// this holds every spelling to the one the scoring deadline is computed from (07 §5.10).
const MODEL_ROUTES = [
  "app/api/rounds/route.ts",
  "app/api/rounds/[roundId]/complete/route.ts",
  "app/api/rounds/[roundId]/feedback/route.ts",
  "app/api/answers/[answerId]/submit/route.ts",
  "app/api/answers/[answerId]/transcribe/route.ts",
];

describe("the round routes' duration", () => {
  it.each(MODEL_ROUTES)("%s declares the deadline's maxDuration", (path) => {
    expect(readFileSync(path, "utf8")).toContain(`export const maxDuration = ${ROUTE_MAX_DURATION_SECONDS};`);
  });

  it("ends the invocation's work 15 s before the ceiling", () => {
    expect(invocationDeadline(1_000)).toBe(1_000 + (ROUTE_MAX_DURATION_SECONDS - 15) * 1000);
  });
});
