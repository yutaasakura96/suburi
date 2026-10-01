import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import * as s from "../../db/schema";
import { apiError } from "../api/errors";
import type { AnswerScorer } from "../ai/score";
import { authenticate, isUuid, log, notFound, parseBody, roundAbandoned, writeFailed, type RoundDeps } from "./http";
import { rewriteMagnitude } from "./measures";
import { runScoringAttempt, type ScoringRunDeps } from "./run-scoring";
import { isAbandoned, promptAt, type RoundRow } from "./state";

/**
 * `POST /api/answers/{answerId}/submit` ⚡ (07 §5.9): the commit point. Writes the corrected
 * transcript beside the raw one — both persist, and the diff is data — creates the pending scoring
 * attempt with **all four stamps**, and returns the next prompt.
 *
 * **Scoring is dispatched here, not at round end** (03 §3): in `after()`, while the user records the
 * next answer, so by round end the feedback screen is mostly a read. `after` also runs when the
 * response failed after the attempt row was written, which is what this wants: `run` is idempotent.
 *
 * No follow-up yet (#44): `next` is the next question, then `pressure` (realistic) or `feedback`
 * (practice).
 */
export interface SubmitDeps extends RoundDeps, Pick<ScoringRunDeps, "sleep"> {
  readonly scorer: AnswerScorer;
  /** Next's `after`, injected so a test can await the work it schedules. */
  readonly after: (work: () => Promise<unknown>) => void;
  /** When this invocation must be finished by: its start plus the route's `maxDuration`, less a margin. */
  readonly deadline: () => number;
}

const requestSchema = z.strictObject({
  transcript_corrected: z.string().refine((text) => text.trim() !== ""),
});

async function nextPrompt(db: RoundDeps["db"], round: RoundRow, position: number) {
  if (position < round.length) {
    const prompt = await promptAt(db, round.id, position + 1);
    return {
      next: {
        kind: "question",
        position: position + 1,
        question_id: prompt?.questionId ?? null,
        text: prompt?.text ?? null,
        speak: round.mode === "realistic",
      },
      progress: { position: position + 1, of: round.length },
    };
  }
  return {
    next: { kind: round.mode === "realistic" ? "pressure" : "feedback" },
    progress: { position: round.length, of: round.length },
  };
}

export function createSubmit(deps: SubmitDeps) {
  return async function POST(request: Request, answerId: string): Promise<Response> {
    const session = await authenticate(deps, request, "submit");
    if (session instanceof Response) return session;
    const { userId } = session;
    if (!isUuid(answerId)) return notFound("answer");

    const body = await parseBody(request, requestSchema);
    if (body instanceof Response) return body;
    const corrected = body.transcript_corrected;

    const [row] = await deps.db
      .select({ answer: s.answers, round: s.rounds, question: s.questions })
      .from(s.answers)
      .innerJoin(s.rounds, eq(s.rounds.id, s.answers.roundId))
      .innerJoin(s.questions, eq(s.questions.id, s.answers.questionId))
      .where(and(eq(s.answers.id, answerId), eq(s.answers.userId, userId)));
    if (!row) return notFound("answer");
    const { answer, round, question } = row;

    // The same body is a retried request and returns what it made; a different one would overwrite.
    async function alreadySubmitted(stored: string | null, magnitude: number | null) {
      if (stored !== corrected) {
        return apiError("answer_already_submitted", "This answer is already submitted.", { answer_id: answerId });
      }
      const [attempt] = await deps.db
        .select({ id: s.scoringAttempts.id, status: s.scoringAttempts.status })
        .from(s.scoringAttempts)
        .where(eq(s.scoringAttempts.answerId, answerId))
        .orderBy(desc(s.scoringAttempts.createdAt))
        .limit(1);
      return Response.json({
        answer_id: answerId,
        rewrite_magnitude: magnitude,
        scoring: { attempt_id: attempt.id, status: attempt.status },
        ...(await nextPrompt(deps.db, round, answer.position)),
      });
    }

    if (answer.transcriptCorrected !== null) return alreadySubmitted(answer.transcriptCorrected, answer.rewriteMagnitude);
    if (round.completedAt !== null) {
      return apiError("round_already_complete", "The round is already complete.", { round_id: round.id });
    }
    if (answer.transcriptRaw === null) {
      return apiError("invalid_request", "The answer has no transcript to correct yet.", { fields: ["transcript_raw"] });
    }

    const promptVersion = deps.scorer.promptVersions[round.language];
    if (!promptVersion) throw new Error(`No scoring prompt for ${round.language}`);
    const magnitude = rewriteMagnitude(answer.transcriptRaw, corrected);

    let attemptId: string | null | Response;
    try {
      attemptId = await deps.transaction(async (tx): Promise<string | null | Response> => {
        await tx.select({ id: s.rounds.id }).from(s.rounds).where(eq(s.rounds.id, round.id)).for("update");
        if (await isAbandoned(tx, round)) return roundAbandoned(round.id);
        const [updated] = await tx
          .update(s.answers)
          .set({ transcriptCorrected: corrected, rewriteMagnitude: magnitude })
          .where(and(eq(s.answers.id, answerId), isNull(s.answers.transcriptCorrected)))
          .returning({ id: s.answers.id });
        if (!updated) return null;
        const [attempt] = await tx
          .insert(s.scoringAttempts)
          .values({
            answerId,
            userId,
            status: "pending",
            // The four stamps, every one from a stored row, none from the request (07 §1 rule 6).
            cvVersionId: round.cvVersionId,
            rubricVersionId: round.rubricVersionId,
            generatorPromptVersion: question.generatorPromptVersion,
            modelId: deps.scorer.modelId,
            scoringPromptVersion: promptVersion,
          })
          .returning({ id: s.scoringAttempts.id });
        return attempt.id;
      });
    } catch (error) {
      return writeFailed("answer_submit_failed", error, { answer_id: answerId });
    }
    if (attemptId instanceof Response) return attemptId;
    if (attemptId === null) {
      // A concurrent submit won the row: answer as a retry of it would.
      const [stored] = await deps.db.select().from(s.answers).where(eq(s.answers.id, answerId));
      return alreadySubmitted(stored.transcriptCorrected, stored.rewriteMagnitude);
    }

    const scheduled = attemptId;
    deps.after(() => runScoringAttempt(deps, scheduled, { deadline: deps.deadline() }));

    log("info", {
      event: "answer_submitted",
      answer_id: answerId,
      attempt_id: attemptId,
      position: answer.position,
      rewrite_magnitude: magnitude,
    });
    return Response.json({
      answer_id: answerId,
      rewrite_magnitude: magnitude,
      scoring: { attempt_id: attemptId, status: "pending" },
      ...(await nextPrompt(deps.db, round, answer.position)),
    });
  };
}
