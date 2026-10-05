import { and, eq, inArray } from "drizzle-orm";
import * as s from "../../db/schema";
import { apiError } from "../api/errors";
import type { ModelAnswerGenerator } from "../ai/model-answer";
import { translationLanguage } from "../ai/round-feedback";
import { ModelCallFailed } from "../ai/upstream";
import type { Span } from "../cv/spans";
import type { Rubric, RubricLanguage } from "../rubric/types";
import { loadRoleContext } from "./generate-candidates";
import { locatedModelAnswer } from "./model-answer-spans";
import { authenticate, isUuid, log, notFound, pgErrorClass, writeFailed, type RoundDeps } from "./http";
import { citableClaimsOf } from "./run-scoring";
import { roundAnswers, type RoundRow } from "./state";

/**
 * A completed round's **model answers** (04 `model_answers`, 06 2026-10-04): for each question the
 * round asked — a bank question or a follow-up — how it could have been answered from the record the
 * candidate really has. One row per answer, **written once and never rewritten**, so what is reviewed
 * later is what was written at the round's end.
 *
 * **Which answers:** every submitted answer of the round that is not a practice "answer again" — a
 * retry is the same question, and the question has its model answer already.
 *
 * **What a call reads** is the round's own: the CV version it was scored against, as the claims a
 * scorer may cite (`run-scoring.ts`), its role context, its rubric, and what the candidate said. It
 * reads no score, so nothing here waits for scoring, and an answer whose score failed has one too.
 *
 * **One call per answer, side by side, each on its own.** A call that fails leaves its answer without
 * a row and takes nothing else with it; the feedback screen states the gap and offers the retry
 * (07 §5.19), which writes only what is still lacking. A call that is merely slow is not waited for
 * past `MODEL_ANSWER_WAIT_MS`: the feedback goes out, and the row lands behind it.
 *
 * **What the CV does not back is stored as spans of the stored body**, found there verbatim from the
 * model's own quotes (`grounding.ts`): dropped when not found, never clamped, and counted in the log
 * line. The figure check's spans are merged in beside them (`model-answer-spans.ts`). Nothing here
 * logs a question, an answer or a model's words (12 §7).
 */

/**
 * One call's limit. `model-answer-en-1.0` measured 11.2 s at the median and 30.4 s at the slowest of
 * 30 calls, `model-answer-ja-1.0` 17.3 s and 31.6 s of 20 (03 §4, 2026-10-04): a minute and a half is
 * nearly three times the slowest call seen.
 */
export const MODEL_ANSWER_TIMEOUT_MS = 90_000;

/**
 * How long `complete` waits for the round's model answers, **counted from the round's close**: past it
 * the feedback is not held back, and a call still running is stored behind the response, in
 * `after()`. A round's calls took 31.6 s at the slowest of ten rounds (03 §4), so this covers every
 * round measured with room to spare, and it is spent beside the feedback call's own wait, not after
 * it.
 */
export const MODEL_ANSWER_WAIT_MS = 45_000;

export interface ModelAnswerDeps extends RoundDeps {
  readonly modelAnswerGenerator: ModelAnswerGenerator;
}

/** `model_answers.body_translated` as stored (04): the other language, the answer in it, and its marks. */
export interface TranslatedModelAnswer {
  readonly language: RubricLanguage;
  readonly body: string;
  readonly unsupported_spans: readonly Span[];
}

type NewModelAnswer = typeof s.modelAnswers.$inferInsert;

type CallOutcome =
  | { readonly ok: true; readonly row: NewModelAnswer; readonly spans: number; readonly dropped: number }
  | { readonly ok: false; readonly errorClass: string };

/** The calls for every answer of a round that has no model answer yet, already running. */
interface StartedCalls {
  /** One per answer, in the round's order. None rejects: a failure is an outcome. */
  readonly calls: readonly Promise<CallOutcome>[];
  readonly claims: number;
  readonly claimsRejected: number;
  readonly started: number;
}

export interface GeneratedModelAnswers {
  readonly rows: readonly NewModelAnswer[];
  /** Calls that failed: each leaves its answer without a model answer. */
  readonly failed: number;
  /** The class of the first failure, for the envelope; null when none failed. */
  readonly errorClass: string | null;
}

/** Starts the model call for every answer of the round that has no model answer yet. Writes nothing. */
async function startCalls(deps: ModelAnswerDeps, round: RoundRow): Promise<StartedCalls> {
  const started = performance.now();
  const none = { calls: [], claims: 0, claimsRejected: 0, started };
  const answers = (await roundAnswers(deps.db, round.id)).filter(
    (answer) => answer.transcriptCorrected !== null && answer.retryOfAnswerId === null,
  );
  if (answers.length === 0) return none;
  const have = new Set(
    (
      await deps.db
        .select({ answerId: s.modelAnswers.answerId })
        .from(s.modelAnswers)
        .where(inArray(s.modelAnswers.answerId, answers.map((answer) => answer.id)))
    ).map((row) => row.answerId),
  );
  const wanted = answers.filter((answer) => !have.has(answer.id));
  if (wanted.length === 0) return none;

  const [[rubricRow], cv, roleContext] = await Promise.all([
    deps.db.select().from(s.rubricVersions).where(eq(s.rubricVersions.id, round.rubricVersionId)),
    citableClaimsOf(deps.db, round.cvVersionId),
    loadRoleContext(deps.db, round.roleContextId),
  ]);
  const rubric: Rubric = {
    versionLabel: rubricRow.versionLabel,
    language: rubricRow.language,
    dimensions: rubricRow.dimensions as Rubric["dimensions"],
  };
  const translatedInto = translationLanguage(round.language);
  const { modelId } = deps.modelAnswerGenerator;
  const promptVersion = deps.modelAnswerGenerator.promptVersions[round.language];

  const calls = wanted.map(async (answer): Promise<CallOutcome> => {
    const parent = answer.parentAnswerId === null ? null : answers.find((other) => other.id === answer.parentAnswerId);
    try {
      const result = await deps.modelAnswerGenerator.generate(
        {
          rubric,
          roundType: round.roundType,
          roleContext,
          claims: cv.claims.map((claim) => claim.text),
          prompt: answer.promptText,
          // The corrected text, never the raw one (03 §4).
          answer: answer.transcriptCorrected ?? "",
          parent: parent ? { prompt: parent.promptText, answer: parent.transcriptCorrected ?? "" } : null,
        },
        { timeoutMs: MODEL_ANSWER_TIMEOUT_MS },
      );
      const evidence = [answer.transcriptCorrected ?? "", parent?.transcriptCorrected ?? ""].join("\n");
      const own = locatedModelAnswer(result, cv.body, evidence);
      const other = translatedInto && result.translated ? locatedModelAnswer(result.translated, cv.body, evidence) : null;
      const bodyTranslated: TranslatedModelAnswer | null =
        translatedInto && other ? { language: translatedInto, body: other.body, unsupported_spans: other.spans } : null;
      const row: NewModelAnswer = {
        answerId: answer.id,
        userId: round.userId,
        body: own.body,
        unsupportedSpans: own.spans,
        bodyTranslated,
        modelId,
        promptVersion,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
      };
      return { ok: true, row, spans: own.spans.length, dropped: own.dropped + (other?.dropped ?? 0) };
    } catch (error) {
      const errorClass = error instanceof ModelCallFailed ? error.errorClass : "unexpected";
      log("error", { event: "model_answer_call_failed", round_id: round.id, answer_id: answer.id, error_class: errorClass });
      return { ok: false, errorClass };
    }
  });
  return { calls, claims: cv.claims.length, claimsRejected: cv.rejected, started };
}

/** What a set of finished calls produced, and the one log line that says so: counts, never text. */
function collect(round: RoundRow, started: StartedCalls, outcomes: readonly CallOutcome[]): GeneratedModelAnswers {
  const generated = outcomes.flatMap((outcome) => (outcome.ok ? [outcome] : []));
  const failures = outcomes.flatMap((outcome) => (outcome.ok ? [] : [outcome.errorClass]));
  if (outcomes.length === 0) return { rows: [], failed: 0, errorClass: null };
  const sum = (pick: (outcome: (typeof generated)[number]) => number | null | undefined) =>
    generated.reduce((total, outcome) => total + (pick(outcome) ?? 0), 0);
  log(failures.length > 0 ? "error" : "info", {
    event: "model_answers_generated",
    round_id: round.id,
    wanted: started.calls.length,
    generated: generated.length,
    failed: failures.length,
    claims: started.claims,
    claims_rejected: started.claimsRejected,
    unsupported_spans: sum((outcome) => outcome.spans),
    unsupported_dropped: sum((outcome) => outcome.dropped),
    tokens_in: sum((outcome) => outcome.row.tokensIn),
    tokens_out: sum((outcome) => outcome.row.tokensOut),
    duration_ms: Math.round(performance.now() - started.started),
  });
  return { rows: generated.map((outcome) => outcome.row), failed: failures.length, errorClass: failures[0] ?? null };
}

/** The model calls for every answer of the round that has no model answer yet, all finished. Writes nothing. */
export async function generateModelAnswers(deps: ModelAnswerDeps, round: RoundRow): Promise<GeneratedModelAnswers> {
  const started = await startCalls(deps, round);
  return collect(round, started, await Promise.all(started.calls));
}

/**
 * Writes what was generated, once: an answer a concurrent call wrote first keeps its row. Throws when
 * the write fails — one transaction, so nothing is half-written.
 */
export async function storeModelAnswers(deps: ModelAnswerDeps, generated: GeneratedModelAnswers) {
  if (generated.rows.length === 0) return { written: 0, failed: generated.failed };
  const inserted = await deps.transaction((tx) =>
    tx
      .insert(s.modelAnswers)
      .values([...generated.rows])
      .onConflictDoNothing({ target: s.modelAnswers.answerId })
      .returning({ id: s.modelAnswers.id }),
  );
  return { written: inserted.length, failed: generated.failed };
}

/**
 * `POST /api/rounds/{roundId}/model-answers` ⚡ (07 §5.19): writes the model answers a complete round
 * still lacks, and nothing else — `complete`'s failed calls, or every one for a round that was
 * completed before model answers existed. A round that lacks none makes no model call.
 */
export function createModelAnswersRetry(deps: ModelAnswerDeps) {
  return async function POST(request: Request, roundId: string): Promise<Response> {
    const session = await authenticate(deps, request, "model-answers");
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

    const generated = await generateModelAnswers(deps, round);
    let stored;
    try {
      stored = await storeModelAnswers(deps, generated);
    } catch (error) {
      return writeFailed("model_answers_write_failed", error, { round_id: roundId });
    }
    if (stored.failed > 0) {
      return apiError("model_answer_generation_failed", "Not every model answer was written; the round is complete.", {
        round_id: roundId,
        written: stored.written,
        failed: stored.failed,
        error_class: generated.errorClass ?? "unexpected",
      });
    }
    return Response.json({ model_answers: stored }, { status: stored.written > 0 ? 201 : 200 });
  };
}

export interface CompleteModelAnswerDeps extends ModelAnswerDeps {
  /** Next's `after`: where a call still running when `complete` answers is stored. */
  readonly after: (work: () => Promise<unknown>) => void;
  /** `MODEL_ANSWER_WAIT_MS`, unless a test shortens it. */
  readonly modelAnswerWaitMs?: number;
}

const expired = Symbol("expired");

/**
 * `complete`'s half (07 §5.12): the calls start when the round closes, beside the wait for the last
 * score and the feedback call, and what they wrote is stored once the feedback is. **Never a reason
 * to fail the round's completion, and never a reason to hold its feedback back**: a failure is a
 * count in the response and a gap the feedback screen states, and a call still running
 * `MODEL_ANSWER_WAIT_MS` after the close is `pending` — stored behind the response, in `after()`.
 */
export function startModelAnswers(deps: CompleteModelAnswerDeps, round: RoundRow) {
  const waitMs = deps.modelAnswerWaitMs ?? MODEL_ANSWER_WAIT_MS;
  const starting = startCalls(deps, round).catch((error) => {
    log("error", { event: "model_answers_generation_failed", round_id: round.id, error_class: pgErrorClass(error) });
    return null;
  });
  const store = async (started: StartedCalls, outcomes: readonly CallOutcome[]) => {
    const generated = collect(round, started, outcomes);
    try {
      return await storeModelAnswers(deps, generated);
    } catch (error) {
      log("error", { event: "model_answers_write_failed", round_id: round.id, error_class: pgErrorClass(error) });
      return { written: 0, failed: generated.failed + generated.rows.length };
    }
  };
  return async function settle(): Promise<{ written: number; failed: number; pending: number }> {
    const started = await starting;
    if (started === null) return { written: 0, failed: 0, pending: 0 };
    const left = Math.max(0, waitMs - (performance.now() - started.started));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeUp = new Promise<typeof expired>((resolve) => {
      timer = setTimeout(() => resolve(expired), left);
    });
    // A call that has finished wins the race however little time is left.
    const settled = await Promise.all(started.calls.map((call) => Promise.race([call, timeUp])));
    clearTimeout(timer);
    const finished = settled.filter((outcome) => outcome !== expired);
    const late = started.calls.filter((_, index) => settled[index] === expired);
    const stored = await store(started, finished);
    if (late.length > 0) deps.after(async () => store(started, await Promise.all(late)));
    return { ...stored, pending: late.length };
  };
}
