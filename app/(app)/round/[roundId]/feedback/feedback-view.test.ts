import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ROUND_COPY } from "../../copy";
import type { FeedbackAnswerView, FeedbackScreen } from "../../load";
import { AnswerPager } from "./answer-pager";
import { FeedbackView } from "./feedback-view";

// The retry control refreshes the route once its call returns; a static render has no router mounted.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

const screen: FeedbackScreen = {
  round: { id: "round-1", roundType: "hr", mode: "realistic", language: "ja", length: 1, date: "2026-10-03" },
  feltPressure: null,
  stamps: { rubricLabel: "v1.0", generatorVersions: [], cvLabel: "応募書類 v1" },
  answers: [],
  findings: { toFix: [{ title: "結論", body: "先に述べる" }], whatWorked: "具体例" },
  translated: null,
  grounding: null,
  findingsUnavailable: false,
  englishHelp: null,
};

describe("feedback reading language", () => {
  it("offers English only when the loader found something stored in English", () => {
    const untranslated = renderToStaticMarkup(createElement(FeedbackView, { screen }));
    expect(untranslated).not.toContain('data-testid="feedback-language"');
    expect(untranslated).toContain("先に述べる");

    const translated = renderToStaticMarkup(
      createElement(FeedbackView, {
        screen: {
          ...screen,
          translated: { toFix: [{ title: "Conclusion", body: "State it first" }], whatWorked: "Example" },
          englishHelp: false,
        },
      }),
    );
    expect(translated).toContain('data-testid="feedback-language"');
    expect(translated).toContain("English");
    expect(translated).toContain("先に述べる");
  });

  // 10 §8 (#106): the pill starts from the setting, and with it on the chrome is an English round's.
  it("starts from the English help setting, with the chrome in English and the findings from their translation", () => {
    const html = renderToStaticMarkup(
      createElement(FeedbackView, {
        screen: {
          ...screen,
          translated: { toFix: [{ title: "Conclusion", body: "State it first" }], whatWorked: "Example" },
          englishHelp: true,
        },
      }),
    );
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain(">日本語</button>");
    expect(html).toContain("HR</h1>");
    expect(html).toContain("Japanese · Realistic · 1 questions");
    expect(html).toContain("State it first");
    expect(html).toContain("To fix 1");
    expect(html).not.toContain("先に述べる");
  });

  it("keeps the Japanese findings, under English headings, when only something else has English", () => {
    const html = renderToStaticMarkup(createElement(FeedbackView, { screen: { ...screen, englishHelp: true } }));
    expect(html).toContain("To fix 1");
    expect(html).toContain('lang="ja" data-testid="findings"');
    expect(html).toContain('lang="en">To fix 1</h2>');
    expect(html).toContain("先に述べる");
    expect(html).not.toContain('data-testid="findings-not-ready"');
  });
});

// 10 §8, under the pager: what was said beside the model answer stored for it (04 `model_answers`).
describe("the answer texts", () => {
  const answer: FeedbackAnswerView = {
    position: 1,
    followUpAnswer: false,
    again: 0,
    prompt: "これまでの経験を教えてください。",
    own: "えー、決済基盤の移行を担当しました。",
    modelAnswer: {
      segments: [
        { text: "決済基盤の移行を担当し、", unsupported: false },
        { text: "4名のチーム", unsupported: true },
        { text: "で切り替えました。", unsupported: false },
      ],
      translated: [
        { text: "I led the payments migration with ", unsupported: false },
        { text: "a team of four", unsupported: true },
        { text: ".", unsupported: false },
      ],
    },
    durationMs: 60_000,
    wpm: 250,
    rewrite: 4,
    status: "ok",
    scores: [],
    answeredIn: null,
    followUp: null,
  };
  const render = (answers: FeedbackAnswerView[], reading: "ja" | "en" = "ja") =>
    renderToStaticMarkup(
      createElement(AnswerPager, { roundId: "round-1", answers, length: 1, language: "ja", reading, cvLabel: "応募書類 v1" }),
    );
  const ja = ROUND_COPY.ja;
  /** The CV stamp inside the legend: stored text, marked with the round's language whatever the chrome. */
  const CV = '<span lang="ja">応募書類 v1</span>';

  it("shows what was said beside the model answer, with what the CV does not back underlined and named", () => {
    const html = render([answer]);
    expect(html).toContain(`data-testid="own-answer">${answer.own}</p>`);
    expect(html).toContain('lang="ja" data-testid="model-answer">決済基盤の移行を担当し、<span');
    expect(html).toContain('data-testid="model-answer-unsupported">4名のチーム</span>で切り替えました。</p>');
    expect(html).toContain(`data-testid="model-answer-legend">${ja.modelAnswerMarked(CV)}</p>`);
    expect(html).not.toContain('data-testid="model-answer-not-written"');
    expect(html).not.toContain('data-testid="follow-up-texts"');
  });

  it("says so when the CV backs all of it", () => {
    const segments = [{ text: "決済基盤の移行を担当しました。", unsupported: false }];
    const html = render([{ ...answer, modelAnswer: { segments, translated: null } }]);
    expect(html).not.toContain('data-testid="model-answer-unsupported"');
    expect(html).toContain(`data-testid="model-answer-legend">${ja.modelAnswerUnmarked(CV)}</p>`);
  });

  it("reads the model answer in English from its stored translation, and never translates what was said", () => {
    const html = render([answer], "en");
    expect(html).toContain('lang="en" data-testid="model-answer">I led the payments migration with <span');
    expect(html).toContain('data-testid="model-answer-unsupported">a team of four</span>.</p>');
    expect(html).not.toContain("4名のチーム");
    expect(html).toContain(`lang="ja" data-testid="own-answer">${answer.own}</p>`);
    // With the pill on, the chrome is an English round's (10 §8, #106); the stored CV stamp stays.
    expect(html).toContain(ROUND_COPY.en.modelAnswer);
    expect(html).not.toContain(ja.modelAnswer);
    expect(html).toContain(`data-testid="model-answer-legend">${ROUND_COPY.en.modelAnswerMarked(CV)}</p>`);
  });

  it("shows the question's and follow-up's stored English under them only with the pill on, and says when there is none", () => {
    const followUp = { kind: "asked" as const, text: "何名で担当されましたか。", textEn: null, status: "ok" as const, own: null, modelAnswer: null };
    const english = { ...answer, promptEn: "Tell me about your experience so far.", followUp };
    const on = render([english], "en");
    expect(on).toContain('lang="ja">これまでの経験を教えてください。</p>');
    expect(on).toContain('lang="en" class="text-[13px] leading-[1.75] text-ink-5" data-testid="prompt-english">Tell me about your experience so far.</p>');
    expect(on).toContain('lang="ja">何名で担当されましたか。</span>');
    expect(on).toContain('data-testid="prompt-english-none">No English for this question yet.</p>');
    expect(on).toContain("Question 1 / 1");

    const off = render([english]);
    expect(off).not.toContain("Tell me about your experience so far.");
    expect(off).not.toContain("No English for this question yet.");
    expect(off).toContain("第1問 / 1問");
  });

  it("states an answer with no model answer and offers to write it, with no spinner", () => {
    const html = render([{ ...answer, modelAnswer: null }]);
    expect(html).toContain('data-testid="model-answer-not-written"');
    expect(html).toContain(ja.modelAnswerNotWritten);
    expect(html).toContain(ja.writeModelAnswers);
    expect(html).not.toContain('data-testid="model-answer"');
    expect(html).not.toContain(ja.writingModelAnswers);
  });

  it("gives an answered follow-up its own pair, and an unanswered or missing one none", () => {
    const asked = { kind: "asked" as const, text: "何名で担当されましたか。", status: "ok" as const };
    const followUp = { ...asked, own: "4名です。", modelAnswer: { segments: [{ text: "4名で担当いたしました。", unsupported: false }], translated: null } };
    const html = render([{ ...answer, followUp }]);
    expect(html).toContain('data-testid="follow-up-texts"');
    expect(html).toContain(ja.followUpOwnAnswer);
    expect(html).toContain(ja.followUpModelAnswer);
    expect(html).toContain("4名で担当いたしました。");

    expect(render([{ ...answer, followUp: { ...asked, own: null, modelAnswer: null } }])).not.toContain('data-testid="follow-up-texts"');
    expect(render([{ ...answer, followUp: { kind: "missing" } }])).not.toContain('data-testid="follow-up-texts"');
  });
});
