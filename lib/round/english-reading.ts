import { and, eq } from "drizzle-orm";
import { z } from "zod";
import * as s from "../../db/schema";
import { apiError } from "../api/errors";
import type { EnglishReader, EnglishReadingResult } from "../ai/english-reading";
import { ModelCallFailed, upstreamErrorClass } from "../ai/upstream";
import { englishReadingTextFits } from "./english-reading-limits";
import { answerIdOf, authenticate, guarded, isUuid, log, notFound, parseBody, roundAbandoned, writeFailed, type RoundDeps } from "./http";
import { getRound, isAbandoned } from "./state";

/**
 * `POST /api/answers/{answerId}/english-reading` ⚡ (07 §5.20): an English reading of the text in the
 * correction screen's editor, for a **Japanese practice round** (#106; 06, 2026-10-14, Q106-7).
 *
 * **Every refusal comes before the model call**: another user's or no such answer is a 404; a
 * realistic round's or an English round's is `422 english_reading_not_applicable` (Q106-2: no English
 * before a realistic round's feedback); no raw transcript yet is a 400 naming it; a submitted answer,
 * a complete round and an abandoned one are refused as every round write refuses them.
 *
 * **Nothing it is sent or returns is stored or logged** (04 §6, item 16; 12 §7). Each call that
 * reaches the model writes one `english_readings` row — the length, the model, the prompt version and
 * the tokens — so the week's spend counts it (12 §6). It changes nothing else.
 */
export interface EnglishReadingDeps extends RoundDeps {
  readonly englishReader: EnglishReader;
}

/** The user is at the correction screen, waiting, with the editor still in hand. One call, no retry. */
export const ENGLISH_READING_TIMEOUT_MS = 30_000;

const requestSchema = z.strictObject({
  text: z
    .string()
    .refine((text) => text.trim() !== "")
    .refine(englishReadingTextFits),
});

export function createEnglishReading(deps: EnglishReadingDeps) {
  return guarded("english_reading_failed", async function POST(request: Request, answerId: string): Promise<Response> {
    const session = await authenticate(deps, request, "english-reading");
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
    const round = await getRound(deps.db, userId, answer.roundId);
    if (!round) return notFound("answer");

    if (round.mode !== "practice" || round.language !== "ja") {
      return apiError("english_reading_not_applicable", `A ${round.language} ${round.mode} round's answer has no English reading.`, {
        answer_id: answerId,
        mode: round.mode,
        language: round.language,
      });
    }
    if (answer.transcriptRaw === null) {
      return apiError("invalid_request", "The answer has no raw transcript yet.", { answer_id: answerId, fields: ["transcript_raw"] });
    }
    if (answer.transcriptCorrected !== null) {
      return apiError("answer_already_submitted", "This answer is already submitted.", { answer_id: answerId });
    }
    if (round.completedAt !== null) {
      return apiError("round_already_complete", "The round is already complete.", { round_id: round.id });
    }
    if (await isAbandoned(deps.db, round)) return roundAbandoned(round.id);

    const sourceCodePoints = Array.from(body.text).length;
    const started = performance.now();
    const outcome = await readInEnglish(deps.englishReader, body.text);
    const durationMs = Math.round(performance.now() - started);

    try {
      await deps.db.insert(s.englishReadings).values({
        answerId,
        userId,
        status: outcome.ok ? "ok" : "failed",
        sourceCodePoints,
        modelId: deps.englishReader.modelId,
        promptVersion: deps.englishReader.promptVersion,
        tokensIn: outcome.ok ? outcome.tokensIn : null,
        tokensOut: outcome.ok ? outcome.tokensOut : null,
        errorClass: outcome.ok ? null : outcome.errorClass,
      });
    } catch (error) {
      return writeFailed("english_reading_write_failed", error, { answer_id: answerId });
    }

    if (!outcome.ok) {
      log("error", {
        event: "english_reading_failed",
        answer_id: answerId,
        source_code_points: sourceCodePoints,
        duration_ms: durationMs,
        error_class: outcome.errorClass,
      });
      return apiError("english_reading_failed", "The English reading failed.", { answer_id: answerId, error_class: outcome.errorClass });
    }
    log("info", {
      event: "english_reading",
      answer_id: answerId,
      source_code_points: sourceCodePoints,
      duration_ms: durationMs,
      tokens_in: outcome.tokensIn,
      tokens_out: outcome.tokensOut,
    });
    return Response.json({ answer_id: answerId, english: outcome.english });
  }, answerIdOf);
}

type ReadingOutcome =
  | ({ readonly ok: true } & EnglishReadingResult)
  | { readonly ok: false; readonly errorClass: string };

/** One call, bounded at `ENGLISH_READING_TIMEOUT_MS` whatever the SDK does, never retried. */
async function readInEnglish(reader: EnglishReader, text: string): Promise<ReadingOutcome> {
  const abort = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const deadline = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        // Rejected first: aborting fails the call in flight, and that must not be the class logged.
        reject(new ModelCallFailed("English reading", "upstream_timeout"));
        abort.abort();
      }, ENGLISH_READING_TIMEOUT_MS);
    });
    const result = await Promise.race([reader.read(text, { signal: abort.signal, timeoutMs: ENGLISH_READING_TIMEOUT_MS }), deadline]);
    return { ok: true, ...result };
  } catch (error) {
    return { ok: false, errorClass: upstreamErrorClass(error) };
  } finally {
    clearTimeout(timeout);
  }
}
