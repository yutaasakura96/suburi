import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import * as s from "../../db/schema";
import { apiError } from "../api/errors";
import type { AnswerScorer } from "../ai/score";
import { generateFollowUp, type FollowUpDeps } from "./follow-up";
import { authenticate, isUuid, log, notFound, parseBody, roundAbandoned, writeFailed, type RoundDeps } from "./http";
import { rewriteMagnitude } from "./measures";
import { runScoringAttempt, type ScoringRunDeps } from "./run-scoring";
import { isAbandoned, promptAt, readRoundStep, type AnswerRow, type RoundRow, type RoundStep } from "./state";

/**
 * `POST /api/answers/{answerId}/submit` ⚡ (07 §5.9): the commit point. Writes the corrected
 * transcript beside the raw one — both persist, and the diff is data — creates the pending scoring
 * attempt with **all four stamps**, and returns the next prompt.
 *
 * **Scoring is dispatched here, not at round end** (03 §3): in `after()`, while the user records the
 * next answer, so by round end the feedback screen is mostly a read. `after` also runs when the
 * response failed after the attempt row was written, which is what this wants: `run` is idempotent.
 *
 * **The follow-up is written before this returns** (06, 2026-09-27). Once the answer is committed,
 * the round's due follow-up is generated from the corrected text, outside any transaction, and stored
 * in `follow_ups` — `generated` with its text and stamps, or `missing` with the error class when the
 * call finally failed. `next` is then read from the stored rows, never computed from the request.
 *
 * **A missing follow-up is `502 followup_generation_failed`, and not fatal**: the answer is saved and
 * scored, the hole is a row, and the same body sent again returns `next` degraded to the next
 * question, `pressure` or `feedback`. That repeat is also what heals a call that died between the
 * commit and the follow-up's row: the row is generated then, by `submit`, and by nothing else.
 */
export interface SubmitDeps extends RoundDeps, Pick<ScoringRunDeps, "sleep">, FollowUpDeps {
  readonly scorer: AnswerScorer;
  /** Next's `after`, injected so a test can await the work it schedules. */
  readonly after: (work: () => Promise<unknown>) => void;
  /** When this invocation must be finished by: its start plus the route's `maxDuration`, less a margin. */
  readonly deadline: () => number;
}

const requestSchema = z.strictObject({
  transcript_corrected: z.string().refine((text) => text.trim() !== ""),
});

/** `next` and `progress` for where the round stands (07 §5.9): one of four shapes, from stored rows. */
async function nextPrompt(db: RoundDeps["db"], round: RoundRow, step: Exclude<RoundStep, { kind: "follow_up_due" }>) {
  const speak = round.mode === "realistic";
  if (step.kind !== "answer") {
    return {
      next: { kind: step.kind === "pressure" ? "pressure" : "feedback" },
      progress: { position: round.length, of: round.length },
    };
  }
  const progress = { position: step.position, of: round.length };
  if (step.followUp) {
    const { row, parent } = step.followUp;
    return {
      // A follow-up shares its parent's position (06, 2026-09-27, confirm 3).
      next: {
        kind: "follow_up",
        position: step.position,
        parent_answer_id: parent.id,
        follow_up_id: row.id,
        text: row.promptText,
        prompt_version: row.promptVersion,
        speak,
      },
      progress,
    };
  }
  const prompt = await promptAt(db, round.id, step.position);
  return {
    next: { kind: "question", position: step.position, question_id: prompt?.questionId ?? null, text: prompt?.text ?? null, speak },
    progress,
  };
}

export function createSubmit(deps: SubmitDeps) {
  /**
   * Makes sure the round's due follow-up is a row, and says where the round then stands. Nothing is
   * generated when no follow-up is due: after a follow-up's own answer, after a practice "answer
   * again", and on a repeat whose follow-up is already stored (`roundStep`).
   */
  async function settleFollowUp(
    round: RoundRow,
  ): Promise<{ step: Exclude<RoundStep, { kind: "follow_up_due" }>; missing: { parent: AnswerRow; errorClass: string } | null } | Response> {
    const step = await readRoundStep(deps.db, round);
    if (step.kind !== "follow_up_due") return { step, missing: null };
    // An abandoned round takes no more writes (07 §5.5), and no model call is spent on one.
    if (await isAbandoned(deps.db, round)) return roundAbandoned(round.id);

    const { parent } = step;
    const outcome = await generateFollowUp(deps, round, parent);
    let written: boolean | Response;
    try {
      written = await deps.transaction(async (tx): Promise<boolean | Response> => {
        await tx.select({ id: s.rounds.id }).from(s.rounds).where(eq(s.rounds.id, round.id)).for("update");
        if (await isAbandoned(tx, round)) return roundAbandoned(round.id);
        const [row] = await tx
          .insert(s.followUps)
          .values({
            parentAnswerId: parent.id,
            userId: parent.userId,
            status: outcome.status,
            promptText: outcome.status === "generated" ? outcome.text : null,
            modelId: deps.followUpGenerator.modelId,
            promptVersion: deps.followUpGenerator.promptVersions[round.language],
            tokensIn: outcome.status === "generated" ? outcome.tokensIn : null,
            tokensOut: outcome.status === "generated" ? outcome.tokensOut : null,
            errorClass: outcome.status === "missing" ? outcome.errorClass : null,
          })
          // One follow-up per answer: a concurrent submit that stored first keeps its row.
          .onConflictDoNothing({ target: s.followUps.parentAnswerId })
          .returning({ id: s.followUps.id });
        return row !== undefined;
      });
    } catch (error) {
      return writeFailed("follow_up_write_failed", error, { answer_id: parent.id });
    }
    if (written instanceof Response) return written;

    const settled = await readRoundStep(deps.db, round);
    if (settled.kind === "follow_up_due") throw new Error("a follow-up is still due after its row was written");
    return { step: settled, missing: written && outcome.status === "missing" ? { parent, errorClass: outcome.errorClass } : null };
  }

  return async function POST(request: Request, answerId: string): Promise<Response> {
    const session = await authenticate(deps, request, "submit");
    if (session instanceof Response) return session;
    const { userId } = session;
    if (!isUuid(answerId)) return notFound("answer");

    const body = await parseBody(request, requestSchema);
    if (body instanceof Response) return body;
    const corrected = body.transcript_corrected;

    // A bank question's answer joins its question; a follow-up's joins the follow-up it answers.
    const [row] = await deps.db
      .select({ answer: s.answers, round: s.rounds, question: s.questions, asked: s.followUps })
      .from(s.answers)
      .innerJoin(s.rounds, eq(s.rounds.id, s.answers.roundId))
      .leftJoin(s.questions, eq(s.questions.id, s.answers.questionId))
      .leftJoin(s.followUps, eq(s.followUps.parentAnswerId, s.answers.parentAnswerId))
      .where(and(eq(s.answers.id, answerId), eq(s.answers.userId, userId)));
    if (!row) return notFound("answer");
    const { answer, round } = row;

    async function respond(magnitude: number | null, attempt: { id: string; status: string }) {
      const settled = await settleFollowUp(round);
      if (settled instanceof Response) return settled;
      if (settled.missing) {
        return apiError("followup_generation_failed", "The follow-up could not be generated; the answer is saved and the hole is recorded.", {
          answer_id: settled.missing.parent.id,
          attempt_id: attempt.id,
          error_class: settled.missing.errorClass,
        });
      }
      return Response.json({
        answer_id: answerId,
        rewrite_magnitude: magnitude,
        scoring: { attempt_id: attempt.id, status: attempt.status },
        ...(await nextPrompt(deps.db, round, settled.step)),
      });
    }

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
      return respond(magnitude, attempt);
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
    // Stamp 3: the question's generator version, or for a follow-up the prompt that generated it (04).
    const generatorPromptVersion = row.question?.generatorPromptVersion ?? row.asked?.promptVersion;
    if (!generatorPromptVersion) throw new Error("An answer with neither a question nor a follow-up row");
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
            generatorPromptVersion,
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
      follow_up: answer.questionId === null,
      rewrite_magnitude: magnitude,
    });
    return respond(magnitude, { id: attemptId, status: "pending" });
  };
}
