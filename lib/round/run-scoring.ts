import { and, eq } from "drizzle-orm";
import * as s from "../../db/schema";
import { ModelCallFailed } from "../ai/upstream";
import type { AnswerScorer } from "../ai/score";
import type { Rubric } from "../rubric/types";
import { log, pgErrorClass, type Db } from "./http";

/**
 * Performs one pending scoring attempt (07 §5.10). Normally scheduled by `submit` in `after()`, while
 * the user is already recording the next answer; nothing awaits it, so a function that dies mid-flight
 * leaves the row `pending`, which is a first-class state and alerted on daily (12 §6).
 *
 * **Only `pending` transitions.** A finished attempt is left as it is. The scores and the `ok` land
 * in one transaction, so an attempt is never `ok` with half its dimensions.
 *
 * **Three retries with exponential backoff, inside the invocation's 300 s** — the whole invocation,
 * shared with the submit that scheduled it (07 §5.10). When too little of it is left for another
 * call, the attempt fails rather than run the ceiling down.
 */
export interface ScoringRunDeps {
  readonly db: Db;
  readonly transaction: <T>(work: (tx: Db) => Promise<T>) => Promise<T>;
  readonly scorer: AnswerScorer;
  readonly sleep?: (ms: number) => Promise<void>;
}

export const SCORING_RETRIES = 3;
const BACKOFF_MS = [2_000, 4_000, 8_000];
/** A call gets at most this long, and is not started with less than `MIN_CALL_MS` of the budget left. */
const CALL_TIMEOUT_MS = 120_000;
const MIN_CALL_MS = 20_000;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function runScoringAttempt(
  deps: ScoringRunDeps,
  attemptId: string,
  { deadline }: { deadline: number },
): Promise<"ok" | "failed" | "skipped"> {
  const sleep = deps.sleep ?? wait;
  const [row] = await deps.db
    .select({
      attempt: s.scoringAttempts,
      answer: s.answers,
      rubric: s.rubricVersions,
    })
    .from(s.scoringAttempts)
    .innerJoin(s.answers, eq(s.answers.id, s.scoringAttempts.answerId))
    .innerJoin(s.rubricVersions, eq(s.rubricVersions.id, s.scoringAttempts.rubricVersionId))
    .where(eq(s.scoringAttempts.id, attemptId));
  if (!row || row.attempt.status !== "pending") return "skipped";

  const { answer } = row;
  const rubric: Rubric = {
    versionLabel: row.rubric.versionLabel,
    language: row.rubric.language,
    dimensions: row.rubric.dimensions as Rubric["dimensions"],
  };
  const started = performance.now();

  let errorClass = "budget_exhausted";
  for (let attempt = 0; attempt <= SCORING_RETRIES; attempt += 1) {
    if (attempt > 0) await sleep(BACKOFF_MS[attempt - 1]);
    const left = deadline - Date.now();
    if (left < MIN_CALL_MS) {
      errorClass = attempt === 0 ? "budget_exhausted" : errorClass;
      break;
    }
    try {
      const result = await deps.scorer.score(
        {
          rubric,
          prompt: answer.promptText,
          // The corrected text, never the raw one (03 §4).
          answer: answer.transcriptCorrected ?? "",
          durationMs: answer.audioDurationMs,
          pace: answer.wordsPerMinute,
        },
        { timeoutMs: Math.min(CALL_TIMEOUT_MS, left - 5_000) },
      );
      await deps.transaction(async (tx) => {
        const [updated] = await tx
          .update(s.scoringAttempts)
          .set({ status: "ok", tokensIn: result.tokensIn, tokensOut: result.tokensOut })
          .where(and(eq(s.scoringAttempts.id, attemptId), eq(s.scoringAttempts.status, "pending")))
          .returning({ id: s.scoringAttempts.id });
        if (!updated) return;
        await tx.insert(s.scores).values(
          result.scores.map((score) => ({
            scoringAttemptId: attemptId,
            dimension: score.dimension,
            value: score.value,
            justification: score.justification,
          })),
        );
      });
      log("info", {
        event: "scoring_ok",
        attempt_id: attemptId,
        answer_id: answer.id,
        retries: attempt,
        tokens_in: result.tokensIn,
        tokens_out: result.tokensOut,
        duration_ms: Math.round(performance.now() - started),
      });
      return "ok";
    } catch (error) {
      errorClass = error instanceof ModelCallFailed ? error.errorClass : pgErrorClass(error);
      log("error", { event: "scoring_call_failed", attempt_id: attemptId, retry: attempt, error_class: errorClass });
    }
  }

  await deps.db
    .update(s.scoringAttempts)
    .set({ status: "failed", errorClass })
    .where(and(eq(s.scoringAttempts.id, attemptId), eq(s.scoringAttempts.status, "pending")));
  log("error", {
    event: "scoring_failed",
    attempt_id: attemptId,
    answer_id: answer.id,
    error_class: errorClass,
    duration_ms: Math.round(performance.now() - started),
  });
  return "failed";
}
