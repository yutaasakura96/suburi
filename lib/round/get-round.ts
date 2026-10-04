import { asc, eq, inArray } from "drizzle-orm";
import * as s from "../../db/schema";
import { apiError } from "../api/errors";
import type { Rubric } from "../rubric/types";
import { authenticate, guarded, isUuid, notFound, roundIdOf, type RoundDeps } from "./http";
import { getRound, latestAttempts, newerRoundExists, roundAnswers, roundFollowUps, roundStep, type AnswerRow, type RoundStep } from "./state";
import { roundStatus } from "./status";
import { nextPrompt } from "./submit";

/**
 * `GET /api/rounds/{roundId}` (07 §5.5): resume. Where a round is and what it is asking are database
 * facts (03 §7), so this reads them and decides nothing: `prompt` is the stored question or follow-up,
 * never one chosen or generated again, and `resume.at` names which of the four calls comes next.
 *
 * **Only the newest open round started today — the user's day, Asia/Tokyo — resumes.** An abandoned
 * round, like a complete one, returns `resume: null` and no prompt: it is read-only.
 *
 * **Scores in the read are practice's** (06, 2026-09-27): each submitted answer's `scoring` carries
 * its `scores`, in the rubric's order, and its `flags` once `ok`. **A realistic round's read carries
 * status only until the round is complete** — US-8 forbids any score mid-round, and the fields are
 * left out of the response rather than hidden by the client.
 */
export type AnswerState = "open" | "uploaded" | "transcribed" | "submitted";

/** Derived, not stored (07 §5.5). The key is written when the slot opens, so a row reads `uploaded` from then. */
export function answerState(answer: Pick<AnswerRow, "audioS3Key" | "transcriptRaw" | "transcriptCorrected">): AnswerState {
  if (answer.transcriptCorrected !== null) return "submitted";
  if (answer.transcriptRaw !== null) return "transcribed";
  return answer.audioS3Key !== null ? "uploaded" : "open";
}

export type Resume =
  | { readonly at: "answers" }
  | { readonly at: "transcribe" | "submit"; readonly answer_id: string }
  | { readonly at: "complete" };

/** Which call the round is waiting for. A submitted answer whose follow-up is not stored resumes at `submit`. */
export function resumeAt(step: RoundStep): Resume | null {
  if (step.kind === "complete") return null;
  if (step.kind === "follow_up_due") return { at: "submit", answer_id: step.parent.id };
  if (step.kind !== "answer") return { at: "complete" };
  if (!step.answer) return { at: "answers" };
  return { at: step.answer.transcriptRaw === null ? "transcribe" : "submit", answer_id: step.answer.id };
}

export function createGetRound(deps: RoundDeps) {
  return guarded("round_read_failed", async function GET(request: Request, roundId: string): Promise<Response> {
    const session = await authenticate(deps, request);
    if (session instanceof Response) return session;
    const { userId } = session;
    if (!isUuid(roundId)) return notFound("round");
    // The read takes no parameters, and an unknown one is refused, not ignored (07 §4).
    const parameters = [...new Set(new URL(request.url).searchParams.keys())];
    if (parameters.length > 0) {
      return apiError("invalid_request", "This route takes no query parameters.", { fields: parameters });
    }

    const round = await getRound(deps.db, userId, roundId);
    if (!round) return notFound("round");
    const [answers, followUps, newer] = await Promise.all([
      roundAnswers(deps.db, round.id),
      roundFollowUps(deps.db, round.id),
      newerRoundExists(deps.db, round),
    ]);
    const step = roundStep(round, answers, followUps);
    const status = roundStatus(round, { newerRoundExists: newer, now: new Date() });
    const attempts = await latestAttempts(
      deps.db,
      answers.filter((answer) => answer.transcriptCorrected !== null).map((answer) => answer.id),
    );

    // US-8: a realistic round's scores stay out of the response until it is complete.
    const scored = round.mode === "practice" || status === "complete" ? [...attempts.values()].filter((attempt) => attempt.status === "ok") : [];
    const scoredIds = scored.map((attempt) => attempt.id);
    const [scoreRows, flagRows, [rubricRow]] =
      scoredIds.length === 0
        ? [[], [], []]
        : await Promise.all([
            deps.db.select().from(s.scores).where(inArray(s.scores.scoringAttemptId, scoredIds)),
            deps.db
              .select()
              .from(s.answerFlags)
              .where(inArray(s.answerFlags.scoringAttemptId, scoredIds))
              .orderBy(asc(s.answerFlags.spanStart)),
            deps.db.select().from(s.rubricVersions).where(eq(s.rubricVersions.id, round.rubricVersionId)),
          ]);
    // The rubric's own order: it is part of the rubric version (07 §4).
    const order = ((rubricRow?.dimensions ?? []) as Rubric["dimensions"]).map((dimension) => dimension.key as string);

    const scoringOf = (answer: AnswerRow) => {
      const attempt = attempts.get(answer.id);
      if (!attempt) return {};
      const scoring = { attempt_id: attempt.id, status: attempt.status };
      if (!scoredIds.includes(attempt.id)) return { scoring };
      return {
        scoring: {
          ...scoring,
          scores: scoreRows
            .filter((score) => score.scoringAttemptId === attempt.id)
            .sort((a, b) => order.indexOf(a.dimension) - order.indexOf(b.dimension))
            .map((score) => ({ dimension: score.dimension, value: score.value })),
          flags: flagRows
            .filter((flag) => flag.scoringAttemptId === attempt.id)
            .map((flag) => ({ kind: flag.kind, span_start: flag.spanStart, span_end: flag.spanEnd })),
        },
      };
    };

    // An abandoned round asks nothing more: no prompt and no call to resume at.
    const open = status === "in_progress" && step.kind !== "follow_up_due" && step.kind !== "complete";
    const { next, progress } = open ? await nextPrompt(deps.db, round, step) : { next: null, progress: null };

    return Response.json({
      round: {
        id: round.id,
        round_type: round.roundType,
        language: round.language,
        mode: round.mode,
        length: round.length,
        per_answer_cap_seconds: round.perAnswerCapSeconds,
        started_at: round.startedAt.toISOString(),
        completed_at: round.completedAt?.toISOString() ?? null,
        status,
      },
      answers: answers.map((answer) => ({
        id: answer.id,
        position: answer.position,
        kind: answer.questionId === null ? "follow_up" : "question",
        state: answerState(answer),
        ...scoringOf(answer),
      })),
      prompt: next && (next.kind === "question" || next.kind === "follow_up") ? next : null,
      progress,
      resume: status === "in_progress" ? resumeAt(step) : null,
    });
  }, roundIdOf);
}
