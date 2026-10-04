import { and, eq, isNull } from "drizzle-orm";
import * as s from "../../db/schema";
import { apiError } from "../api/errors";
import { ModelCallFailed } from "../ai/upstream";
import type { Transcriber } from "../ai/transcribe";
import type { AudioStore } from "../audio/store";
import { answerIdOf, authenticate, guarded, isUuid, log, notFound, writeFailed, type RoundDeps } from "./http";
import { pace } from "./measures";

/**
 * `POST /api/answers/{answerId}/transcribe` ⚡ (07 §5.7): transcribes the object the browser PUT,
 * read from S3 — audio never crosses a function on the way in.
 *
 * **Idempotent, and asymmetric on purpose.** A stored `transcript_raw` is returned with no model call;
 * there is no re-transcribe, because a raw transcript is final and an overwrite is a discard (PRD §9).
 * A failure leaves the column null, which is exactly the state a retry needs, and keeps the take.
 */
export interface TranscribeDeps extends RoundDeps {
  readonly store: AudioStore;
  readonly transcriber: Transcriber;
}

function view(answer: typeof s.answers.$inferSelect) {
  return {
    answer_id: answer.id,
    transcript_raw: answer.transcriptRaw,
    audio_duration_ms: answer.audioDurationMs,
    words_per_minute: answer.wordsPerMinute,
    transcriber_model_id: answer.transcriberModelId,
  };
}

export function createTranscribe(deps: TranscribeDeps) {
  return guarded("transcribe_failed", async function POST(request: Request, answerId: string): Promise<Response> {
    const session = await authenticate(deps, request, "transcribe");
    if (session instanceof Response) return session;
    const { userId } = session;
    if (!isUuid(answerId)) return notFound("answer");

    const [answer] = await deps.db
      .select()
      .from(s.answers)
      .where(and(eq(s.answers.id, answerId), eq(s.answers.userId, userId)));
    if (!answer) return notFound("answer");
    if (answer.transcriptRaw !== null) return Response.json(view(answer));

    const started = performance.now();
    const elapsed = () => Math.round(performance.now() - started);

    let audio: Uint8Array | null;
    try {
      audio = answer.audioS3Key === null ? null : await deps.store.get(answer.audioS3Key);
    } catch (error) {
      log("error", { event: "audio_read_failed", answer_id: answerId, error_class: (error as Error).name ?? "unexpected" });
      return apiError("upstream_s3", "The take could not be read from S3.", { answer_id: answerId });
    }
    if (audio === null) {
      return apiError("audio_missing", "No take has been uploaded for this answer.", { answer_id: answerId });
    }

    if (answer.audioUploadedAt === null) {
      try {
        await deps.transaction((tx) =>
          tx.update(s.answers).set({ audioUploadedAt: new Date() }).where(and(eq(s.answers.id, answerId), isNull(s.answers.audioUploadedAt))),
        );
      } catch (error) {
        return writeFailed("upload_confirmation_write_failed", error, { answer_id: answerId });
      }
    }

    let result;
    try {
      result = await deps.transcriber.transcribe({
        audio,
        contentType: "audio/webm",
        language: answer.language,
      });
    } catch (error) {
      const errorClass = error instanceof ModelCallFailed ? error.errorClass : "unexpected";
      log("error", { event: "transcription_failed", answer_id: answerId, bytes: audio.byteLength, error_class: errorClass, duration_ms: elapsed() });
      return apiError("transcription_failed", "Transcription failed; the take is kept.", {
        answer_id: answerId,
        error_class: errorClass,
      });
    }

    let stored;
    try {
      // Written only while still null: a concurrent call that finished first keeps its transcript.
      [stored] = await deps.transaction((tx) =>
        tx
          .update(s.answers)
          .set({
            transcriptRaw: result.text,
            audioDurationMs: result.durationMs,
            wordsPerMinute: pace(answer.language, result.text, result.durationMs),
            transcriberModelId: deps.transcriber.modelId,
          })
          .where(and(eq(s.answers.id, answerId), isNull(s.answers.transcriptRaw)))
          .returning(),
      );
    } catch (error) {
      return writeFailed("transcript_write_failed", error, { answer_id: answerId });
    }
    if (!stored) {
      [stored] = await deps.db.select().from(s.answers).where(eq(s.answers.id, answerId));
    }

    log("info", {
      event: "answer_transcribed",
      answer_id: answerId,
      bytes: audio.byteLength,
      audio_duration_ms: result.durationMs,
      transcript_chars: Array.from(result.text).length,
      duration_ms: elapsed(),
    });
    return Response.json(view(stored));
  }, answerIdOf);
}
