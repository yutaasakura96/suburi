import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import * as s from "../../db/schema";
import { apiError } from "../api/errors";
import { answerAudioKey, type AudioStore } from "../audio/store";
import { authenticate, guarded, isUuid, log, notFound, parseBody, roundAbandoned, roundIdOf, writeFailed, type RoundDeps } from "./http";
import { answeredBefore, isAbandoned, lockRoundUser, promptAt, readRoundStep, type AnswerRow } from "./state";

/**
 * `POST /api/rounds/{roundId}/answers` (07 §5.6): opens the answer slot and presigns the upload.
 * **Called once the take exists** — after recording, before the upload — so a failed or denied
 * recording writes nothing and the question stays unseen (PRD §7).
 *
 * The client sends only what it cannot know about itself: the content type and the take's size.
 * `question_id` or `parent_answer_id`, `prompt_text`, `position`, `language`, `is_first_attempt` and
 * the key are derived here. **The prompt comes from stored rows** — `round_questions`, or the parent's
 * `follow_ups` row — so nothing is selected or generated here, and a follow-up's slot takes its
 * parent's position.
 *
 * **Idempotent.** An open slot at the current position is returned, with a fresh URL for the same key
 * while its transcript is still null — so an expired URL, a retried upload or a double click all land
 * on one row. **That is also practice's re-take** (06, 2026-09-27): a new take PUTs over the same
 * object until the take is transcribed.
 *
 * **Practice's "answer again" is the one case that makes a second row for a prompt**:
 * `retry_of_answer_id`, in a practice round and on a submitted answer, opens a new answer beside the
 * first — the same prompt and position, never a first attempt, and no follow-up of its own.
 */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

// What Chrome's MediaRecorder writes (06, 2026-09-28): the only format the transcription check verified.
const CONTENT_TYPES = ["audio/webm", "audio/webm;codecs=opus"] as const;

const requestSchema = z.strictObject({
  content_type: z.string().min(1).max(100),
  expected_bytes: z.int().positive(),
  retry_of_answer_id: z.uuid().optional(),
});

type Opened = { answer: AnswerRow; created: boolean } | Response;

/** An open slot is returned as it is while its take can still be replaced; a transcribed take is final. */
function reopened(answer: AnswerRow): Opened {
  if (answer.transcriptRaw !== null) {
    return apiError("transcript_already_final", "This answer is already transcribed; its take is final.", { answer_id: answer.id });
  }
  return { answer, created: false };
}

export interface OpenAnswerDeps extends RoundDeps {
  readonly store: AudioStore;
  /** `S3_PREFIX`: `prod/` or `dev/` (12 §2). */
  readonly prefix: string;
}

export function createOpenAnswer(deps: OpenAnswerDeps) {
  return guarded("answer_open_failed", async function POST(request: Request, roundId: string): Promise<Response> {
    const session = await authenticate(deps, request);
    if (session instanceof Response) return session;
    const { userId } = session;
    if (!isUuid(roundId)) return notFound("round");

    const body = await parseBody(request, requestSchema);
    if (body instanceof Response) return body;
    const contentType = CONTENT_TYPES.find((type) => type === body.content_type.replace(/\s+/g, "").toLowerCase());
    if (!contentType) {
      return apiError("unsupported_content_type", "Only audio/webm takes are accepted.", { fields: ["content_type"] });
    }
    // The take is still in the browser: nothing is opened for one the presign could never accept.
    if (body.expected_bytes > MAX_UPLOAD_BYTES) {
      return apiError("upload_too_large", "The take is larger than the upload cap.", {
        expected_bytes: body.expected_bytes,
        max_bytes: MAX_UPLOAD_BYTES,
      });
    }

    let opened: Opened;
    try {
      opened = await deps.transaction(async (tx): Promise<Opened> => {
        await lockRoundUser(tx, userId);
        // Position is assigned under a row lock on the round: two concurrent opens cannot both claim it.
        const [round] = await tx
          .select()
          .from(s.rounds)
          .where(and(eq(s.rounds.id, roundId), eq(s.rounds.userId, userId)))
          .for("update");
        if (!round) return notFound("round");
        if (round.completedAt !== null) {
          return apiError("round_already_complete", "The round is already complete.", { round_id: roundId });
        }
        if (await isAbandoned(tx, round)) return roundAbandoned(roundId);

        const answers = await roundAnswers(tx, round.id);
        if (body.retry_of_answer_id !== undefined) return answerAgain(tx, round, answers, body.retry_of_answer_id);

        const step = roundStep(round, answers, await roundFollowUps(tx, round.id));
        if (step.kind === "follow_up_due") {
          // The answer here is submitted and its follow-up is not a row yet: `submit`, sent again,
          // writes it (07 §5.9). No slot is opened for a prompt that does not exist.
          return apiError("answer_already_submitted", "This position's answer is submitted and its follow-up is not stored yet.", {
            round_id: roundId,
            answer_id: step.parent.id,
          });
        }
        if (step.kind !== "answer") {
          return apiError("answer_already_submitted", "Every position in this round is already answered.", { round_id: roundId });
        }
        if (step.answer) return reopened(step.answer);

        const id = randomUUID();
        const slot = {
          id,
          roundId,
          userId,
          position: step.position,
          language: round.language,
          audioS3Key: answerAudioKey(deps.prefix, userId, roundId, id),
        };
        if (step.followUp) {
          // Never a first attempt: a follow-up has no question id, and the column's check refuses one (04).
          const [answer] = await tx
            .insert(s.answers)
            .values({ ...slot, parentAnswerId: step.followUp.parent.id, promptText: step.followUp.row.promptText })
            .returning();
          return { answer, created: true };
        }

        const prompt = await promptAt(tx, roundId, step.position);
        if (!prompt) throw new Error("round_questions has no row at the current position");
        // A first attempt: realistic, a bank question, and no earlier answer to it in this language in
        // either mode (06, 2026-09-27). The partial unique index is the backstop, not the rule.
        const isFirstAttempt = round.mode === "realistic" && !(await answeredBefore(tx, prompt.questionId, round.language));
        const [answer] = await tx
          .insert(s.answers)
          .values({ ...slot, questionId: prompt.questionId, promptText: prompt.text, isFirstAttempt })
          .returning();
        return { answer, created: true };
      });
    } catch (error) {
      return writeFailed("answer_open_failed", error, { round_id: roundId });
    }
    if (opened instanceof Response) return opened;
    const { answer, created } = opened;

    let upload;
    try {
      upload = await deps.store.presignPut(answer.audioS3Key!, { contentType, bytes: body.expected_bytes });
    } catch (error) {
      log("error", { event: "presign_failed", answer_id: answer.id, error_class: (error as Error).name ?? "unexpected" });
      return apiError("presign_failed", "The upload could not be presigned; the slot stays open.", { answer_id: answer.id });
    }

    log("info", {
      event: created ? "answer_opened" : "answer_reopened",
      round_id: roundId,
      answer_id: answer.id,
      position: answer.position,
      follow_up: answer.questionId === null,
      retry: answer.retryOfAnswerId !== null,
      is_first_attempt: answer.isFirstAttempt,
      expected_bytes: body.expected_bytes,
    });

    return Response.json(
      {
        answer_id: answer.id,
        position: answer.position,
        kind: answer.questionId === null ? "follow_up" : "question",
        question_id: answer.questionId,
        parent_answer_id: answer.parentAnswerId,
        retry_of_answer_id: answer.retryOfAnswerId,
        is_first_attempt: answer.isFirstAttempt,
        upload: {
          method: "PUT",
          url: upload.url,
          headers: upload.headers,
          max_bytes: MAX_UPLOAD_BYTES,
          expires_at: upload.expiresAt.toISOString(),
        },
      },
      { status: created ? 201 : 200 },
    );
  }, roundIdOf);
}
