import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import * as prompt from "../prompts/translate-question-en-1.0.ts";
import { QUESTION_TRANSLATION_MODEL } from "./models.ts";
import type { CallOptions } from "./score.ts";
import { ModelCallFailed, openAiClient, upstreamErrorClass } from "./upstream.ts";

/**
 * The question-translation port (03 §4, 04 `question_translations`): one Japanese bank question's
 * English, for English help. **Called only by `scripts/translate-questions.mts`, never at round
 * time** (06, 2026-10-14, Q106-4). One real implementation and a fake; no test calls OpenAI (11 §2).
 *
 * **What comes back is checked, not trusted:** not blank, and not longer than
 * `MAX_QUESTION_ENGLISH_CODE_POINTS`. Anything else is `malformed_output`, and no row is written.
 */

export type TranslatedRoundType = "behavioural" | "technical" | "hr" | "ceo";

export interface QuestionTranslationInput {
  readonly roundType: TranslatedRoundType;
  /** The Japanese question as it is asked: `questions.body`. */
  readonly body: string;
}

export interface QuestionTranslationResult {
  readonly english: string;
  readonly tokensIn: number | null;
  readonly tokensOut: number | null;
}

export interface QuestionTranslator {
  readonly modelId: string;
  /** Stored on every row this translator writes. */
  readonly promptVersion: string;
  translate(input: QuestionTranslationInput, options?: CallOptions): Promise<QuestionTranslationResult>;
}

/** Several times the one or two sentences the prompt asks for: it refuses a runaway output, nothing shorter. */
export const MAX_QUESTION_ENGLISH_CODE_POINTS = 600;

/** The English, trimmed — or the whole result is refused: blank, or too long. */
export function checkQuestionEnglish(text: string): string {
  const english = text.trim();
  if (english === "" || Array.from(english).length > MAX_QUESTION_ENGLISH_CODE_POINTS) {
    throw new ModelCallFailed("Question translation", "malformed_output");
  }
  return english;
}

const ROUND_TYPES: Record<TranslatedRoundType, string> = {
  behavioural: "behavioural",
  technical: "technical",
  hr: "HR",
  ceo: "CEO / final",
};

/** The input block the prompt describes: the kind of interview, then the question. */
export function renderQuestionTranslationInput({ roundType, body }: QuestionTranslationInput) {
  return ["=== interview ===", ROUND_TYPES[roundType], "=== question ===", body].join("\n");
}

const output = z.object({ english: z.string() });

export function openAiQuestionTranslator({ apiKey, baseURL }: { apiKey: string; baseURL?: string }): QuestionTranslator {
  return {
    modelId: QUESTION_TRANSLATION_MODEL,
    promptVersion: prompt.version,
    async translate(input, { signal, timeoutMs } = {}) {
      try {
        const response = await openAiClient({ apiKey, baseURL }).responses.parse(
          {
            model: QUESTION_TRANSLATION_MODEL,
            instructions: prompt.instructions,
            input: renderQuestionTranslationInput(input),
            text: { format: zodTextFormat(output, "question_english") },
          },
          { signal, ...(timeoutMs === undefined ? {} : { timeout: timeoutMs }) },
        );
        if (response.status !== "completed") throw new ModelCallFailed("Question translation", `response_${response.status}`);
        if (!response.output_parsed) throw new ModelCallFailed("Question translation", "no_parsed_output");
        return {
          english: checkQuestionEnglish(response.output_parsed.english),
          tokensIn: response.usage?.input_tokens ?? null,
          tokensOut: response.usage?.output_tokens ?? null,
        };
      } catch (error) {
        throw new ModelCallFailed("Question translation", upstreamErrorClass(error));
      }
    },
  };
}
