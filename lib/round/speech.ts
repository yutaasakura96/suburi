import { z } from "zod";
import { apiError } from "../api/errors";
import { SPEECH_CONTENT_TYPE, type SpeechSynthesizer } from "../ai/tts";
import { ModelCallFailed } from "../ai/upstream";
import { authenticate, guarded, isUuid, log, notFound, roundIdOf, type RoundDeps } from "./http";
import { getRound, promptAt } from "./state";

/**
 * `GET /api/rounds/{roundId}/speech` ⚡ (07 §5.15): realistic mode's spoken question, streamed.
 *
 * **The prompt is named by position and kind, never by text.** Question text is read from
 * `round_questions`, so the route can say nothing but a prompt of this user's own round on the user's
 * key (07 §1 rule 6). Every follow-up request is still a 404: the route does not read `follow_ups`
 * yet (06, 2026-10-04). A practice round is also a 404: practice is text only.
 *
 * **A failed synthesis is `502 speech_failed`, and the round goes on** (06, 2026-09-28): the question
 * is already on screen as text. The audio is streamed through and not retained.
 */
export interface SpeechDeps extends RoundDeps {
  readonly speech: SpeechSynthesizer;
}

/** To the first byte. The user is waiting at ask time, and the text is already in front of them. */
export const SPEECH_TIMEOUT_MS = 10_000;

const querySchema = z.strictObject({
  position: z.string().regex(/^[1-7]$/),
  kind: z.enum(["question", "follow_up"]),
});

/**
 * The upstream's audio, passed through. A stream that breaks after its first byte can no longer be a
 * 502, so it is logged here; a client that stops listening cancels the upstream with it.
 */
function relay(reader: ReadableStreamDefaultReader<Uint8Array>, firstByte: Uint8Array, onInterrupted: () => void) {
  // Recording starts mid-question and the browser drops the request: that is not a failure.
  let cancelled = false;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(firstByte);
    },
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (cancelled) return;
        if (done) controller.close();
        else controller.enqueue(value);
      } catch (error) {
        if (cancelled) return;
        onInterrupted();
        controller.error(error);
      }
    },
    cancel(reason) {
      cancelled = true;
      return reader.cancel(reason);
    },
  });
}

export function createSpeech(deps: SpeechDeps) {
  return guarded("speech_read_failed", async function GET(request: Request, roundId: string): Promise<Response> {
    const session = await authenticate(deps, request, "speech");
    if (session instanceof Response) return session;
    const { userId } = session;

    const query = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!query.success) {
      const fields = [
        ...new Set(
          query.error.issues.flatMap((issue) =>
            issue.code === "unrecognized_keys" ? issue.keys : [issue.path.join(".") || "query"],
          ),
        ),
      ];
      return apiError("invalid_request", "The request failed validation.", { fields });
    }
    const position = Number(query.data.position);
    if (!isUuid(roundId)) return notFound("round");

    const round = await getRound(deps.db, userId, roundId);
    if (!round || round.mode !== "realistic") return notFound("round");

    // A follow-up's text is its `follow_ups` row, which this route does not read yet (06,
    // 2026-10-04): the 404 a `missing` one gets.
    const prompt = query.data.kind === "question" ? await promptAt(deps.db, round.id, position) : null;
    if (!prompt) return notFound("prompt", { round_id: round.id, position });

    const started = performance.now();
    const abort = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let firstByte: Uint8Array;
    try {
      const deadline = new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          // Rejected first: aborting fails the read in flight, and that must not be the class logged.
          reject(new ModelCallFailed("Speech", "upstream_timeout"));
          abort.abort();
        }, SPEECH_TIMEOUT_MS);
      });
      const audio = await Promise.race([
        deps.speech.synthesize({ text: prompt.text, language: round.language }, { signal: abort.signal, timeoutMs: SPEECH_TIMEOUT_MS }),
        deadline,
      ]);
      reader = audio.getReader();
      for (;;) {
        let chunk: ReadableStreamReadResult<Uint8Array>;
        try {
          chunk = await Promise.race([reader.read(), deadline]);
        } catch (error) {
          if (error instanceof ModelCallFailed) throw error;
          throw new ModelCallFailed("Speech", "stream_interrupted");
        }
        if (chunk.done) throw new ModelCallFailed("Speech", "empty_audio");
        if (chunk.value.byteLength > 0) {
          firstByte = chunk.value;
          break;
        }
      }
    } catch (error) {
      if (reader) void reader.cancel().catch(() => {});
      const errorClass = error instanceof ModelCallFailed ? error.errorClass : "unexpected";
      // Round id, position and error class, and nothing else (03 §8).
      log("error", { event: "speech_failed", round_id: round.id, position, error_class: errorClass });
      return apiError("speech_failed", "The question could not be spoken; the round goes on as text.", {
        round_id: round.id,
        position,
        error_class: errorClass,
      });
    } finally {
      clearTimeout(timeout);
    }

    log("info", {
      event: "question_spoken",
      round_id: round.id,
      position,
      first_byte_ms: Math.round(performance.now() - started),
    });
    const body = relay(reader, firstByte, () =>
      log("error", { event: "speech_failed", round_id: round.id, position, error_class: "stream_interrupted" }),
    );
    // `no-store`: the audio is not retained (03 §4), by the browser's cache either.
    return new Response(body, { headers: { "content-type": SPEECH_CONTENT_TYPE, "cache-control": "no-store" } });
  }, roundIdOf);
}
