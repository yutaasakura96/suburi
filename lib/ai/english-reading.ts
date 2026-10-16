import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import * as prompt from "../prompts/english-reading-1.0.ts";
import { ENGLISH_READING_MODEL } from "./models.ts";
import type { CallOptions } from "./score.ts";
import { ModelCallFailed, openAiClient, upstreamErrorClass } from "./upstream.ts";

/**
 * The English-reading port (03 §4, 07 §5.20): the English of the text in a Japanese practice round's
 * correction editor, for English help. **Nothing it is sent or returns is stored or logged** (04 §6,
 * item 16; 12 §7) — only that a call was made. One real implementation and a fake; no test calls
 * OpenAI (11 §2).
 *
 * **What comes back is checked, not trusted:** not blank, and not longer than
 * `MAX_ENGLISH_READING_CODE_POINTS`. Anything else is `malformed_output`.
 */

export interface EnglishReadingResult {
  readonly english: string;
  readonly tokensIn: number | null;
  readonly tokensOut: number | null;
}

export interface EnglishReader {
  readonly modelId: string;
  /** Stored on every `english_readings` row this reader's calls write. */
  readonly promptVersion: string;
  /** `text` is the editor's text, the user's own words, at most 8,000 code points. */
  read(text: string, options?: CallOptions): Promise<EnglishReadingResult>;
}

/**
 * Several times the English of the longest text the route takes (8,000 code points of Japanese): it
 * refuses a runaway output, nothing shorter.
 */
export const MAX_ENGLISH_READING_CODE_POINTS = 40_000;

/** The English, trimmed — or the whole result is refused. */
export function checkEnglishReading(text: string): string {
  const english = text.trim();
  if (english === "" || Array.from(english).length > MAX_ENGLISH_READING_CODE_POINTS) {
    throw new ModelCallFailed("English reading", "malformed_output");
  }
  return english;
}

const output = z.object({ english: z.string() });

export function openAiEnglishReader({ apiKey, baseURL }: { apiKey: string; baseURL?: string }): EnglishReader {
  return {
    modelId: ENGLISH_READING_MODEL,
    promptVersion: prompt.version,
    async read(text, { signal, timeoutMs } = {}) {
      try {
        const response = await openAiClient({ apiKey, baseURL }).responses.parse(
          {
            model: ENGLISH_READING_MODEL,
            instructions: prompt.instructions,
            input: text,
            text: { format: zodTextFormat(output, "english_reading") },
          },
          { signal, ...(timeoutMs === undefined ? {} : { timeout: timeoutMs }) },
        );
        if (response.status !== "completed") throw new ModelCallFailed("English reading", `response_${response.status}`);
        if (!response.output_parsed) throw new ModelCallFailed("English reading", "no_parsed_output");
        return {
          english: checkEnglishReading(response.output_parsed.english),
          tokensIn: response.usage?.input_tokens ?? null,
          tokensOut: response.usage?.output_tokens ?? null,
        };
      } catch (error) {
        throw new ModelCallFailed("English reading", upstreamErrorClass(error));
      }
    },
  };
}
