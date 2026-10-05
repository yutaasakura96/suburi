import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import * as s from "../../db/schema";
import { apiError } from "../api/errors";
import type { AnswerScorer } from "../ai/score";
import type { Rubric } from "../rubric/types";
import { authenticate, isUuid, log, notFound, parseBody, writeFailed, type Db, type RoundDeps } from "./http";
import { runScoringAttempt, type ScoringRunDeps } from "./run-scoring";
import { newerRoundExists } from "./state";
import { roundStatus } from "./status";

/**
 * History's retry, **for one answer alone** (07 §5.10–§5.11): `POST /api/scoring-attempts` writes a
 * new pending attempt beside the failed one, and `POST /api/scoring-attempts/{id}/run` performs it.
 *
 * **Neither touches `round_feedback`.** The round's feedback was written without the unscored answer
 * and is permanent; a score that lands later appears in History's matrix and nowhere else
 * (06, 2026-09-28).
 */
export interface ScoringAttemptDeps extends RoundDeps {
  readonly scorer: AnswerScorer;
}

const createSchema = z.strictObject({ answer_id: z.uuid() });

/**
 * `POST /api/scoring-attempts` ⚡: **a new row, never an overwrite** (04 `scoring_attempts`), and only
 * for an answer whose latest attempt ended `failed`. An `ok` score is not re-rollable from the UI, and
 * a `pending` one is driven by `run`, not replaced: either is `422 scoring_not_retryable`.
 *
 * **Every stamp is server-derived** (07 §1 rule 6): the CV and rubric versions are the round's, stamp 3
 * is the question's or the follow-up's as on the first attempt, and the model and scoring prompt are
 * the ones pinned today — which is how a retry made after either changed lands on the right side of
 * Progress's boundary.
 */
export function createPostScoringAttempt(deps: ScoringAttemptDeps) {
  return async function POST(request: Request): Promise<Response> {
    const session = await authenticate(deps, request, "scoring-attempts");
    if (session instanceof Response) return session;
    const { userId } = session;

    const body = await parseBody(request, createSchema);
    if (body instanceof Response) return body;
    const answerId = body.answer_id;

    // A bank question's answer joins its question; a follow-up's joins the follow-up it answers.
    const [row] = await deps.db
      .select({ answer: s.answers, round: s.rounds, question: s.questions, asked: s.followUps })
      .from(s.answers)
      .innerJoin(s.rounds, eq(s.rounds.id, s.answers.roundId))
      .leftJoin(s.questions, eq(s.questions.id, s.answers.questionId))
      .leftJoin(s.followUps, eq(s.followUps.parentAnswerId, s.answers.parentAnswerId))
      .where(and(eq(s.answers.id, answerId), eq(s.answers.userId, userId)));
    if (!row) return notFound("answer");
    const { round } = row;

    const promptVersion = deps.scorer.promptVersions[round.language];
    if (!promptVersion) throw new Error(`No scoring prompt for ${round.language}`);
    const generatorPromptVersion = row.question?.generatorPromptVersion ?? row.asked?.promptVersion;
    if (!generatorPromptVersion) throw new Error("An answer with neither a question nor a follow-up row");

    let created: typeof s.scoringAttempts.$inferSelect | Response;
    try {
      created = await deps.transaction(async (tx): Promise<typeof s.scoringAttempts.$inferSelect | Response> => {
        // The answer's row is the lock: two retries of one answer cannot both see `failed` and both insert.
        await tx.select({ id: s.answers.id }).from(s.answers).where(eq(s.answers.id, answerId)).for("update");
        const [latest] = await tx
          .select({ id: s.scoringAttempts.id, status: s.scoringAttempts.status })
          .from(s.scoringAttempts)
          .where(eq(s.scoringAttempts.answerId, answerId))
          .orderBy(desc(s.scoringAttempts.createdAt))
          .limit(1);
        if (latest?.status !== "failed") {
          return apiError("scoring_not_retryable", "Only an answer whose latest score failed can be retried.", {
            answer_id: answerId,
            ...(latest ? { attempt_id: latest.id, status: latest.status } : {}),
          });
        }
        const [attempt] = await tx
          .insert(s.scoringAttempts)
          .values({
            answerId,
            userId,
            status: "pending",
            cvVersionId: round.cvVersionId,
            rubricVersionId: round.rubricVersionId,
            generatorPromptVersion,
            modelId: deps.scorer.modelId,
            scoringPromptVersion: promptVersion,
            // Meant to become the displayed score, unlike a held-out re-score (04).
            isSuperseding: true,
          })
          .returning();
        return attempt;
      });
    } catch (error) {
      return writeFailed("scoring_attempt_write_failed", error, { answer_id: answerId });
    }
    if (created instanceof Response) return created;

    log("info", { event: "scoring_attempt_created", attempt_id: created.id, answer_id: answerId, is_superseding: true });
    return Response.json(
      {
        attempt_id: created.id,
        answer_id: answerId,
        status: created.status,
        is_superseding: created.isSuperseding,
        stamps: {
          cv_version_id: created.cvVersionId,
          rubric_version_id: created.rubricVersionId,
          generator_prompt_version: created.generatorPromptVersion,
          model_id: created.modelId,
          scoring_prompt_version: created.scoringPromptVersion,
        },
      },
      { status: 201 },
    );
  };
}

/**
 * The attempt as it stands (07 §5.10). **No total, average or overall**: there is no field for one.
 * `withheld` leaves out everything a score would say — a realistic round shows no score, flag or hint
 * until it is complete (US-8, 07 §5.5), and this response is no way around that.
 */
async function attemptView(db: Db, attemptId: string, { withheld }: { withheld: boolean }) {
  const [row] = await db
    .select({ attempt: s.scoringAttempts, rubric: s.rubricVersions })
    .from(s.scoringAttempts)
    .innerJoin(s.rubricVersions, eq(s.rubricVersions.id, s.scoringAttempts.rubricVersionId))
    .where(eq(s.scoringAttempts.id, attemptId));
  const { attempt } = row;
  const view = { attempt_id: attempt.id, answer_id: attempt.answerId, status: attempt.status };
  if (attempt.status !== "ok" || withheld) return view;

  const [scores, citations, flags] = await Promise.all([
    db.select().from(s.scores).where(eq(s.scores.scoringAttemptId, attemptId)),
    // An answer cites a claim once per relation, whichever attempt saw it first (04).
    db
      .select({ claimId: s.claimCitations.cvClaimId, relation: s.claimCitations.relation })
      .from(s.claimCitations)
      .where(eq(s.claimCitations.answerId, attempt.answerId))
      .orderBy(asc(s.claimCitations.createdAt), asc(s.claimCitations.id)),
    db
      .select()
      .from(s.answerFlags)
      .where(eq(s.answerFlags.scoringAttemptId, attemptId))
      .orderBy(asc(s.answerFlags.spanStart)),
  ]);
  // In the rubric's own order, never keyed by dimension (07 §4).
  const order = (row.rubric.dimensions as Rubric["dimensions"]).map((dimension) => dimension.key as string);
  return {
    ...view,
    scores: scores
      .sort((a, b) => order.indexOf(a.dimension) - order.indexOf(b.dimension))
      .map((score) => ({ dimension: score.dimension, value: score.value })),
    citations: citations.map((citation) => ({ cv_claim_id: citation.claimId, relation: citation.relation })),
    flags: flags.map((flag) => ({ kind: flag.kind, span_start: flag.spanStart, span_end: flag.spanEnd })),
    answered_language: attempt.answeredLanguage,
    tokens_in: attempt.tokensIn,
    tokens_out: attempt.tokensOut,
  };
}

export interface RunScoringDeps extends RoundDeps, ScoringRunDeps {
  /** When this invocation must be finished by: its start plus the route's `maxDuration`, less a margin. */
  readonly deadline: () => number;
}

/**
 * `POST /api/scoring-attempts/{attemptId}/run` ⚡: drives a pending attempt to completion by hand —
 * the one History just created, or one `submit`'s `after()` left pending when its function died.
 *
 * **Idempotent and abandon-safe.** Only `pending` transitions: a finished attempt is returned as it
 * stands and nothing is called, and a run already in flight is `409 scoring_in_progress`. A run that
 * spends its retries marks the attempt `failed` and answers `502 scoring_failed`.
 */
export function createRunScoringAttempt(deps: RunScoringDeps) {
  return async function POST(request: Request, attemptId: string): Promise<Response> {
    const session = await authenticate(deps, request, "scoring-run");
    if (session instanceof Response) return session;
    const { userId } = session;
    if (!isUuid(attemptId)) return notFound("scoring attempt");

    const [row] = await deps.db
      .select({ attempt: s.scoringAttempts, round: s.rounds })
      .from(s.scoringAttempts)
      .innerJoin(s.answers, eq(s.answers.id, s.scoringAttempts.answerId))
      .innerJoin(s.rounds, eq(s.rounds.id, s.answers.roundId))
      .where(and(eq(s.scoringAttempts.id, attemptId), eq(s.scoringAttempts.userId, userId)));
    if (!row) return notFound("scoring attempt");
    const { attempt, round } = row;
    const ids = { attempt_id: attemptId, answer_id: attempt.answerId };

    const outcome = attempt.status === "pending" ? await runScoringAttempt(deps, attemptId, { deadline: deps.deadline() }) : "skipped";
    if (outcome === "in_flight") {
      return apiError("scoring_in_progress", "This attempt is already being scored.", ids);
    }
    if (outcome === "failed") {
      const [failed] = await deps.db
        .select({ errorClass: s.scoringAttempts.errorClass })
        .from(s.scoringAttempts)
        .where(eq(s.scoringAttempts.id, attemptId));
      return apiError("scoring_failed", "Scoring failed; the answer is kept and can be retried.", {
        ...ids,
        error_class: failed?.errorClass ?? "unexpected",
      });
    }
    const withheld =
      round.mode === "realistic" &&
      roundStatus(round, { newerRoundExists: await newerRoundExists(deps.db, round), now: new Date() }) === "in_progress";
    return Response.json(await attemptView(deps.db, attemptId, { withheld }));
  };
}
