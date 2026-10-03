import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import * as behaviouralEn from "../prompts/generate-behavioural-en-1.0.ts";
import * as behaviouralJa from "../prompts/generate-behavioural-ja-1.0.ts";
import * as ceoEn from "../prompts/generate-ceo-en-1.0.ts";
import * as ceoJa from "../prompts/generate-ceo-ja-1.0.ts";
import * as hrEn from "../prompts/generate-hr-en-1.0.ts";
import * as hrJa from "../prompts/generate-hr-ja-1.0.ts";
import * as technicalEn from "../prompts/generate-technical-en-1.0.ts";
import * as technicalJa from "../prompts/generate-technical-ja-1.0.ts";
import { QUESTION_GENERATION_MODEL } from "./models.ts";
import type { CallOptions } from "./score.ts";
import { ModelCallFailed, openAiClient, upstreamErrorClass } from "./upstream.ts";

/**
 * The question-generation port (07 §5.4 step 3): new bank questions for one round type in one
 * language, from the CV version's claims and the round's role context, **at round start, outside any
 * transaction**. One real implementation and a fake; no test calls OpenAI (11 §2).
 *
 * **One prompt per round type × language**, each its own versioned file in `lib/prompts/`. The
 * version is stamp 3 on every answer to a question it wrote, so a reworded prompt draws a Progress
 * boundary (04 `questions`).
 *
 * What it returns is a candidate, not a bank row: the near-duplicate guard decides whether each is
 * inserted or mapped to a question the bank already holds (`lib/questions/near-duplicate.ts`).
 */

export type GenerationLanguage = "ja" | "en";
export type GenerationRoundType = "behavioural" | "technical" | "hr" | "ceo";

export type GenerationRoleContext =
  | { readonly kind: "general" }
  | { readonly kind: "posting"; readonly companyName: string; readonly roleTitle: string; readonly body: string };

export interface QuestionGenerationInput {
  readonly language: GenerationLanguage;
  readonly roundType: GenerationRoundType;
  readonly count: number;
  readonly roleContext: GenerationRoleContext;
  /** The round's CV version, as its claims: each sliced from the stored body by span, never model text (04). */
  readonly claims: readonly string[];
  /** Every question already in the slice, set pieces included. None is to be asked again in other words. */
  readonly existing: readonly string[];
}

export interface QuestionGenerationResult {
  /** At most `count`, each non-empty, no two the same. */
  readonly questions: readonly string[];
  readonly tokensIn: number | null;
  readonly tokensOut: number | null;
}

export interface QuestionGenerator {
  readonly modelId: string;
  /** Stamp 3 for a question this port writes, per language and round type. */
  readonly promptVersions: Readonly<Record<GenerationLanguage, Readonly<Record<GenerationRoundType, string>>>>;
  generate(input: QuestionGenerationInput, options?: CallOptions): Promise<QuestionGenerationResult>;
}

const PROMPTS: Record<GenerationLanguage, Record<GenerationRoundType, { version: string; instructions: string }>> = {
  en: { behavioural: behaviouralEn, technical: technicalEn, hr: hrEn, ceo: ceoEn },
  ja: { behavioural: behaviouralJa, technical: technicalJa, hr: hrJa, ceo: ceoJa },
};

export const GENERATOR_PROMPT_VERSIONS: QuestionGenerator["promptVersions"] = {
  en: { behavioural: behaviouralEn.version, technical: technicalEn.version, hr: hrEn.version, ceo: ceoEn.version },
  ja: { behavioural: behaviouralJa.version, technical: technicalJa.version, hr: hrJa.version, ceo: ceoJa.version },
};

/** A question as it is stored and compared: runs of whitespace collapsed, ends trimmed. */
export function tidyQuestion(text: string) {
  return text.replace(/\s+/gu, " ").trim();
}

/**
 * Tidied, blanks and repeats dropped, cut to the count asked for. **None at all is
 * `malformed_output`**; fewer than asked is not, since the guard may shorten the list further anyway
 * and the round's caller decides what a short list means.
 */
export function checkQuestions(count: number, questions: readonly string[]): readonly string[] {
  const kept = [...new Set(questions.map(tidyQuestion).filter((question) => question !== ""))].slice(0, count);
  if (kept.length === 0) throw new ModelCallFailed("Question generation", "malformed_output");
  return kept;
}

const list = (items: readonly string[]) => (items.length === 0 ? "(none)" : items.map((item) => `- ${item}`).join("\n"));

/** The input block the prompts describe. */
export function renderGenerationInput({ count, roleContext, claims, existing }: QuestionGenerationInput) {
  const context =
    roleContext.kind === "general"
      ? "general practice"
      : [`company: ${roleContext.companyName}`, `role: ${roleContext.roleTitle}`, "posting:", roleContext.body].join("\n");
  return [
    "=== questions needed ===",
    String(count),
    "=== role context ===",
    context,
    "=== cv claims ===",
    list(claims),
    "=== questions already in the bank ===",
    list(existing),
  ].join("\n");
}

const output = z.object({ questions: z.array(z.string()) });

export function openAiQuestionGenerator({ apiKey, baseURL }: { apiKey: string; baseURL?: string }): QuestionGenerator {
  return {
    modelId: QUESTION_GENERATION_MODEL,
    promptVersions: GENERATOR_PROMPT_VERSIONS,
    async generate(input, { signal, timeoutMs } = {}) {
      const prompt = PROMPTS[input.language][input.roundType];
      try {
        const response = await openAiClient({ apiKey, baseURL }).responses.parse(
          {
            model: QUESTION_GENERATION_MODEL,
            instructions: prompt.instructions,
            input: renderGenerationInput(input),
            text: { format: zodTextFormat(output, "generated_questions") },
          },
          { signal, ...(timeoutMs === undefined ? {} : { timeout: timeoutMs }) },
        );
        if (response.status !== "completed") throw new ModelCallFailed("Question generation", `response_${response.status}`);
        if (!response.output_parsed) throw new ModelCallFailed("Question generation", "no_parsed_output");
        return {
          questions: checkQuestions(input.count, response.output_parsed.questions),
          tokensIn: response.usage?.input_tokens ?? null,
          tokensOut: response.usage?.output_tokens ?? null,
        };
      } catch (error) {
        throw new ModelCallFailed("Question generation", upstreamErrorClass(error));
      }
    },
  };
}
