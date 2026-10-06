import type { Embedder } from "./embed";
import {
  GENERATOR_PROMPT_VERSIONS,
  type QuestionGenerationInput,
  type QuestionGenerationResult,
  type QuestionGenerator,
} from "./generate-questions";
import type { FollowUpGenerator, FollowUpInput, FollowUpResult } from "./follow-up";
import type { ModelHealth } from "./health";
import type { ModelAnswerGenerator, ModelAnswerInput, ModelAnswerResult } from "./model-answer";
import { EMBEDDING_DIMENSIONS } from "./models";
import type { RoundFeedbackGenerator, FeedbackInput, RoundFeedbackResult } from "./round-feedback";
import type { AnswerScorer, CallOptions, ScoringInput, ScoringResult } from "./score";
import type { Transcriber, TranscriptionInput, TranscriptionResult } from "./transcribe";
import type { SpeechInput, SpeechSynthesizer } from "./tts";

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

/** Every dimension of the input's rubric at `value`, with `grounding` as the CV check — by default an empty one. */
export function uniformScores(
  value: number,
  grounding: Partial<Pick<ScoringResult, "citations" | "unsupported" | "answeredLanguage">> = {},
) {
  return (input: ScoringInput): ScoringResult => ({
    scores: input.rubric.dimensions.map((dimension) => ({
      dimension: dimension.key,
      value,
      justification: "fixture",
    })),
    citations: [],
    unsupported: [],
    answeredLanguage: input.rubric.language,
    ...grounding,
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
    retryPromptVersions: { en: "feedback-en-retry-fake", ja: "feedback-ja-retry-fake" },
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

export function fakeFollowUpGenerator(
  respond: (input: FollowUpInput, options: CallOptions) => FollowUpResult | Promise<FollowUpResult>,
): FollowUpGenerator & { calls: number; inputs: FollowUpInput[] } {
  const fake = {
    modelId: "fake-follow-up-2026-01-01",
    promptVersions: { en: "follow-up-en-fake", ja: "follow-up-ja-fake" },
    calls: 0,
    inputs: [] as FollowUpInput[],
    async generate(input: FollowUpInput, options: CallOptions = {}) {
      fake.calls += 1;
      fake.inputs.push(input);
      return respond(input, options);
    },
  };
  return fake;
}

export const FIXTURE_FOLLOW_UP: FollowUpResult = {
  text: "How did you measure the six months?",
  tokensIn: 400,
  tokensOut: 20,
};

export const FIXTURE_FEEDBACK: RoundFeedbackResult = {
  toFix: [
    { title: "Lead with the result", body: "In answer 1, the point arrives last." },
    { title: "Name a number", body: "In answer 2, the outcome stays general." },
  ],
  whatWorked: "In answer 3, the example was concrete.",
  untouched: [],
  translated: null,
  tokensIn: 300,
  tokensOut: 60,
};

/** A Japanese round's feedback, with the English translation the toggle reads (04 `body_translated`). */
export const FIXTURE_FEEDBACK_JA: RoundFeedbackResult = {
  toFix: [
    { title: "結論を最初の一文に置く", body: "第1問で、結論が最後に出てくる。" },
    { title: "数値を一つ挙げる", body: "第2問で、成果が抽象的なままである。" },
  ],
  whatWorked: "第3問で、具体的な場面を挙げて説明できている。",
  translated: {
    toFix: [
      { title: "Put the conclusion in the first sentence", body: "In answer 1, the conclusion arrives last." },
      { title: "Name one number", body: "In answer 2, the outcome stays general." },
    ],
    whatWorked: "In answer 3, you explained with a concrete situation.",
  },
  untouched: [],
  tokensIn: 300,
  tokensOut: 120,
};

export function fakeModelAnswerGenerator(
  respond: (input: ModelAnswerInput, options: CallOptions) => ModelAnswerResult | Promise<ModelAnswerResult>,
): ModelAnswerGenerator & { calls: number; inputs: ModelAnswerInput[] } {
  const fake = {
    modelId: "fake-model-answer-2026-01-01",
    promptVersions: { en: "model-answer-en-fake", ja: "model-answer-ja-fake" },
    calls: 0,
    inputs: [] as ModelAnswerInput[],
    async generate(input: ModelAnswerInput, options: CallOptions = {}) {
      fake.calls += 1;
      fake.inputs.push(input);
      return respond(input, options);
    },
  };
  return fake;
}

/** One part the CV does not back, quoted from the answer as the model would quote it. */
export const FIXTURE_MODEL_ANSWER: ModelAnswerResult = {
  answer: "I led the payments migration and finished it in six months. I planned the cutover with a team of four.",
  unsupported: [{ quote: "a team of four", startHint: 85 }],
  translated: null,
  tokensIn: 2_000,
  tokensOut: 300,
};

/** A Japanese round's model answer, with the English the toggle reads (04 `model_answers.body_translated`). */
export const FIXTURE_MODEL_ANSWER_JA: ModelAnswerResult = {
  answer: "決済基盤の移行を担当し、半年で完了いたしました。4名のチームで切り替えを計画いたしました。",
  unsupported: [{ quote: "4名のチーム", startHint: 24 }],
  translated: {
    answer: "I was in charge of the payments platform migration and completed it in six months. I planned the cutover with a team of four.",
    unsupported: [{ quote: "a team of four", startHint: 106 }],
  },
  tokensIn: 2_400,
  tokensOut: 520,
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

/** Speaks `respond`'s bytes as one chunk, or fails as it throws; `inputs` is what it was asked to say. */
export function fakeSpeechSynthesizer(
  respond: (input: SpeechInput) => Uint8Array | Promise<Uint8Array> = () => new Uint8Array([0xff, 0xfb, 0x90, 0x00]),
): SpeechSynthesizer & { calls: number; inputs: SpeechInput[] } {
  const fake = {
    modelId: "fake-tts",
    calls: 0,
    inputs: [] as SpeechInput[],
    async synthesize(input: SpeechInput) {
      fake.calls += 1;
      fake.inputs.push(input);
      const audio = await respond(input);
      return new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(audio);
          controller.close();
        },
      });
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
