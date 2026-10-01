import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import * as s from "../../db/schema";
import { apiError } from "../api/errors";
import { answerAudioKey, type AudioStore } from "../audio/store";
import { authenticate, isUuid, log, notFound, parseBody, roundAbandoned, writeFailed, type RoundDeps } from "./http";
import { answeredBefore, isAbandoned, promptAt, roundAnswers, roundStep, type AnswerRow } from "./state";

/**
 * `POST /api/rounds/{roundId}/answers` (07 §5.6): opens the answer slot and presigns the upload.
 * **Called once the take exists** — after recording, before the upload — so a failed or denied
 * recording writes nothing and the question stays unseen (PRD §7).
 *
 * The client sends only what it cannot know about itself: the content type and the take's size.
 * `question_id`, `prompt_text`, `position`, `language`, `is_first_attempt` and the key are derived here.
 *
 * **Idempotent.** An open slot at the current position is returned, with a fresh URL for the same key
 * while its transcript is still null — so an expired URL, a retried upload or a double click all land
 * on one row. Practice's "answer again" arrives with #49.
 */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

// What Chrome's MediaRecorder writes (06, 2026-09-28): the only format the transcription check verified.
const CONTENT_TYPES = ["audio/webm", "audio/webm;codecs=opus"] as const;

const requestSchema = z.strictObject({
  content_type: z.string().min(1).max(100),
  expected_bytes: z.int().positive(),
});

export interface OpenAnswerDeps extends RoundDeps {
  readonly store: AudioStore;
  /** `S3_PREFIX`: `prod/` or `dev/` (12 §2). */
  readonly prefix: string;
}

export function createOpenAnswer(deps: OpenAnswerDeps) {
  return async function POST(request: Request, roundId: string): Promise<Response> {
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

    type Opened = { answer: AnswerRow; created: boolean } | Response;
    let opened: Opened;
    try {
      opened = await deps.transaction(async (tx): Promise<Opened> => {
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

        const step = roundStep(round, await roundAnswers(tx, roundId));
        if (step.kind !== "answer") {
          return apiError("answer_already_submitted", "Every position in this round is already answered.", { round_id: roundId });
        }
        if (step.answer) {
          if (step.answer.transcriptRaw !== null) {
            return apiError("transcript_already_final", "This answer is already transcribed; its take is final.", {
              answer_id: step.answer.id,
            });
          }
          return { answer: step.answer, created: false };
        }

        const prompt = await promptAt(tx, roundId, step.position);
        if (!prompt) throw new Error("round_questions has no row at the current position");
        // A first attempt: realistic, a bank question, and no earlier answer to it in this language in
        // either mode (06, 2026-09-27). The partial unique index is the backstop, not the rule.
        const isFirstAttempt = round.mode === "realistic" && !(await answeredBefore(tx, prompt.questionId, round.language));
        const id = randomUUID();
        const [answer] = await tx
          .insert(s.answers)
          .values({
            id,
            roundId,
            userId,
            questionId: prompt.questionId,
            promptText: prompt.text,
            position: step.position,
            language: round.language,
            isFirstAttempt,
            audioS3Key: answerAudioKey(deps.prefix, userId, roundId, id),
          })
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
      is_first_attempt: answer.isFirstAttempt,
      expected_bytes: body.expected_bytes,
    });

    return Response.json(
      {
        answer_id: answer.id,
        position: answer.position,
        kind: "question",
        question_id: answer.questionId,
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
  };
}
