import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import * as en from "../prompts/score-en-1.0.ts";
import * as ja from "../prompts/score-ja-1.0.ts";
import type { DimensionKey, Rubric, RubricLanguage } from "../rubric/types.ts";
import { SCORING_MODEL } from "./models.ts";
import { ModelCallFailed, openAiClient, upstreamErrorClass } from "./upstream.ts";

/**
 * The scoring port (03 §10, CONTEXT.md): **one implementation**, so a held-out set can be re-scored
 * with a different model and drift becomes visible, and a fake for tests — no test calls OpenAI
 * (11 §2). Scoring is never inlined at a call site.
 *
 * **What the scorer reads** (03 §4): the rubric version's dimensions with their anchors, the prompt as
 * asked, the **corrected** transcript — never the raw one, whose recogniser errors would cost accuracy
 * points for the machine's mistakes — and the answer's duration and pace.
 *
 * **What comes back is checked, not trusted:** exactly one integer 1–5 per rubric dimension, in the
 * rubric's order. Anything else is `malformed_output` and scores nothing. No total is asked for and
 * none is accepted (04 §6).
 */

export interface ScoringInput {
  readonly rubric: Rubric;
  readonly prompt: string;
  readonly answer: string;
  readonly durationMs: number | null;
  /** In the language's own unit (`lib/round/measures.ts`). */
  readonly pace: number | null;
}

export interface DimensionScore {
  readonly dimension: DimensionKey;
  readonly value: number;
  readonly justification: string;
}

export interface ScoringResult {
  readonly scores: readonly DimensionScore[];
  readonly tokensIn: number | null;
  readonly tokensOut: number | null;
}

export interface CallOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

export interface AnswerScorer {
  readonly modelId: string;
  /** The scoring prompt per language; part of stamp 4. */
  readonly promptVersions: Readonly<Partial<Record<RubricLanguage, string>>>;
  score(input: ScoringInput, options?: CallOptions): Promise<ScoringResult>;
}

/** One entry per rubric dimension, in order, integers 1–5 — or the whole result is refused. */
export function checkScores(rubric: Rubric, scores: readonly DimensionScore[]): readonly DimensionScore[] {
  const keys = rubric.dimensions.map((dimension) => dimension.key);
  const ordered = keys.map((key) => scores.filter((score) => score.dimension === key));
  if (scores.length !== keys.length || ordered.some((found) => found.length !== 1)) {
    throw new ModelCallFailed("Scoring", "malformed_output");
  }
  const result = ordered.map(([score]) => score);
  if (result.some((score) => !Number.isInteger(score.value) || score.value < 1 || score.value > 5)) {
    throw new ModelCallFailed("Scoring", "malformed_output");
  }
  return result;
}

function minutes(durationMs: number | null) {
  if (durationMs === null) return "unknown";
  const seconds = Math.round(durationMs / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** A dimension's name in its rubric's language, as the rubric's own definitions are (04 `rubric_versions`). */
export function dimensionLabel(rubric: Rubric, dimension: Rubric["dimensions"][number]) {
  return rubric.language === "ja" ? dimension.label_ja : dimension.label_en;
}

/** The input block the prompts describe: the rubric with its anchors, the question, the delivery, the answer. */
export function renderScoringInput({ rubric, prompt, answer, durationMs, pace }: ScoringInput) {
  const dimensions = rubric.dimensions
    .map((dimension) => {
      const anchors = dimension.definition.anchors.map((anchor, index) => `  ${index + 1}: ${anchor}`).join("\n");
      return `- ${dimension.key} (${dimensionLabel(rubric, dimension)}): ${dimension.definition.summary}\n${anchors}`;
    })
    .join("\n");
  const paceUnit = rubric.language === "ja" ? "characters per minute" : "words per minute";
  return [
    `=== rubric ${rubric.language} ${rubric.versionLabel} ===`,
    dimensions,
    "=== question ===",
    prompt,
    "=== delivery ===",
    `duration: ${minutes(durationMs)}`,
    `pace: ${pace === null ? "unknown" : `${Math.round(pace)} ${paceUnit}`}`,
    "=== answer ===",
    answer,
  ].join("\n");
}

const PROMPTS: Partial<Record<RubricLanguage, { version: string; instructions: string }>> = { en, ja };

export function openAiAnswerScorer({ apiKey, baseURL }: { apiKey: string; baseURL?: string }): AnswerScorer {
  return {
    modelId: SCORING_MODEL,
    promptVersions: { en: en.version, ja: ja.version },
    async score(input, { signal, timeoutMs } = {}) {
      const prompt = PROMPTS[input.rubric.language];
      if (!prompt) throw new ModelCallFailed("Scoring", "no_prompt_for_language");
      const keys = input.rubric.dimensions.map((dimension) => dimension.key) as [DimensionKey, ...DimensionKey[]];
      const output = z.object({
        scores: z.array(z.object({ dimension: z.enum(keys), value: z.int(), justification: z.string() })),
      });
      try {
        const response = await openAiClient({ apiKey, baseURL }).responses.parse(
          {
            model: SCORING_MODEL,
            instructions: prompt.instructions,
            input: renderScoringInput(input),
            text: { format: zodTextFormat(output, "answer_scores") },
          },
          { signal, ...(timeoutMs === undefined ? {} : { timeout: timeoutMs }) },
        );
        if (response.status !== "completed") throw new ModelCallFailed("Scoring", `response_${response.status}`);
        if (!response.output_parsed) throw new ModelCallFailed("Scoring", "no_parsed_output");
        return {
          scores: checkScores(input.rubric, response.output_parsed.scores),
          tokensIn: response.usage?.input_tokens ?? null,
          tokensOut: response.usage?.output_tokens ?? null,
        };
      } catch (error) {
        throw new ModelCallFailed("Scoring", upstreamErrorClass(error));
      }
    },
  };
}
