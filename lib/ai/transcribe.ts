import { toFile } from "openai";
import { TRANSCRIPTION_MODEL } from "./models.ts";
import type { CallOptions } from "./score.ts";
import { ModelCallFailed, openAiClient, upstreamErrorClass } from "./upstream.ts";

/**
 * The transcription port (03 §4): audio read from S3 by the server, never through a function on the
 * way in, and the raw transcript returned verbatim — it is final once stored (07 §5.7). One real
 * implementation and a fake.
 *
 * **Duration comes from the upstream's own billing**, `usage.seconds`, when it reports duration: a
 * `MediaRecorder` WebM carries no duration in its header (06, 2026-09-28), and 07 §5.6 keeps the take's
 * length off the request. No reported duration is a null duration, and a null pace, never a guess.
 */

export interface TranscriptionInput {
  readonly audio: Uint8Array;
  readonly contentType: string;
  readonly language: "ja" | "en";
}

export interface TranscriptionResult {
  readonly text: string;
  readonly durationMs: number | null;
}

export interface Transcriber {
  readonly modelId: string;
  transcribe(input: TranscriptionInput, options?: CallOptions): Promise<TranscriptionResult>;
}

export function openAiTranscriber({ apiKey, baseURL }: { apiKey: string; baseURL?: string }): Transcriber {
  return {
    modelId: TRANSCRIPTION_MODEL,
    async transcribe({ audio, contentType, language }, { signal, timeoutMs } = {}) {
      try {
        const file = await toFile(audio, "answer.webm", { type: contentType });
        const response = await openAiClient({ apiKey, baseURL }).audio.transcriptions.create(
          // gpt-transcribe takes `languages`, which replaces the singular `language`; never both.
          { file, model: TRANSCRIPTION_MODEL, languages: [language], response_format: "json" },
          { signal, ...(timeoutMs === undefined ? {} : { timeout: timeoutMs }) },
        );
        const text = response.text?.trim() ?? "";
        if (text === "") throw new ModelCallFailed("Transcription", "empty_transcript");
        const usage = response.usage;
        const durationMs = usage?.type === "duration" ? Math.round(usage.seconds * 1000) : null;
        return { text: response.text, durationMs };
      } catch (error) {
        throw new ModelCallFailed("Transcription", upstreamErrorClass(error));
      }
    },
  };
}
