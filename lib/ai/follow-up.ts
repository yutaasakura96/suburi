import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import * as en from "../prompts/follow-up-en-1.0.ts";
import * as ja from "../prompts/follow-up-ja-1.0.ts";
import type { RubricLanguage } from "../rubric/types.ts";
import { FOLLOW_UP_MODEL } from "./models.ts";
import type { CallOptions } from "./score.ts";
import { ModelCallFailed, openAiClient, upstreamErrorClass } from "./upstream.ts";

/**
 * The follow-up port (03 §4, 07 §5.9): the one question generated from what the user just said. One
 * real implementation and a fake; no test calls OpenAI (11 §2).
 *
 * **What it reads:** the kind of interview, the question exactly as it was asked, and the
 * **corrected** transcript — never the raw one, whose recogniser errors are the machine's (10 §6).
 *
 * **What comes back is checked, not trusted:** one question, not blank and not longer than
 * `MAX_FOLLOW_UP_CODE_POINTS`. Anything else is `malformed_output`, and the caller records the
 * follow-up as missing rather than ask the user something the prompt did not allow.
 */

export type FollowUpRoundType = "behavioural" | "technical" | "hr" | "ceo";

export interface FollowUpInput {
  readonly language: RubricLanguage;
  readonly roundType: FollowUpRoundType;
  /** The question as it was asked. */
  readonly prompt: string;
  /** The corrected transcript. */
  readonly answer: string;
}

export interface FollowUpResult {
  readonly text: string;
  readonly tokensIn: number | null;
  readonly tokensOut: number | null;
}

export interface FollowUpGenerator {
  readonly modelId: string;
  /** The follow-up prompt per language: stamp 3 of the follow-up's own answer. Both languages, always. */
  readonly promptVersions: Readonly<Record<RubricLanguage, string>>;
  generate(input: FollowUpInput, options?: CallOptions): Promise<FollowUpResult>;
}

/**
 * The prompts ask for one sentence of at most 30 words, or 60 Japanese characters. This is several
 * times that: it refuses a runaway output, not a question a little over its length.
 */
export const MAX_FOLLOW_UP_CODE_POINTS = 400;

/** The question, trimmed — or the whole result is refused. */
export function checkFollowUp(text: string, language: RubricLanguage): string {
  const question = text.trim();
  const oneQuestion = language === "en"
    ? /^[^.!?。！？\r\n]+\?$/u.test(question)
    : /^(?:[^.!?。！？\r\n]+？|[^.!?。！？\r\n]+か。)$/u.test(question);
  if (!oneQuestion || Array.from(question).length > MAX_FOLLOW_UP_CODE_POINTS) {
    throw new ModelCallFailed("Follow-up generation", "malformed_output");
  }
  return question;
}

const ROUND_TYPES: Record<FollowUpRoundType, string> = {
  behavioural: "behavioural",
  technical: "technical",
  hr: "HR",
  ceo: "CEO / final",
};

/** The input block the prompts describe: the kind of interview, the question, the answer. */
export function renderFollowUpInput({ roundType, prompt, answer }: FollowUpInput) {
  return ["=== interview ===", ROUND_TYPES[roundType], "=== question ===", prompt, "=== answer ===", answer].join("\n");
}

const PROMPTS: Record<RubricLanguage, { version: string; instructions: string }> = { en, ja };

const output = z.object({ follow_up: z.string() });

export function openAiFollowUpGenerator({ apiKey, baseURL }: { apiKey: string; baseURL?: string }): FollowUpGenerator {
  return {
    modelId: FOLLOW_UP_MODEL,
    promptVersions: { en: en.version, ja: ja.version },
    async generate(input, { signal, timeoutMs } = {}) {
      const prompt = PROMPTS[input.language];
      try {
        const response = await openAiClient({ apiKey, baseURL }).responses.parse(
          {
            model: FOLLOW_UP_MODEL,
            instructions: prompt.instructions,
            input: renderFollowUpInput(input),
            text: { format: zodTextFormat(output, "follow_up") },
          },
          { signal, ...(timeoutMs === undefined ? {} : { timeout: timeoutMs }) },
        );
        if (response.status !== "completed") throw new ModelCallFailed("Follow-up generation", `response_${response.status}`);
        if (!response.output_parsed) throw new ModelCallFailed("Follow-up generation", "no_parsed_output");
        return {
          text: checkFollowUp(response.output_parsed.follow_up, input.language),
          tokensIn: response.usage?.input_tokens ?? null,
          tokensOut: response.usage?.output_tokens ?? null,
        };
      } catch (error) {
        throw new ModelCallFailed("Follow-up generation", upstreamErrorClass(error));
      }
    },
  };
}
