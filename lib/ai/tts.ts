import { TTS_MODEL, TTS_VOICE } from "./models.ts";
import type { CallOptions } from "./score.ts";
import { ModelCallFailed, openAiClient, upstreamErrorClass } from "./upstream.ts";

/**
 * The text-to-speech port (03 §4): one prompt of a round, spoken, as a stream of MP3. The audio is
 * synthesised when the question is asked and **never retained** — nothing here stores, caches or logs
 * it, or the text it was made from. One real implementation and a fake.
 *
 * **A failure is thrown before the first byte**, as `ModelCallFailed`: the upstream answers with its
 * status before any audio, so the route can still say `502 speech_failed` (07 §5.15).
 */

export interface SpeechInput {
  readonly text: string;
  readonly language: "ja" | "en";
}

export interface SpeechSynthesizer {
  readonly modelId: string;
  synthesize(input: SpeechInput, options?: CallOptions): Promise<ReadableStream<Uint8Array>>;
}

/** What 07 §5.15 answers with. */
export const SPEECH_CONTENT_TYPE = "audio/mpeg";

// The model is steerable, so it is told what a question read by an interviewer is not: a reply, a
// paraphrase, or a performance. Naming the language keeps a Japanese question with an English
// company name in it from being read as English.
const INSTRUCTIONS: Record<SpeechInput["language"], string> = {
  en: "Read the interview question aloud in English, exactly as written, as a calm and neutral interviewer would ask it. Add nothing, omit nothing, and do not answer it.",
  ja: "Read the interview question aloud in standard Japanese, exactly as written, as a calm and polite interviewer would ask it. Add nothing, omit nothing, and do not answer it.",
};

export function openAiSpeechSynthesizer({ apiKey, baseURL }: { apiKey: string; baseURL?: string }): SpeechSynthesizer {
  return {
    modelId: TTS_MODEL,
    async synthesize({ text, language }, { signal, timeoutMs } = {}) {
      try {
        const response = await openAiClient({ apiKey, baseURL }).audio.speech.create(
          { model: TTS_MODEL, voice: TTS_VOICE, input: text, instructions: INSTRUCTIONS[language], response_format: "mp3" },
          { signal, ...(timeoutMs === undefined ? {} : { timeout: timeoutMs }) },
        );
        if (!response.body) throw new ModelCallFailed("Speech", "empty_audio");
        return response.body;
      } catch (error) {
        throw new ModelCallFailed("Speech", upstreamErrorClass(error));
      }
    },
  };
}
