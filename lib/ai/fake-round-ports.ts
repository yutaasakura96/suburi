import type { Embedder } from "./embed";
import {
  GENERATOR_PROMPT_VERSIONS,
  type QuestionGenerationInput,
  type QuestionGenerationResult,
  type QuestionGenerator,
} from "./generate-questions";
import type { ModelHealth } from "./health";
import { EMBEDDING_DIMENSIONS } from "./models";
import type { RoundFeedbackGenerator, FeedbackInput, RoundFeedbackResult } from "./round-feedback";
import type { AnswerScorer, CallOptions, ScoringInput, ScoringResult } from "./score";
import type { Transcriber, TranscriptionInput, TranscriptionResult } from "./transcribe";

// The round loop's fakes, for tests only (11 §2: no test calls OpenAI). Each answers through a
// function the test supplies — returning a result or throwing — and counts its calls.

export function fakeScorer(
  respond: (input: ScoringInput, options: CallOptions) => ScoringResult | Promise<ScoringResult>,
): AnswerScorer & { calls: number } {
  const fake = {
    modelId: "fake-scorer-2026-01-01",
    promptVersions: { en: "score-en-fake", ja: "score-ja-fake" },
    calls: 0,
    async score(input: ScoringInput, options: CallOptions = {}) {
      fake.calls += 1;
      return respond(input, options);
    },
  };
  return fake;
}

/** Every dimension of the input's rubric at `value`. */
export function uniformScores(value: number) {
  return (input: ScoringInput): ScoringResult => ({
    scores: input.rubric.dimensions.map((dimension) => ({
      dimension: dimension.key,
      value,
      justification: "fixture",
    })),
    tokensIn: 100,
    tokensOut: 20,
  });
}

export function fakeFeedbackGenerator(
  respond: (input: FeedbackInput, options: CallOptions) => RoundFeedbackResult | Promise<RoundFeedbackResult>,
): RoundFeedbackGenerator & { calls: number; inputs: FeedbackInput[] } {
  const fake = {
    modelId: "fake-feedback-2026-01-01",
    promptVersions: { en: "feedback-en-fake", ja: "feedback-ja-fake" },
    calls: 0,
    inputs: [] as FeedbackInput[],
    async generate(input: FeedbackInput, options: CallOptions = {}) {
      fake.calls += 1;
      fake.inputs.push(input);
      return respond(input, options);
    },
  };
  return fake;
}

export const FIXTURE_FEEDBACK: RoundFeedbackResult = {
  toFix: [
    { title: "Lead with the result", body: "In answer 1, the point arrives last." },
    { title: "Name a number", body: "In answer 2, the outcome stays general." },
  ],
  whatWorked: "In answer 3, the example was concrete.",
  tokensIn: 300,
  tokensOut: 60,
};

export function fakeTranscriber(
  respond: (input: TranscriptionInput) => TranscriptionResult | Promise<TranscriptionResult>,
): Transcriber & { calls: number } {
  const fake = {
    modelId: "fake-transcriber",
    calls: 0,
    async transcribe(input: TranscriptionInput) {
      fake.calls += 1;
      return respond(input);
    },
  };
  return fake;
}

export function fakeQuestionGenerator(
  respond: (input: QuestionGenerationInput, options: CallOptions) => QuestionGenerationResult | Promise<QuestionGenerationResult>,
): QuestionGenerator & { calls: number; inputs: QuestionGenerationInput[] } {
  const fake = {
    modelId: "fake-generator-2026-01-01",
    promptVersions: GENERATOR_PROMPT_VERSIONS,
    calls: 0,
    inputs: [] as QuestionGenerationInput[],
    async generate(input: QuestionGenerationInput, options: CallOptions = {}) {
      fake.calls += 1;
      fake.inputs.push(input);
      return respond(input, options);
    },
  };
  return fake;
}

/** As many distinct questions as were asked for, numbered from `from` so two calls never collide. */
export function numberedQuestions(from = 1) {
  let next = from;
  return (input: QuestionGenerationInput): QuestionGenerationResult => ({
    questions: Array.from({ length: input.count }, () => `Generated fixture question ${next++}?`),
    tokensIn: 900,
    tokensOut: 120,
  });
}

/**
 * A unit vector at `similarity` to `axisVector(axis)` and orthogonal to every other axis's — so a
 * test states the cosine similarity it wants and the guard's decision rule is what is under test,
 * not a model (11 §3.7). `similarity` 1 is the axis itself.
 */
export function vectorNear(axis: number, similarity = 1, dimensions = EMBEDDING_DIMENSIONS): number[] {
  const vector = Array.from({ length: dimensions }, () => 0);
  vector[2 * axis] = similarity;
  vector[2 * axis + 1] = Math.sqrt(1 - similarity * similarity);
  return vector;
}

/**
 * Embeds each text with `vectorOf`, or — for a text it does not answer — on an axis of its own, so
 * unplanned texts are unlike everything.
 */
export function fakeEmbedder(
  vectorOf: (text: string) => readonly number[] | undefined = () => undefined,
): Embedder & { calls: number; texts: string[] } {
  const own = new Map<string, number>();
  const fake = {
    modelId: "fake-embedder-2026-01-01",
    calls: 0,
    texts: [] as string[],
    async embed(texts: readonly string[]) {
      fake.calls += 1;
      fake.texts.push(...texts);
      return texts.map((text) => {
        const planned = vectorOf(text);
        if (planned) return planned;
        // Axes from 100 up, clear of the low ones a test plans with.
        if (!own.has(text)) own.set(text, 100 + own.size);
        return vectorNear(own.get(text)!);
      });
    },
  };
  return fake;
}

export function fakeModelHealth(ok = true): ModelHealth & { calls: number } {
  const fake = {
    modelId: "fake-scorer-2026-01-01",
    calls: 0,
    async check() {
      fake.calls += 1;
      return ok ? { ok: true as const, latencyMs: 1 } : { ok: false as const, latencyMs: 1, errorClass: "upstream_503" };
    },
  };
  return fake;
}
