import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import * as en from "../prompts/feedback-en-1.2.ts";
import type { Rubric, RubricLanguage } from "../rubric/types.ts";
import { FEEDBACK_MODEL } from "./models.ts";
import { renderClaims, type CallOptions } from "./score.ts";
import { ModelCallFailed, openAiClient, upstreamErrorClass } from "./upstream.ts";

/**
 * The round-feedback port (07 §5.12 step 3): what to fix and what worked, generated **outside any
 * transaction** from every scored answer — a follow-up's answer included, under its parent's
 * position and marked as one. An answer whose scoring ended `failed` is never sent: the feedback is
 * written without it (06, 2026-09-28). One real implementation and a fake; no test calls OpenAI
 * (11 §2).
 *
 * **Untouched material** (US-11): the call is shown the claims no answer in the round cited, numbered,
 * and picks two or three relevant ones **by number**. The numbers come back as the model gave them;
 * `lib/round/grounding.ts` resolves them against the same list and drops what names nothing.
 */

export interface FeedbackAnswer {
  readonly position: number;
  /** True for the answer to a follow-up, which shares its parent's position. */
  readonly followUp: boolean;
  readonly prompt: string;
  readonly answer: string;
  readonly durationMs: number | null;
  readonly pace: number | null;
  /** In the rubric's order. */
  readonly scores: readonly { readonly dimension: string; readonly value: number }[];
  /** The answer's unsupported spans, each sliced from the corrected text by its stored span. */
  readonly unsupported: readonly string[];
}

export interface FeedbackInput {
  readonly rubric: Rubric;
  readonly answers: readonly FeedbackAnswer[];
  /** The round's never-cited claims, each sliced from the stored body, in the order they are numbered. */
  readonly unusedClaims: readonly string[];
}

export interface FeedbackItem {
  readonly title: string;
  readonly body: string;
}

export interface RoundFeedbackResult {
  readonly toFix: readonly FeedbackItem[];
  readonly whatWorked: string;
  /** Picks from `FeedbackInput.unusedClaims`, by number from 1, as the model gave them. */
  readonly untouched: readonly number[];
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

export function renderFeedbackInput({ rubric, answers, unusedClaims }: FeedbackInput) {
  const labels = new Map(rubric.dimensions.map((dimension) => [dimension.key as string, dimension.label_en]));
  const paceUnit = rubric.language === "ja" ? "characters per minute" : "words per minute";
  const blocks = answers.map((answer) => {
    const seconds = answer.durationMs === null ? "unknown" : `${Math.round(answer.durationMs / 1000)} s`;
    const pace = answer.pace === null ? "unknown" : `${Math.round(answer.pace)} ${paceUnit}`;
    const scores = answer.scores.map((score) => `${labels.get(score.dimension) ?? score.dimension} ${score.value}`).join(", ");
    return [
      `=== answer ${answer.position}${answer.followUp ? ", follow-up" : ""} ===`,
      `question: ${answer.prompt}`,
      `duration: ${seconds}; pace: ${pace}`,
      `scores: ${scores}`,
      `not supported by the CV: ${answer.unsupported.length === 0 ? "nothing flagged" : answer.unsupported.map((quote) => JSON.stringify(quote)).join("; ")}`,
      "transcript:",
      answer.answer,
    ].join("\n");
  });
  const unused = `=== CV claims no answer in this round used ===\n${renderClaims(unusedClaims)}`;
  return [`=== rubric ${rubric.language} ${rubric.versionLabel} ===`, ...blocks, unused].join("\n\n");
}

const PROMPTS: Partial<Record<RubricLanguage, { version: string; instructions: string }>> = { en };

const output = z.object({
  to_fix: z.array(z.object({ title: z.string(), body: z.string() })),
  what_worked: z.string(),
  untouched: z.array(z.int()),
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
        const { to_fix: toFix, what_worked: whatWorked, untouched } = response.output_parsed;
        checkFeedback(toFix, whatWorked);
        return {
          toFix,
          whatWorked,
          untouched,
          tokensIn: response.usage?.input_tokens ?? null,
          tokensOut: response.usage?.output_tokens ?? null,
        };
      } catch (error) {
        throw new ModelCallFailed("Round feedback", upstreamErrorClass(error));
      }
    },
  };
}
