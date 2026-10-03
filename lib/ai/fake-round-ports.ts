import type { ModelHealth } from "./health";
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
