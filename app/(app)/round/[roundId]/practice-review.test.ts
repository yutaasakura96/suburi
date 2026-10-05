import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ScoringRead } from "@/lib/round/read-round";
import type { AnsweredView, FeedbackAnswerView } from "../load";
import { AnsweredFrame } from "./answered-frame";
import { AnswerPager } from "./feedback/answer-pager";

const answer: AnsweredView = {
  answerId: "answer-1",
  position: 1,
  text: "Tell me about a project.",
  followUpVersion: null,
  again: false,
  corrected: "I led a project.",
  durationMs: 30_000,
  wpm: 120,
  rewrite: 0,
  scoring: { attempt_id: "attempt-1", status: "ok" },
};

function frame(scoring: ScoringRead) {
  return renderToStaticMarkup(
    createElement(AnsweredFrame, {
      roundId: "round-1",
      language: "en",
      dimensions: [{ key: "structure", label: "Structure" }],
      cvLabel: "CV v1",
      step: "Question 1 / 3",
      answer: { ...answer, scoring },
      next: { kind: "feedback" },
      nextStep: null,
      missingNotice: "Missing follow-up",
      busy: false,
      error: null,
      stamp: "Rubric v1",
      onGoOn: () => {},
      onAnswerAgain: () => {},
    }),
  );
}

const followUpRetry: FeedbackAnswerView = {
  position: 1,
  followUpAnswer: true,
  again: 1,
  prompt: "What did you measure?",
  own: "We measured the error rate.",
  modelAnswer: { segments: [{ text: "We tracked the error rate weekly.", unsupported: false }], translated: null },
  durationMs: 30_000,
  wpm: 120,
  rewrite: 0,
  status: "ok",
  scores: [],
  answeredIn: null,
  followUp: null,
};

describe("practice feedback frames", () => {
  it("keeps a status-only completed attempt pending until the round read supplies its score", () => {
    const partial = frame(answer.scoring);
    expect(partial).toContain('data-scoring="pending"');
    expect(partial).toContain('data-testid="scoring-pending"');

    const complete = frame({
      ...answer.scoring,
      scores: [{ dimension: "structure", value: 4 }],
      flags: [{ kind: "unsupported", span_start: 0, span_end: 1 }],
      answered_language: "en",
    });
    expect(complete).toContain('data-scoring="ok"');
    expect(complete).toContain('data-testid="score-value"');
    expect(complete).toContain('data-testid="unsupported"');
  });

  it.each([
    ["en", "Question 1 / 3 · follow-up · again", "Question 1 / 3 · follow-up · again 2"],
    ["ja", "第1問 / 3問・深掘り・再回答", "第1問 / 3問・深掘り・再回答2"],
  ] as const)("distinguishes follow-up retry pages in %s", (language, first, second) => {
    const markup = renderToStaticMarkup(
      createElement(AnswerPager, {
        roundId: "round-1",
        cvLabel: "CV v1",
        answers: [{ ...followUpRetry, again: 2 }, followUpRetry],
        length: 3,
        language,
        reading: language,
      }),
    );
    expect(markup).toContain(`>${first}</button>`);
    expect(markup.match(new RegExp(second, "g"))).toHaveLength(2);
  });

  it.each([
    ["en", "Question 1 / 3 · again 2", "Question 1 · again 2"],
    ["ja", "第1問 / 3問・再回答2", "第1問・再回答2"],
  ] as const)("numbers the bank retry heading in %s", (language, heading, label) => {
    const markup = renderToStaticMarkup(
      createElement(AnswerPager, {
        roundId: "round-1",
        cvLabel: "CV v1",
        answers: [{ ...followUpRetry, followUpAnswer: false, again: 2 }, { ...followUpRetry, followUpAnswer: false }],
        length: 3,
        language,
        reading: language,
      }),
    );
    expect(markup).toContain(`>${heading}</span>`);
    expect(markup).toContain(`>${label}</button>`);
  });
});
