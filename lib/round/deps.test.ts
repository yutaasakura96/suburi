import { describe, expect, it } from "vitest";
import { COMPLETE_WAIT_BOUND_MS, FEEDBACK_TIMEOUT_MS } from "./complete";
import { ROUTE_MAX_DURATION_SECONDS, invocationDeadline } from "./deps";
import { FOLLOW_UP_BACKOFF_MS, FOLLOW_UP_RETRIES, FOLLOW_UP_TIMEOUT_MS } from "./follow-up";
import { EMBEDDING_TIMEOUT_MS, GENERATION_TIMEOUT_MS } from "./generate-candidates";
import { RUN_CLAIM_SECONDS } from "./run-scoring";
import { MODEL_ANSWER_TIMEOUT_MS, MODEL_ANSWER_WAIT_MS } from "./model-answers";

// Next reads `maxDuration` only as a literal, so each model-calling round route spells the number, and
// this holds every route's exported value to the one the scoring deadline is computed from (07 §5.10).
const MODEL_ROUTES = {
  "POST /api/rounds": () => import("../../app/api/rounds/route"),
  "POST /api/rounds/{id}/complete": () => import("../../app/api/rounds/[roundId]/complete/route"),
  "POST /api/rounds/{id}/feedback": () => import("../../app/api/rounds/[roundId]/feedback/route"),
  "POST /api/rounds/{id}/model-answers": () => import("../../app/api/rounds/[roundId]/model-answers/route"),
  "POST /api/answers/{id}/submit": () => import("../../app/api/answers/[answerId]/submit/route"),
  "POST /api/answers/{id}/transcribe": () => import("../../app/api/answers/[answerId]/transcribe/route"),
  "POST /api/scoring-attempts/{id}/run": () => import("../../app/api/scoring-attempts/[attemptId]/run/route"),
};

describe("the round routes' duration", () => {
  it.each(Object.entries(MODEL_ROUTES))("%s exports the deadline's maxDuration", async (_, load) => {
    expect((await load()).maxDuration).toBe(ROUTE_MAX_DURATION_SECONDS);
  });

  it("ends the invocation's work 15 s before the ceiling", () => {
    expect(invocationDeadline(1_000)).toBe(1_000 + (ROUTE_MAX_DURATION_SECONDS - 15) * 1000);
  });

  // A claim is live for exactly as long as an invocation can be: no run outlives the ceiling, so an
  // older claim was left by a function that died (07 §5.10).
  it("holds a scoring run's claim for the whole invocation, and no longer", () => {
    expect(RUN_CLAIM_SECONDS).toBe(ROUTE_MAX_DURATION_SECONDS);
  });

  it("fits complete's wait and its feedback call inside the deadline (07 §5.12)", () => {
    expect(COMPLETE_WAIT_BOUND_MS + FEEDBACK_TIMEOUT_MS).toBeLessThan(invocationDeadline(0));
  });

  // The model-answer calls start when the round closes and run beside both. `complete` waits for them
  // no longer than its own slowest path, and a call left running in `after()` ends inside the deadline.
  it("never holds complete for a model answer past its own wait and feedback call (07 §5.12)", () => {
    expect(MODEL_ANSWER_WAIT_MS).toBeLessThan(MODEL_ANSWER_TIMEOUT_MS);
    expect(MODEL_ANSWER_WAIT_MS).toBeLessThan(COMPLETE_WAIT_BOUND_MS + FEEDBACK_TIMEOUT_MS);
    expect(MODEL_ANSWER_TIMEOUT_MS).toBeLessThan(invocationDeadline(0));
  });

  // 06, 2026-10-16, L1: three times the slowest Japanese follow-up (14.6 s) and twice the slowest round
  // start (45.9 s), each fitting its route with its retry and the other work on the path (07 §5.4, §5.9).
  it("bounds a follow-up at 45 s with one retry after 1 s, inside submit's deadline (07 §5.9)", () => {
    expect(FOLLOW_UP_TIMEOUT_MS).toBe(45_000);
    expect(FOLLOW_UP_RETRIES).toBe(1);
    expect(FOLLOW_UP_BACKOFF_MS).toBe(1_000);
    const longest = FOLLOW_UP_TIMEOUT_MS * (FOLLOW_UP_RETRIES + 1) + FOLLOW_UP_BACKOFF_MS * FOLLOW_UP_RETRIES;
    expect(longest).toBeLessThan(invocationDeadline(0));
  });

  it("bounds round-start generation at 90 s, and its embeddings after it, inside the deadline (07 §5.4)", () => {
    expect(GENERATION_TIMEOUT_MS).toBe(90_000);
    expect(GENERATION_TIMEOUT_MS + EMBEDDING_TIMEOUT_MS).toBeLessThan(invocationDeadline(0));
  });
});
