import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import * as en from "../prompts/model-answer-en-1.0.ts";
import * as ja from "../prompts/model-answer-ja-1.0.ts";
import type { Rubric, RubricLanguage } from "../rubric/types.ts";
import type { GenerationRoleContext, GenerationRoundType } from "./generate-questions.ts";
import { MODEL_ANSWER_MODEL } from "./models.ts";
import { translationLanguage } from "./round-feedback.ts";
import { dimensionLabel, renderClaims, type CallOptions, type ModelUnsupported } from "./score.ts";
import { ModelCallFailed, openAiClient, upstreamErrorClass } from "./upstream.ts";

/**
 * The model-answer port (03 §4, 07 §5.12): how one question of a completed round could have been
 * answered, **by this candidate, from the record they really have** (06, 2026-10-04). One real
 * implementation and a fake; no test calls OpenAI (11 §2).
 *
 * **What it reads:** the kind of interview and the round's role context, the rubric's dimensions with
 * their best anchors, the claims of the round's CV version, the question exactly as it was asked, and
 * the **corrected** transcript of what the candidate said — for a follow-up, the question it followed
 * and that answer too. It reads no score: a model answer is coaching, not measurement.
 *
 * **What comes back is checked, not trusted:** an answer that is not blank and not a runaway, and —
 * for a Japanese round — the same answer in English, from the same call (PRD §4), or nothing is
 * written. **What the CV does not back comes back as the model quoted it**: verbatim runs of its own
 * answer with a start hint. None is stored as returned — `lib/round/model-answers.ts` finds each quote
 * in the answer and stores its span, and drops what it cannot find (03 §11).
 */

export interface ModelAnswerInput {
  readonly rubric: Rubric;
  readonly roundType: GenerationRoundType;
  readonly roleContext: GenerationRoleContext;
  /** The round's CV version as its claims, each sliced from the stored body, in the order they are numbered. */
  readonly claims: readonly string[];
  /** The question as it was asked. */
  readonly prompt: string;
  /** The candidate's corrected transcript. */
  readonly answer: string;
  /** Set when `prompt` is a follow-up: the question it followed, and the corrected answer it was asked about. */
  readonly parent: { readonly prompt: string; readonly answer: string } | null;
}

export interface ModelAnswerText {
  readonly answer: string;
  /** The parts of `answer` no CV claim backs, as the model quoted them. */
  readonly unsupported: readonly ModelUnsupported[];
}

export interface ModelAnswerResult extends ModelAnswerText {
  /** The same answer in English, for a Japanese round; null for an English one. */
  readonly translated: ModelAnswerText | null;
  readonly tokensIn: number | null;
  readonly tokensOut: number | null;
}

export interface ModelAnswerGenerator {
  readonly modelId: string;
  /** The model-answer prompt per language, stamped on `model_answers`. Both languages, always. */
  readonly promptVersions: Readonly<Record<RubricLanguage, string>>;
  generate(input: ModelAnswerInput, options?: CallOptions): Promise<ModelAnswerResult>;
}

/**
 * The prompts ask for at most 280 words, or 600 Japanese characters. This is several times that: it
 * refuses a runaway output, not an answer a little over its length.
 */
export const MAX_MODEL_ANSWER_CODE_POINTS = 6_000;

/**
 * The answer, trimmed — or the whole result is refused: blank, or a runaway. A Japanese round's
 * translation is held to the same, and one that is missing is refused too: a toggle that reads half
 * the feedback in English is worse than none (06, 2026-10-03).
 */
export function checkModelAnswer<T extends ModelAnswerText & { readonly translated: ModelAnswerText | null }>(
  result: T,
  language: RubricLanguage,
): T {
  const tidy = (text: ModelAnswerText) => {
    const answer = text.answer.trim();
    if (answer === "" || Array.from(answer).length > MAX_MODEL_ANSWER_CODE_POINTS) {
      throw new ModelCallFailed("Model answer", "malformed_output");
    }
    return { ...text, answer };
  };
  if (translationLanguage(language) === null) return { ...result, ...tidy(result), translated: null };
  if (result.translated === null) throw new ModelCallFailed("Model answer", "malformed_output");
  return { ...result, ...tidy(result), translated: tidy(result.translated) };
}

const ROUND_TYPES: Record<GenerationRoundType, string> = {
  behavioural: "behavioural",
  technical: "technical",
  hr: "HR",
  ceo: "CEO / final",
};

/**
 * The input block the prompts describe. What every call of one round shares — the interview, the role
 * context, the rubric and the CV's claims — comes first and the question last, so the calls a round
 * makes side by side begin alike.
 */
export function renderModelAnswerInput({ rubric, roundType, roleContext, claims, prompt, answer, parent }: ModelAnswerInput) {
  const context =
    roleContext.kind === "general"
      ? "general practice"
      : [`company: ${roleContext.companyName}`, `role: ${roleContext.roleTitle}`, "posting:", roleContext.body].join("\n");
  const dimensions = rubric.dimensions
    .map((dimension) =>
      [
        `- ${dimension.key} (${dimensionLabel(rubric, dimension)}): ${dimension.definition.summary}`,
        `  best: ${dimension.definition.anchors[4]}`,
      ].join("\n"),
    )
    .join("\n");
  return [
    "=== interview ===",
    ROUND_TYPES[roundType],
    "=== role context ===",
    context,
    `=== rubric ${rubric.language} ${rubric.versionLabel} ===`,
    dimensions,
    "=== CV claims ===",
    renderClaims(claims),
    ...(parent ? ["=== earlier in the interview ===", `question: ${parent.prompt}`, "answer:", parent.answer] : []),
    parent ? "=== follow-up question ===" : "=== question ===",
    prompt,
    "=== candidate's answer ===",
    answer,
  ].join("\n");
}

const PROMPTS: Record<RubricLanguage, { version: string; instructions: string }> = { en, ja };

const text = {
  answer: z.string(),
  unsupported: z.array(z.object({ quote: z.string(), start_hint: z.int() })),
};
const output = z.object(text);
/** What a round with a toggle is asked for: the answer, and the same answer translated. */
const outputWithTranslation = output.extend({ translated: z.object(text) });

function modelAnswerText(parsed: z.infer<typeof output>): ModelAnswerText {
  return {
    answer: parsed.answer,
    unsupported: parsed.unsupported.map((span) => ({ quote: span.quote, startHint: span.start_hint })),
  };
}

export function openAiModelAnswerGenerator({ apiKey, baseURL }: { apiKey: string; baseURL?: string }): ModelAnswerGenerator {
  return {
    modelId: MODEL_ANSWER_MODEL,
    promptVersions: { en: en.version, ja: ja.version },
    async generate(input, { signal, timeoutMs } = {}) {
      const { language } = input.rubric;
      const format = translationLanguage(language) === null ? output : outputWithTranslation;
      try {
        const response = await openAiClient({ apiKey, baseURL }).responses.parse(
          {
            model: MODEL_ANSWER_MODEL,
            instructions: PROMPTS[language].instructions,
            input: renderModelAnswerInput(input),
            text: { format: zodTextFormat(format, "model_answer") },
          },
          { signal, ...(timeoutMs === undefined ? {} : { timeout: timeoutMs }) },
        );
        if (response.status !== "completed") throw new ModelCallFailed("Model answer", `response_${response.status}`);
        if (!response.output_parsed) throw new ModelCallFailed("Model answer", "no_parsed_output");
        const parsed: z.infer<typeof output> & Partial<z.infer<typeof outputWithTranslation>> = response.output_parsed;
        return {
          ...checkModelAnswer(
            { ...modelAnswerText(parsed), translated: parsed.translated ? modelAnswerText(parsed.translated) : null },
            language,
          ),
          tokensIn: response.usage?.input_tokens ?? null,
          tokensOut: response.usage?.output_tokens ?? null,
        };
      } catch (error) {
        throw new ModelCallFailed("Model answer", upstreamErrorClass(error));
      }
    },
  };
}
