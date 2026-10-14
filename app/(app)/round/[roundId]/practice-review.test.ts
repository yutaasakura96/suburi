import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ScoringRead } from "@/lib/round/read-round";
import { ROUND_COPY, roundCopy } from "../copy";
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
      copy: ROUND_COPY.en,
      language: "en",
      chrome: "en",
      dimensions: [{ key: "structure", label: "Structure", labelEn: "Structure" }],
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

// English help, on (10 §15): a Japanese practice answer's frame under English chrome.
const japanese: AnsweredView = {
  ...answer,
  text: "最近のプロジェクトについて教えてください。",
  corrected: "チーム全体の生産性を上げました。",
  durationMs: 192_000,
  wpm: 250,
  rewrite: 3,
};

function japaneseFrame(englishHelp: boolean, scoring: ScoringRead) {
  return renderToStaticMarkup(
    createElement(AnsweredFrame, {
      roundId: "round-1",
      copy: roundCopy("ja", englishHelp),
      language: "ja",
      chrome: englishHelp ? "en" : "ja",
      dimensions: [{ key: "structure", label: "構成", labelEn: "Structure" }],
      cvLabel: "応募書類 v3",
      step: "Question 1 / 3",
      answer: { ...japanese, scoring },
      next: { kind: "follow_up", position: 1, text: "何を測りましたか。", promptVersion: "follow-up-ja-1.1" },
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
      scores: [{ dimension: "structure", value: 4, justification: null }],
      flags: [{ kind: "unsupported", span_start: 0, span_end: 1 }],
      answered_language: "en",
    });
    expect(complete).toContain('data-scoring="ok"');
    expect(complete).toContain('data-testid="score-value"');
    expect(complete).toContain('data-testid="unsupported"');
  });

  it("reads a Japanese answer's frame in English under English help, leaving what was asked and said Japanese", () => {
    const scored: ScoringRead = {
      attempt_id: "attempt-1",
      status: "ok",
      scores: [{ dimension: "structure", value: 4, justification: "結論から話せている。" }],
      flags: [{ kind: "unsupported", span_start: 0, span_end: 6 }],
      answered_language: "ja",
    };
    const on = japaneseFrame(true, scored);
    expect(on).toContain(">3 min 12 s · about 250 chars/min · rewrite 3%</span>");
    expect(on).toContain('data-dimension="Structure"');
    expect(on).not.toContain("構成");
    // 06 Q106-6: the justification is the scorer's, as written, marked as Japanese.
    expect(on).toMatch(/<span[^>]*class="sr-only"[^>]*lang="ja"[^>]*>結論から話せている。<\/span>/u);
    // The quote and the CV label keep their language inside the English sentence.
    expect(on).toContain('Unsupported — nothing in <span lang="ja">応募書類 v3</span> backs “<span lang="ja">チーム全体の</span>”.');
    expect(on).toContain('lang="ja" data-testid="answered-question">最近のプロジェクトについて教えてください。');
    expect(on).toMatch(/<p[^>]*lang="ja"[^>]*>何を測りましたか。<\/p>/u);
    expect(on).toContain(">Answer the follow-up<");
    expect(on).toContain(">Next</span>");

    const off = japaneseFrame(false, scored);
    expect(off).toContain(">3分12秒・約250字/分・書き直し 3%</span>");
    expect(off).toContain('data-dimension="構成"');
    expect(off).toContain(">深掘りに答える<");
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
