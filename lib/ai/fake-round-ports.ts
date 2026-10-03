import type { FollowUpGenerator, FollowUpInput, FollowUpResult } from "./follow-up";
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
