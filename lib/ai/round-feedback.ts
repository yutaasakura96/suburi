import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import * as en from "../prompts/feedback-en-1.1.ts";
import * as ja from "../prompts/feedback-ja-1.0.ts";
import type { Rubric, RubricLanguage } from "../rubric/types.ts";
import { FEEDBACK_MODEL } from "./models.ts";
import { dimensionLabel, renderClaims, type CallOptions } from "./score.ts";
import { ModelCallFailed, openAiClient, upstreamErrorClass } from "./upstream.ts";

/**
 * The round-feedback port (07 §5.12 step 3): what to fix and what worked, generated **outside any
 * transaction** from every scored answer. An answer whose scoring ended `failed` is never sent: the
 * feedback is written without it (06, 2026-09-28). One real implementation and a fake; no test calls
 * OpenAI (11 §2).
 *
 * **Untouched material** (US-11): the call is shown the claims no answer in the round cited, numbered,
 * and picks two or three relevant ones **by number**. The numbers come back as the model gave them;
 * `lib/round/grounding.ts` resolves them against the same list and drops what names nothing.
 *
 * **A Japanese round's feedback comes back with its English translation, in the same call** (PRD §4,
 * 04 `body_translated`): the row is written once and whole, so the translation cannot arrive later. An
 * English round has none.
 */

export interface FeedbackAnswer {
  readonly position: number;
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

export interface FeedbackBody {
  readonly toFix: readonly FeedbackItem[];
  readonly whatWorked: string;
}

export interface RoundFeedbackResult extends FeedbackBody {
  /** The same feedback in English, for a Japanese round; null for an English one. */
  readonly translated: FeedbackBody | null;
  /** Picks from `FeedbackInput.unusedClaims`, by number from 1, as the model gave them. */
  readonly untouched: readonly number[];
  readonly tokensIn: number | null;
  readonly tokensOut: number | null;
}

/** `round_feedback.body_translated` as stored (04): the other language, and the feedback in it. */
export interface TranslatedFeedback {
  readonly language: RubricLanguage;
  readonly to_fix: readonly FeedbackItem[];
  readonly what_worked: string;
}

/** The language a round's feedback is translated into, or null where there is no toggle (PRD §4). */
export function translationLanguage(language: RubricLanguage): RubricLanguage | null {
  return language === "ja" ? "en" : null;
}

export interface RoundFeedbackGenerator {
  readonly modelId: string;
  readonly promptVersions: Readonly<Partial<Record<RubricLanguage, string>>>;
  generate(input: FeedbackInput, options?: CallOptions): Promise<RoundFeedbackResult>;
}

/**
 * Two or three things to fix, exactly one that worked (04 `round_feedback`) — or nothing is written.
 * A Japanese round's translation is the same feedback, item for item: one that is missing, short an
 * item or blank is refused whole, because a toggle that shows half the feedback is worse than none.
 */
export function checkFeedback(feedback: FeedbackBody & { readonly translated: FeedbackBody | null }, language: RubricLanguage) {
  const blank = (text: string) => text.trim() === "";
  const malformed = (body: FeedbackBody) =>
    body.toFix.length < 2 ||
    body.toFix.length > 3 ||
    body.toFix.some((item) => blank(item.title) || blank(item.body)) ||
    blank(body.whatWorked);
  if (malformed(feedback)) throw new ModelCallFailed("Round feedback", "malformed_output");
  if (translationLanguage(language) === null) return;
  const { translated } = feedback;
  if (translated === null || malformed(translated) || translated.toFix.length !== feedback.toFix.length) {
    throw new ModelCallFailed("Round feedback", "malformed_output");
  }
}

export function renderFeedbackInput({ rubric, answers, unusedClaims }: FeedbackInput) {
  const labels = new Map(rubric.dimensions.map((dimension) => [dimension.key as string, dimensionLabel(rubric, dimension)]));
  const paceUnit = rubric.language === "ja" ? "characters per minute" : "words per minute";
  const blocks = answers.map((answer) => {
    const seconds = answer.durationMs === null ? "unknown" : `${Math.round(answer.durationMs / 1000)} s`;
    const pace = answer.pace === null ? "unknown" : `${Math.round(answer.pace)} ${paceUnit}`;
    const scores = answer.scores.map((score) => `${labels.get(score.dimension) ?? score.dimension} ${score.value}`).join(", ");
    return [
      `=== answer ${answer.position} ===`,
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

const PROMPTS: Partial<Record<RubricLanguage, { version: string; instructions: string }>> = { en, ja };

const body = {
  to_fix: z.array(z.object({ title: z.string(), body: z.string() })),
  what_worked: z.string(),
};
const output = z.object({ ...body, untouched: z.array(z.int()) });
/** What a round with a toggle is asked for: the feedback, and the same feedback translated. */
const outputWithTranslation = output.extend({ translated: z.object(body) });

export function openAiRoundFeedbackGenerator({ apiKey, baseURL }: { apiKey: string; baseURL?: string }): RoundFeedbackGenerator {
  return {
    modelId: FEEDBACK_MODEL,
    promptVersions: { en: en.version, ja: ja.version },
    async generate(input, { signal, timeoutMs } = {}) {
      const { language } = input.rubric;
      const prompt = PROMPTS[language];
      if (!prompt) throw new ModelCallFailed("Round feedback", "no_prompt_for_language");
      const format = translationLanguage(language) === null ? output : outputWithTranslation;
      try {
        const response = await openAiClient({ apiKey, baseURL }).responses.parse(
          {
            model: FEEDBACK_MODEL,
            instructions: prompt.instructions,
            input: renderFeedbackInput(input),
            text: { format: zodTextFormat(format, "round_feedback") },
          },
          { signal, ...(timeoutMs === undefined ? {} : { timeout: timeoutMs }) },
        );
        if (response.status !== "completed") throw new ModelCallFailed("Round feedback", `response_${response.status}`);
        if (!response.output_parsed) throw new ModelCallFailed("Round feedback", "no_parsed_output");
        const parsed: z.infer<typeof output> & Partial<z.infer<typeof outputWithTranslation>> = response.output_parsed;
        const result = {
          toFix: parsed.to_fix,
          whatWorked: parsed.what_worked,
          translated: parsed.translated ? { toFix: parsed.translated.to_fix, whatWorked: parsed.translated.what_worked } : null,
        };
        checkFeedback(result, language);
        return {
          ...result,
          untouched: parsed.untouched,
          tokensIn: response.usage?.input_tokens ?? null,
          tokensOut: response.usage?.output_tokens ?? null,
        };
      } catch (error) {
        throw new ModelCallFailed("Round feedback", upstreamErrorClass(error));
      }
    },
  };
}
