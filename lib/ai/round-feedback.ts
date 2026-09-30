import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import * as en from "../prompts/feedback-en-1.0.ts";
import type { Rubric, RubricLanguage } from "../rubric/types.ts";
import { FEEDBACK_MODEL } from "./models.ts";
import type { CallOptions } from "./score.ts";
import { ModelCallFailed, openAiClient, upstreamErrorClass } from "./upstream.ts";

/**
 * The round-feedback port (07 §5.12 step 3): what to fix and what worked, generated **outside any
 * transaction** from every answer's scores. An answer whose scoring ended `failed` is sent as
 * unscored, and the feedback is written without it (06, 2026-09-28). One real implementation and a
 * fake; no test calls OpenAI (11 §2).
 */

export interface FeedbackAnswer {
  readonly position: number;
  readonly prompt: string;
  readonly answer: string;
  readonly durationMs: number | null;
  readonly pace: number | null;
  /** In the rubric's order; null when the answer's scoring ended `failed`. */
  readonly scores: readonly { readonly dimension: string; readonly value: number }[] | null;
}

export interface FeedbackInput {
  readonly rubric: Rubric;
  readonly answers: readonly FeedbackAnswer[];
}

export interface FeedbackItem {
  readonly title: string;
  readonly body: string;
}

export interface RoundFeedbackResult {
  readonly toFix: readonly FeedbackItem[];
  readonly whatWorked: string;
  readonly tokensIn: number | null;
  readonly tokensOut: number | null;
}

export interface RoundFeedbackGenerator {
  readonly modelId: string;
  readonly promptVersions: Readonly<Partial<Record<RubricLanguage, string>>>;
  generate(input: FeedbackInput, options?: CallOptions): Promise<RoundFeedbackResult>;
}

/** Two or three things to fix, exactly one that worked (04 `round_feedback`) — or nothing is written. */
export function checkFeedback(toFix: readonly FeedbackItem[], whatWorked: string) {
  const blank = (text: string) => text.trim() === "";
  if (toFix.length < 2 || toFix.length > 3) throw new ModelCallFailed("Round feedback", "malformed_output");
  if (toFix.some((item) => blank(item.title) || blank(item.body)) || blank(whatWorked)) {
    throw new ModelCallFailed("Round feedback", "malformed_output");
  }
}

export function renderFeedbackInput({ rubric, answers }: FeedbackInput) {
  const labels = new Map(rubric.dimensions.map((dimension) => [dimension.key as string, dimension.label_en]));
  const paceUnit = rubric.language === "ja" ? "characters per minute" : "words per minute";
  const blocks = answers.map((answer) => {
    const seconds = answer.durationMs === null ? "unknown" : `${Math.round(answer.durationMs / 1000)} s`;
    const pace = answer.pace === null ? "unknown" : `${Math.round(answer.pace)} ${paceUnit}`;
    const scores =
      answer.scores === null
        ? "unscored"
        : answer.scores.map((score) => `${labels.get(score.dimension) ?? score.dimension} ${score.value}`).join(", ");
    return [
      `=== answer ${answer.position} ===`,
      `question: ${answer.prompt}`,
      `duration: ${seconds}; pace: ${pace}`,
      `scores: ${scores}`,
      "transcript:",
      answer.answer,
    ].join("\n");
  });
  return [`=== rubric ${rubric.language} ${rubric.versionLabel} ===`, ...blocks].join("\n\n");
}

const PROMPTS: Partial<Record<RubricLanguage, { version: string; instructions: string }>> = { en };

const output = z.object({
  to_fix: z.array(z.object({ title: z.string(), body: z.string() })),
  what_worked: z.string(),
});

export function openAiRoundFeedbackGenerator({ apiKey, baseURL }: { apiKey: string; baseURL?: string }): RoundFeedbackGenerator {
  return {
    modelId: FEEDBACK_MODEL,
    promptVersions: { en: en.version },
    async generate(input, { signal, timeoutMs } = {}) {
      const prompt = PROMPTS[input.rubric.language];
      if (!prompt) throw new ModelCallFailed("Round feedback", "no_prompt_for_language");
      try {
        const response = await openAiClient({ apiKey, baseURL }).responses.parse(
          {
            model: FEEDBACK_MODEL,
            instructions: prompt.instructions,
            input: renderFeedbackInput(input),
            text: { format: zodTextFormat(output, "round_feedback") },
          },
          { signal, ...(timeoutMs === undefined ? {} : { timeout: timeoutMs }) },
        );
        if (response.status !== "completed") throw new ModelCallFailed("Round feedback", `response_${response.status}`);
        if (!response.output_parsed) throw new ModelCallFailed("Round feedback", "no_parsed_output");
        const { to_fix: toFix, what_worked: whatWorked } = response.output_parsed;
        checkFeedback(toFix, whatWorked);
        return {
          toFix,
          whatWorked,
          tokensIn: response.usage?.input_tokens ?? null,
          tokensOut: response.usage?.output_tokens ?? null,
        };
      } catch (error) {
        throw new ModelCallFailed("Round feedback", upstreamErrorClass(error));
      }
    },
  };
}
