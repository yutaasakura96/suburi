import { and, eq } from "drizzle-orm";
import * as s from "../../db/schema";
import { apiError } from "../api/errors";
import type { AudioStore } from "../audio/store";
import { answerIdOf, authenticate, guarded, isUuid, log, notFound, type RoundDeps } from "./http";

/**
 * `GET /api/answers/{answerId}/audio` (07 §5.14): mints a short-lived presigned GET at play time.
 * Audio is read by a browser through these and nothing else (03 §9); the bucket has no public read.
 *
 * **A missing recording is `404 audio_missing`, not a broken page** (04 §5): the answer has no key, or
 * its key points at nothing. The object is checked before the URL is minted, so History's play control
 * is told so rather than handed a link that fails.
 */
export interface AnswerAudioDeps extends RoundDeps {
  readonly store: AudioStore;
}

export function createGetAnswerAudio(deps: AnswerAudioDeps) {
  return guarded("answer_audio_failed", async function GET(request: Request, answerId: string): Promise<Response> {
    const session = await authenticate(deps, request);
    if (session instanceof Response) return session;
    if (!isUuid(answerId)) return notFound("answer");

    const [answer] = await deps.db
      .select({ key: s.answers.audioS3Key, durationMs: s.answers.audioDurationMs })
      .from(s.answers)
      .where(and(eq(s.answers.id, answerId), eq(s.answers.userId, session.userId)));
    if (!answer) return notFound("answer");

    const missing = () => apiError("audio_missing", "No recording is stored for this answer.", { answer_id: answerId });
    if (answer.key === null) return missing();
    try {
      if (!(await deps.store.exists(answer.key))) return missing();
      const { url, expiresAt } = await deps.store.presignGet(answer.key);
      return Response.json({ url, expires_at: expiresAt.toISOString(), duration_ms: answer.durationMs });
    } catch (error) {
      log("error", { event: "audio_presign_failed", answer_id: answerId, error_class: (error as Error).name ?? "unexpected" });
      return apiError("upstream_s3", "The recording could not be reached in S3.", { answer_id: answerId });
    }
  }, answerIdOf);
}
