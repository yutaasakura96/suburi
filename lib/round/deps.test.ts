import { describe, expect, it } from "vitest";
import { COMPLETE_WAIT_BOUND_MS, FEEDBACK_TIMEOUT_MS } from "./complete";
import { ROUTE_MAX_DURATION_SECONDS, invocationDeadline } from "./deps";

// Next reads `maxDuration` only as a literal, so each model-calling round route spells the number, and
// this holds every route's exported value to the one the scoring deadline is computed from (07 §5.10).
const MODEL_ROUTES = {
  "POST /api/rounds": () => import("../../app/api/rounds/route"),
  "POST /api/rounds/{id}/complete": () => import("../../app/api/rounds/[roundId]/complete/route"),
  "POST /api/rounds/{id}/feedback": () => import("../../app/api/rounds/[roundId]/feedback/route"),
  "POST /api/answers/{id}/submit": () => import("../../app/api/answers/[answerId]/submit/route"),
  "POST /api/answers/{id}/transcribe": () => import("../../app/api/answers/[answerId]/transcribe/route"),
};

describe("the round routes' duration", () => {
  it.each(Object.entries(MODEL_ROUTES))("%s exports the deadline's maxDuration", async (_, load) => {
    expect((await load()).maxDuration).toBe(ROUTE_MAX_DURATION_SECONDS);
  });

  it("ends the invocation's work 15 s before the ceiling", () => {
    expect(invocationDeadline(1_000)).toBe(1_000 + (ROUTE_MAX_DURATION_SECONDS - 15) * 1000);
  });

  it("fits complete's wait and its feedback call inside the deadline (07 §5.12)", () => {
    expect(COMPLETE_WAIT_BOUND_MS + FEEDBACK_TIMEOUT_MS).toBeLessThan(invocationDeadline(0));
  });
});
