import { and, asc, eq, sql } from "drizzle-orm";
import * as s from "../../db/schema";
import { ModelCallFailed } from "../ai/upstream";
import type { AnswerScorer } from "../ai/score";
import type { Rubric } from "../rubric/types";
import { citableClaims, locateUnsupported, resolveCitations, type CitableClaim } from "./grounding";
import { log, pgErrorClass, type Db } from "./http";

/**
 * Performs one pending scoring attempt (07 §5.10). Normally scheduled by `submit` in `after()`, while
 * the user is already recording the next answer; nothing awaits it, so a function that dies mid-flight
 * leaves the row `pending`, which is a first-class state and alerted on daily (12 §6).
 *
 * **Only `pending` transitions.** A finished attempt is left as it is. The scores, the CV check and
 * the `ok` land in one transaction, so an attempt is never `ok` with half its dimensions or without
 * its flags.
 *
 * **One run at a time.** A run first claims the attempt by stamping `run_started_at`; a second run
 * that finds a live claim is `in_flight` and calls nothing, which is History's `409` (07 §5.10). A
 * claim older than the invocation's ceiling belongs to a function that died, and is taken over.
 *
 * **The CV check is stored only after validation** (07 §5.10, `grounding.ts`): a citation must name a
 * claim the scorer was shown, an unsupported span must be found verbatim in `transcript_corrected`,
 * and what fails is dropped and counted in the log line — never clamped, never stored.
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

/**
 * How long a claim holds: the whole invocation (07 §5.10). No run outlives Hobby's 300 s, so a claim
 * older than that was left by a function that died mid-flight.
 */
export const RUN_CLAIM_SECONDS = 300;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The claims of one CV version a scorer may cite, in document order — each sliced from the stored body. */
export async function citableClaimsOf(db: Pick<Db, "select">, cvVersionId: string): Promise<{ claims: CitableClaim[]; rejected: number }> {
  const [[version], documents, claims] = await Promise.all([
    db.select({ body: s.cvVersions.body }).from(s.cvVersions).where(eq(s.cvVersions.id, cvVersionId)),
    db
      .select({ start: s.cvDocuments.start, end: s.cvDocuments.end })
      .from(s.cvDocuments)
      .where(eq(s.cvDocuments.cvVersionId, cvVersionId))
      .orderBy(asc(s.cvDocuments.position)),
    db
      .select({ id: s.cvClaims.id, start: s.cvClaims.spanStart, end: s.cvClaims.spanEnd, textNormalised: s.cvClaims.textNormalised })
      .from(s.cvClaims)
      .where(eq(s.cvClaims.cvVersionId, cvVersionId))
      .orderBy(asc(s.cvClaims.spanStart), asc(s.cvClaims.id)),
  ]);
  return citableClaims(version.body, documents, claims);
}

export async function runScoringAttempt(
  deps: ScoringRunDeps,
  attemptId: string,
  { deadline }: { deadline: number },
): Promise<"ok" | "failed" | "skipped" | "in_flight"> {
  const sleep = deps.sleep ?? wait;
  const [claimed] = await deps.db
    .update(s.scoringAttempts)
    .set({ runStartedAt: sql`now()` })
    .where(
      and(
        eq(s.scoringAttempts.id, attemptId),
        eq(s.scoringAttempts.status, "pending"),
        sql`(${s.scoringAttempts.runStartedAt} is null or ${s.scoringAttempts.runStartedAt} <= now() - make_interval(secs => ${RUN_CLAIM_SECONDS}))`,
      ),
    )
    .returning({ id: s.scoringAttempts.id });
  if (!claimed) {
    const [current] = await deps.db
      .select({ status: s.scoringAttempts.status })
      .from(s.scoringAttempts)
      .where(eq(s.scoringAttempts.id, attemptId));
    return current?.status === "pending" ? "in_flight" : "skipped";
  }
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
  const corrected = answer.transcriptCorrected ?? "";
  const started = performance.now();
  const cv = await citableClaimsOf(deps.db, row.attempt.cvVersionId);

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
          answer: corrected,
          durationMs: answer.audioDurationMs,
          pace: answer.wordsPerMinute,
          claims: cv.claims.map((claim) => claim.text),
        },
        { timeoutMs: Math.min(CALL_TIMEOUT_MS, left - 5_000) },
      );
      const cited = resolveCitations(cv.claims, result.citations);
      const flagged = locateUnsupported(corrected, result.unsupported);
      await deps.transaction(async (tx) => {
        const [updated] = await tx
          .update(s.scoringAttempts)
          .set({ status: "ok", answeredLanguage: result.answeredLanguage, tokensIn: result.tokensIn, tokensOut: result.tokensOut })
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
        if (cited.citations.length > 0) {
          // An answer cites a claim once per relation, whichever attempt saw it first (04).
          await tx
            .insert(s.claimCitations)
            .values(cited.citations.map((citation) => ({ answerId: answer.id, ...citation })))
            .onConflictDoNothing();
        }
        if (flagged.spans.length > 0) {
          await tx.insert(s.answerFlags).values(
            flagged.spans.map((span) => ({
              answerId: answer.id,
              scoringAttemptId: attemptId,
              userId: row.attempt.userId,
              kind: "unsupported" as const,
              spanStart: span.start,
              spanEnd: span.end,
            })),
          );
        }
      });
      log("info", {
        event: "scoring_ok",
        attempt_id: attemptId,
        answer_id: answer.id,
        retries: attempt,
        claims: cv.claims.length,
        claims_rejected: cv.rejected,
        citations: cited.citations.length,
        citations_dropped: cited.dropped,
        flags: flagged.spans.length,
        flags_dropped: flagged.dropped,
        answered_language: result.answeredLanguage,
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
