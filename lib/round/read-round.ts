import { asc, eq, inArray } from "drizzle-orm";
import * as s from "../../db/schema";
import { apiError } from "../api/errors";
import type { Rubric } from "../rubric/types";
import { authenticate, guarded, isUuid, notFound, roundIdOf, type Db, type RoundDeps } from "./http";
import {
  answerState,
  getRound,
  latestAttempts,
  newerRoundExists,
  openRetry,
  roundAnswers,
  roundFollowUps,
  roundStep,
  type AnswerRow,
  type RoundRow,
  type RoundStep,
} from "./state";
import { roundStatus } from "./status";
import { nextPrompt } from "./submit";

/**
 * `GET /api/rounds/{roundId}` (07 §5.5): resume. Where the round is and what it is asking, from stored
 * rows — nothing here selects, generates or writes, and `resume.at` names which call comes next.
 *
 * **Only the newest open round started today — the user's day, Asia/Tokyo — resumes.** An abandoned
 * round, like a complete one, returns `resume: null` and no prompt: it is read-only.
 *
 * **Scores in the read, practice only** (06, 2026-09-27). A practice round's submitted answers carry
 * their scores, flags and answered language once `ok`: what practice's per-answer frame shows, and
 * what it polls for. **A realistic round's read carries the status and nothing else until the round
 * is complete** — US-8 forbids a score, a flag or a hint mid-round, and leaving the fields out of the
 * response is what makes that structural rather than a client courtesy.
 *
 * **Scores are an array in the rubric's own order, never an object, and nothing combines them** (07
 * §4, PRD §9).
 */

/** An answer's `scoring` in the read. The three optional fields exist only where the round may show them. */
export interface ScoringRead {
  readonly attempt_id: string;
  readonly status: "pending" | "ok" | "failed";
  readonly scores?: readonly { readonly dimension: string; readonly value: number }[];
  /** Spans into the answer's corrected text, in the order they stand in it (04 `answer_flags`). */
  readonly flags?: readonly { readonly kind: string; readonly span_start: number; readonly span_end: number }[];
  /** The language the scorer read the answer in; null on an attempt from before the CV check. */
  readonly answered_language?: string | null;
}

/** Whether this round's read may carry scores yet: always in practice, in realistic only once complete. */
export function showsScores(round: Pick<RoundRow, "mode" | "completedAt">) {
  return round.mode === "practice" || round.completedAt !== null;
}

/**
 * Each submitted answer's `scoring`, by answer id, from its latest attempt (04 §3). With `scores`
 * false the attempt's id and status are all that leave: the realistic round's silence.
 */
export async function scoringReads(
  db: Pick<Db, "select" | "execute">,
  round: Pick<RoundRow, "rubricVersionId">,
  answers: readonly AnswerRow[],
  { scores }: { readonly scores: boolean },
): Promise<Map<string, ScoringRead>> {
  const attempts = await latestAttempts(
    db,
    answers.filter((answer) => answer.transcriptCorrected !== null).map((answer) => answer.id),
  );
  const reads = new Map<string, ScoringRead>();
  for (const [answerId, attempt] of attempts) reads.set(answerId, { attempt_id: attempt.id, status: attempt.status });
  const ok = [...attempts.values()].filter((attempt) => attempt.status === "ok");
  if (!scores || ok.length === 0) return reads;

  const okIds = ok.map((attempt) => attempt.id);
  const [[rubric], scoreRows, flagRows] = await Promise.all([
    db.select({ dimensions: s.rubricVersions.dimensions }).from(s.rubricVersions).where(eq(s.rubricVersions.id, round.rubricVersionId)),
    db.select().from(s.scores).where(inArray(s.scores.scoringAttemptId, okIds)),
    db.select().from(s.answerFlags).where(inArray(s.answerFlags.scoringAttemptId, okIds)).orderBy(asc(s.answerFlags.spanStart)),
  ]);
  const order = (rubric.dimensions as Rubric["dimensions"]).map((dimension) => dimension.key as string);
  for (const attempt of ok) {
    reads.set(attempt.answerId, {
      attempt_id: attempt.id,
      status: "ok",
      scores: scoreRows
        .filter((row) => row.scoringAttemptId === attempt.id)
        .sort((a, b) => order.indexOf(a.dimension) - order.indexOf(b.dimension))
        .map((row) => ({ dimension: row.dimension, value: row.value })),
      flags: flagRows
        .filter((row) => row.scoringAttemptId === attempt.id)
        .map((row) => ({ kind: row.kind, span_start: row.spanStart, span_end: row.spanEnd })),
      answered_language: attempt.answeredLanguage,
    });
  }
  return reads;
}

const kindOf = (answer: Pick<AnswerRow, "questionId">) => (answer.questionId === null ? "follow_up" : "question");

export type Resume =
  | { readonly at: "answers" }
  | { readonly at: "upload" | "transcribe" | "transcript" | "submit"; readonly answer_id: string }
  | { readonly at: "complete" };

/**
 * Which of an open answer's calls comes next (07 §5.5). A slot opened as typed has no key and takes
 * no upload, so it resumes at `transcript`; a reserved key never proves the PUT landed.
 */
function answerResume(answer: AnswerRow): Resume {
  if (answer.transcriptRaw !== null) return { at: "submit", answer_id: answer.id };
  if (answer.audioS3Key === null) return { at: "transcript", answer_id: answer.id };
  return { at: answer.audioUploadedAt === null ? "upload" : "transcribe", answer_id: answer.id };
}

/** Which call the round is waiting for. A submitted answer whose follow-up is not stored resumes at `submit`. */
export function resumeAt(step: RoundStep): Resume | null {
  if (step.kind === "complete") return null;
  if (step.kind === "follow_up_due") return { at: "submit", answer_id: step.parent.id };
  if (step.kind !== "answer") return { at: "complete" };
  return step.answer ? answerResume(step.answer) : { at: "answers" };
}

export function createGetRound(deps: Pick<RoundDeps, "auth" | "db">) {
  return guarded("round_read_failed", async function GET(request: Request, roundId: string): Promise<Response> {
    const session = await authenticate(deps, request);
    if (session instanceof Response) return session;
    if (!isUuid(roundId)) return notFound("round");
    // The read takes no parameters, and an unknown one is refused, not ignored (07 §4).
    const parameters = [...new Set(new URL(request.url).searchParams.keys())];
    if (parameters.length > 0) {
      return apiError("invalid_request", "This route takes no query parameters.", { fields: parameters });
    }
    const round = await getRound(deps.db, session.userId, roundId);
    if (!round) return notFound("round");

    const [answers, followUps, newer] = await Promise.all([
      roundAnswers(deps.db, round.id),
      roundFollowUps(deps.db, round.id),
      newerRoundExists(deps.db, round),
    ]);
    const status = roundStatus(round, { newerRoundExists: newer, now: new Date() });
    const scoring = await scoringReads(deps.db, round, answers, { scores: showsScores(round) });

    // Only the newest open round started today resumes; an abandoned or complete one is read-only.
    let prompt: object | null = null;
    let progress: object | null = null;
    let resume: Resume | null = null;
    if (status === "in_progress") {
      const step = roundStep(round, answers, followUps);
      // Submitted, and its follow-up is not a row yet: `submit`, sent again, writes it (07 §5.9).
      if (step.kind !== "follow_up_due" && step.kind !== "complete") {
        const asked = await nextPrompt(deps.db, round, step);
        prompt = asked.next.kind === "question" || asked.next.kind === "follow_up" ? asked.next : null;
        progress = asked.progress;
      }
      resume = resumeAt(step);
      const again = openRetry(answers);
      if (again) {
        // An answer-again that is open is what the client was doing: the same prompt, asked again.
        prompt = {
          kind: kindOf(again),
          position: again.position,
          question_id: again.questionId,
          parent_answer_id: again.parentAnswerId,
          retry_of_answer_id: again.retryOfAnswerId,
          text: again.promptText,
          speak: false,
        };
        resume = answerResume(again);
      }
    }

    return Response.json(
      {
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
          kind: kindOf(answer),
          state: answerState(answer),
          retry_of_answer_id: answer.retryOfAnswerId,
          ...(scoring.has(answer.id) ? { scoring: scoring.get(answer.id) } : {}),
        })),
        prompt,
        progress,
        resume,
      },
      // Polled by practice's per-answer frame: never a stored copy.
      { headers: { "cache-control": "no-store" } },
    );
  }, roundIdOf);
}
