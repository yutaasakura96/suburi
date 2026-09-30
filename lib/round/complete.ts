import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import * as s from "../../db/schema";
import { apiError } from "../api/errors";
import type { RoundFeedbackGenerator } from "../ai/round-feedback";
import { ModelCallFailed } from "../ai/upstream";
import type { Rubric } from "../rubric/types";
import { authenticate, isUuid, log, notFound, parseBody, writeFailed, type Db, type RoundDeps } from "./http";
import { latestAttempts, roundAnswers, roundStep, scoringCounts, type RoundRow } from "./state";

/**
 * `POST /api/rounds/{roundId}/complete` ⚡ (07 §5.12) and its retry, `POST …/feedback` (§5.16).
 *
 * **In this order, and never inside one transaction with the model** (06, 2026-09-27):
 * 1. One transaction writes `felt_pressure` and `completed_at`, and commits — the rating is on record
 *    before any feedback exists, whatever happens next.
 * 2. Wait, bounded, for the round's pending scores. **A score that ended `failed` is not waited for**:
 *    the feedback is written without it (06, 2026-09-28).
 * 3. Generate the feedback outside any transaction.
 * 4. Write `round_feedback`, whole, once.
 *
 * If the bound runs out or generation fails, **no row is written** — feedback from an incomplete set of
 * scores would be permanent — the round stays complete with its rating, and the answer is
 * `502 feedback_generation_failed`, retried through `feedback`.
 */

/**
 * How long `complete` waits for the last pending score (07 §5.12). From the round loop's latency
 * measurement, 2026-10-01 (03 §4): scoring's slowest call was 38.1 s against a 7.1 s median, so 60 s
 * covers that call, a 2 s backoff and a median retry — and with the feedback call's own 120 s it
 * stays inside the route's 285 s. Usually nothing is pending by then: screen 7 is where it lands.
 */
export const COMPLETE_WAIT_BOUND_MS = 60_000;
const POLL_MS = 1_000;
export const FEEDBACK_TIMEOUT_MS = 120_000;

export interface CompleteDeps extends RoundDeps {
  readonly generator: RoundFeedbackGenerator;
  readonly waitBoundMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type FeedbackRow = typeof s.roundFeedback.$inferSelect;

export function feedbackView(row: FeedbackRow) {
  return {
    to_fix: row.toFix,
    what_worked: row.whatWorked,
    language: row.language,
    model_id: row.modelId,
    prompt_version: row.promptVersion,
  };
}

async function existingFeedback(db: Db, roundId: string) {
  const [row] = await db.select().from(s.roundFeedback).where(eq(s.roundFeedback.roundId, roundId));
  return row ?? null;
}

type Outcome =
  | { readonly ok: true; readonly feedback: FeedbackRow; readonly counts: ReturnType<typeof scoringCounts> }
  | { readonly ok: false; readonly response: Response };

/** Steps 2–4, shared by `complete` and its retry. */
async function writeRoundFeedback(deps: CompleteDeps, round: RoundRow): Promise<Outcome> {
  const sleep = deps.sleep ?? wait;
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  const answers = (await roundAnswers(deps.db, round.id)).filter((answer) => answer.transcriptCorrected !== null);
  const ids = answers.map((answer) => answer.id);

  // Step 2: poll until no latest attempt is pending, or the bound runs out.
  const bound = deps.waitBoundMs ?? COMPLETE_WAIT_BOUND_MS;
  let attempts = await latestAttempts(deps.db, ids);
  while ([...attempts.values()].some((attempt) => attempt.status === "pending") && performance.now() - started < bound) {
    await sleep(POLL_MS);
    attempts = await latestAttempts(deps.db, ids);
  }
  const counts = scoringCounts(attempts.values());
  const failure = (errorClass: string) => {
    log("error", { event: "feedback_generation_failed", round_id: round.id, error_class: errorClass, ...counts, duration_ms: elapsed() });
    return {
      ok: false as const,
      response: apiError("feedback_generation_failed", "Round feedback was not written; the round is complete.", {
        round_id: round.id,
        error_class: errorClass,
        pending: counts.pending,
      }),
    };
  };
  if (counts.pending > 0) return failure("scores_pending");
  if (counts.ok === 0) return failure("no_scores");

  const okIds = [...attempts.values()].filter((attempt) => attempt.status === "ok").map((attempt) => attempt.id);
  const scoreRows = okIds.length === 0 ? [] : await deps.db.select().from(s.scores).where(inArray(s.scores.scoringAttemptId, okIds));
  const [rubricRow] = await deps.db.select().from(s.rubricVersions).where(eq(s.rubricVersions.id, round.rubricVersionId));
  const rubric: Rubric = {
    versionLabel: rubricRow.versionLabel,
    language: rubricRow.language,
    dimensions: rubricRow.dimensions as Rubric["dimensions"],
  };
  const order = rubric.dimensions.map((dimension) => dimension.key as string);

  // Step 3, outside any transaction.
  let result;
  try {
    result = await deps.generator.generate(
      {
        rubric,
        answers: answers.map((answer) => {
          const attempt = attempts.get(answer.id);
          const scores =
            attempt?.status === "ok"
              ? scoreRows
                  .filter((score) => score.scoringAttemptId === attempt.id)
                  .sort((a, b) => order.indexOf(a.dimension) - order.indexOf(b.dimension))
                  .map((score) => ({ dimension: score.dimension, value: score.value }))
              : null;
          return {
            position: answer.position,
            prompt: answer.promptText,
            answer: answer.transcriptCorrected ?? "",
            durationMs: answer.audioDurationMs,
            pace: answer.wordsPerMinute,
            scores,
          };
        }),
      },
      { timeoutMs: FEEDBACK_TIMEOUT_MS },
    );
  } catch (error) {
    return failure(error instanceof ModelCallFailed ? error.errorClass : "unexpected");
  }
  const promptVersion = deps.generator.promptVersions[round.language];
  if (!promptVersion) return failure("no_prompt_for_language");

  // Step 4: written once. A concurrent retry that wrote first keeps its row.
  let feedback: FeedbackRow | null;
  try {
    [feedback] = await deps.db
      .insert(s.roundFeedback)
      .values({
        roundId: round.id,
        toFix: result.toFix,
        whatWorked: result.whatWorked,
        language: round.language,
        bodyTranslated: null,
        modelId: deps.generator.modelId,
        promptVersion,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
      })
      .onConflictDoNothing({ target: s.roundFeedback.roundId })
      .returning();
    feedback ??= await existingFeedback(deps.db, round.id);
  } catch (error) {
    return { ok: false, response: writeFailed("round_feedback_write_failed", error, { round_id: round.id }) };
  }
  log("info", {
    event: "round_feedback_written",
    round_id: round.id,
    ...counts,
    tokens_in: result.tokensIn,
    tokens_out: result.tokensOut,
    duration_ms: elapsed(),
  });
  return { ok: true, feedback: feedback!, counts };
}

const completeSchema = z.strictObject({ felt_pressure: z.int().min(1).max(5).optional() });

export function createComplete(deps: CompleteDeps) {
  return async function POST(request: Request, roundId: string): Promise<Response> {
    const session = await authenticate(deps, request, "complete");
    if (session instanceof Response) return session;
    const { userId } = session;
    if (!isUuid(roundId)) return notFound("round");

    const body = await parseBody(request, completeSchema);
    if (body instanceof Response) return body;
    const pressure = body.felt_pressure ?? null;

    let closed: RoundRow | Response;
    try {
      // Step 1: the rating and completed_at, committed before anything else happens.
      closed = await deps.transaction(async (tx): Promise<RoundRow | Response> => {
        const [round] = await tx
          .select()
          .from(s.rounds)
          .where(and(eq(s.rounds.id, roundId), eq(s.rounds.userId, userId)))
          .for("update");
        if (!round) return notFound("round");
        if (round.completedAt !== null) {
          // The envelope's detail is flat (07 §2), so it says whether feedback exists, not what it is:
          // screen 8 reads it from the round.
          const existing = await existingFeedback(tx, roundId);
          return apiError("round_already_complete", "The round is already complete.", {
            round_id: roundId,
            has_feedback: existing !== null,
          });
        }
        if (round.mode === "realistic" && pressure === null) {
          return apiError("pressure_required", "A realistic round needs its felt-pressure rating.", { round_id: roundId });
        }
        if (round.mode === "practice" && pressure !== null) {
          return apiError("pressure_not_applicable", "A practice round records no felt pressure.", { round_id: roundId });
        }
        const step = roundStep(round, await roundAnswers(tx, roundId));
        if (step.kind === "answer") {
          return apiError("round_not_complete", "Not every question in the round is answered.", {
            round_id: roundId,
            position: step.position,
          });
        }
        const [updated] = await tx
          .update(s.rounds)
          .set({ feltPressure: pressure, completedAt: new Date() })
          .where(and(eq(s.rounds.id, roundId), isNull(s.rounds.completedAt)))
          .returning();
        return updated;
      });
    } catch (error) {
      return writeFailed("round_complete_failed", error, { round_id: roundId });
    }
    if (closed instanceof Response) return closed;
    log("info", { event: "round_completed", round_id: roundId, felt_pressure: pressure });

    const outcome = await writeRoundFeedback(deps, closed);
    if (!outcome.ok) return outcome.response;
    return Response.json(
      {
        round: { id: closed.id, completed_at: closed.completedAt!.toISOString(), felt_pressure: closed.feltPressure },
        feedback: feedbackView(outcome.feedback),
        scoring: outcome.counts,
      },
      { status: 201 },
    );
  };
}

/** `POST /api/rounds/{roundId}/feedback` ⚡ (07 §5.16): the retry for step 3, and nothing else. */
export function createFeedbackRetry(deps: CompleteDeps) {
  return async function POST(request: Request, roundId: string): Promise<Response> {
    const session = await authenticate(deps, request, "feedback");
    if (session instanceof Response) return session;
    const { userId } = session;
    if (!isUuid(roundId)) return notFound("round");

    const [round] = await deps.db
      .select()
      .from(s.rounds)
      .where(and(eq(s.rounds.id, roundId), eq(s.rounds.userId, userId)));
    if (!round) return notFound("round");
    if (round.completedAt === null) {
      return apiError("round_not_complete", "The round is not complete.", { round_id: roundId });
    }
    // A round with feedback returns it and makes no model call.
    const existing = await existingFeedback(deps.db, roundId);
    if (existing) return Response.json({ feedback: feedbackView(existing) });

    const outcome = await writeRoundFeedback(deps, round);
    if (!outcome.ok) return outcome.response;
    return Response.json({ feedback: feedbackView(outcome.feedback) }, { status: 201 });
  };
}
