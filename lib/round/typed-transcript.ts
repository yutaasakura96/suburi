import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import * as s from "../../db/schema";
import { apiError } from "../api/errors";
import { answerIdOf, authenticate, guarded, isUuid, log, notFound, parseBody, roundAbandoned, writeFailed, type RoundDeps } from "./http";
import { isAbandoned } from "./state";

/**
 * `POST /api/answers/{answerId}/transcript` (07 §5.8): the typing fallback, for a take transcription
 * cannot read (03 §8). Sets `transcript_raw` from typed text with **`transcriber_model_id` null** —
 * the record says honestly that no transcriber produced it — and leaves the duration and the pace
 * null: there is no delivery to measure. **A typed answer is not a spoken one**, and that null model
 * is what keeps it out of pace and out of Progress (PRD §7).
 *
 * **A raw transcript is final** (PRD §9): once `transcript_raw` is set, by the transcriber or by this
 * route, a different text is `422 transcript_already_final`. The same typed text sent again is a
 * retried request, and returns the row it made.
 */
// Far past any spoken answer — four minutes is about 1,500 characters — and short of a request the function would refuse.
export const MAX_TYPED_CHARACTERS = 20_000;

const requestSchema = z.strictObject({
  source: z.literal("typed"),
  text: z
    .string()
    .max(MAX_TYPED_CHARACTERS)
    .refine((text) => text.trim() !== ""),
});

function view(answer: Pick<typeof s.answers.$inferSelect, "id" | "transcriptRaw" | "transcriberModelId" | "wordsPerMinute">) {
  return {
    answer_id: answer.id,
    transcript_raw: answer.transcriptRaw,
    transcriber_model_id: answer.transcriberModelId,
    words_per_minute: answer.wordsPerMinute,
  };
}

export function createTypedTranscript(deps: RoundDeps) {
  return guarded("typed_transcript_failed", async function POST(request: Request, answerId: string): Promise<Response> {
    const session = await authenticate(deps, request);
    if (session instanceof Response) return session;
    const { userId } = session;
    if (!isUuid(answerId)) return notFound("answer");

    const body = await parseBody(request, requestSchema);
    if (body instanceof Response) return body;

    const [answer] = await deps.db
      .select()
      .from(s.answers)
      .where(and(eq(s.answers.id, answerId), eq(s.answers.userId, userId)));
    if (!answer) return notFound("answer");

    const final = (stored: typeof answer) => {
      if (stored.transcriberModelId === null && stored.transcriptRaw === body.text) return Response.json(view(stored));
      return apiError("transcript_already_final", "This answer already has its raw transcript; it is final.", { answer_id: answerId });
    };
    if (answer.transcriptRaw !== null) return final(answer);

    let stored;
    try {
      // Written only while still null: a transcript that landed first is kept, never overwritten.
      const result = await deps.transaction(async (tx) => {
        const [round] = await tx.select().from(s.rounds).where(eq(s.rounds.id, answer.roundId)).for("update");
        if (round.completedAt !== null) return apiError("round_already_complete", "The round is already complete.", { round_id: round.id });
        if (await isAbandoned(tx, round)) return roundAbandoned(round.id);
        const [updated] = await tx
          .update(s.answers)
          .set({ transcriptRaw: body.text, transcriberModelId: null, audioDurationMs: null, wordsPerMinute: null })
          .where(and(eq(s.answers.id, answerId), isNull(s.answers.transcriptRaw)))
          .returning();
        return updated;
      });
      if (result instanceof Response) return result;
      stored = result;
    } catch (error) {
      return writeFailed("typed_transcript_write_failed", error, { answer_id: answerId });
    }
    if (!stored) {
      const [current] = await deps.db.select().from(s.answers).where(eq(s.answers.id, answerId));
      return final(current);
    }

    log("info", { event: "answer_typed", answer_id: answerId, transcript_chars: Array.from(body.text).length });
    return Response.json(view(stored), { status: 201 });
  }, answerIdOf);
}
