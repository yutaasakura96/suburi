import { describe, expect, it } from "vitest";
import { RUBRICS } from "../rubric/index";
import { FIXTURE_FEEDBACK, FIXTURE_FEEDBACK_JA } from "./fake-round-ports";
import { checkFeedback, renderFeedbackInput, translationLanguage, type FeedbackBody } from "./round-feedback";
import { ModelCallFailed } from "./upstream";

const ja = RUBRICS.find((rubric) => rubric.language === "ja")!;
const en = RUBRICS.find((rubric) => rubric.language === "en")!;

function refused(check: () => void) {
  try {
    check();
  } catch (error) {
    return error instanceof ModelCallFailed ? error.errorClass : "unexpected";
  }
  return null;
}

// PRD §4: a Japanese round's feedback has an English toggle; an English round's is English.
describe("which rounds are translated", () => {
  it("translates a Japanese round into English, and an English round into nothing", () => {
    expect(translationLanguage("ja")).toBe("en");
    expect(translationLanguage("en")).toBeNull();
  });
});

// 04 `round_feedback`: two or three to fix and exactly one that worked, written once and whole.
describe("checkFeedback", () => {
  it("accepts an English round's feedback without a translation", () => {
    expect(refused(() => checkFeedback(FIXTURE_FEEDBACK, "en"))).toBeNull();
  });

  it("accepts a Japanese round's feedback with its translation, item for item", () => {
    expect(refused(() => checkFeedback(FIXTURE_FEEDBACK_JA, "ja"))).toBeNull();
  });

  it("refuses a Japanese round's feedback with no translation", () => {
    expect(refused(() => checkFeedback({ ...FIXTURE_FEEDBACK_JA, translated: null }, "ja"))).toBe("malformed_output");
  });

  it("refuses a translation that is short an item", () => {
    const translated: FeedbackBody = { ...FIXTURE_FEEDBACK_JA.translated!, toFix: FIXTURE_FEEDBACK_JA.translated!.toFix.slice(0, 1) };
    expect(refused(() => checkFeedback({ ...FIXTURE_FEEDBACK_JA, translated }, "ja"))).toBe("malformed_output");
    const three = [...FIXTURE_FEEDBACK_JA.translated!.toFix, { title: "A third", body: "Not in the original." }];
    expect(refused(() => checkFeedback({ ...FIXTURE_FEEDBACK_JA, translated: { ...translated, toFix: three } }, "ja"))).toBe(
      "malformed_output",
    );
  });

  it("refuses a translation with a blank title, body or what-worked", () => {
    const { translated } = FIXTURE_FEEDBACK_JA;
    const blankTitle = { ...translated!, toFix: [{ title: " ", body: "x" }, translated!.toFix[1]] };
    expect(refused(() => checkFeedback({ ...FIXTURE_FEEDBACK_JA, translated: blankTitle }, "ja"))).toBe("malformed_output");
    expect(refused(() => checkFeedback({ ...FIXTURE_FEEDBACK_JA, translated: { ...translated!, whatWorked: "" } }, "ja"))).toBe(
      "malformed_output",
    );
  });

  it("still refuses one item, four items and a blank original, in either language", () => {
    const item = { title: "t", body: "b" };
    for (const toFix of [[item], [item, item, item, item], [item, { title: "", body: "b" }]]) {
      expect(refused(() => checkFeedback({ toFix, whatWorked: "w", translated: null }, "en"))).toBe("malformed_output");
    }
    expect(refused(() => checkFeedback({ toFix: [item, item], whatWorked: " ", translated: null }, "en"))).toBe("malformed_output");
  });
});

describe("renderFeedbackInput", () => {
  const answer = {
    position: 2,
    prompt: "自己PRをお願いします。",
    answer: "えー、私の強みは粘り強さです。",
    durationMs: 192_000,
    pace: 250,
    scores: ja.dimensions.map((dimension) => ({ dimension: dimension.key, value: 3 })),
  };

  it("names a Japanese rubric's dimensions in Japanese and paces in characters", () => {
    const input = renderFeedbackInput({ rubric: ja, answers: [answer] });
    expect(input).toContain("=== rubric ja v1.0 ===");
    expect(input).toContain("=== answer 2 ===");
    expect(input).toContain("duration: 192 s; pace: 250 characters per minute");
    expect(input).toContain("scores: 構成 3, 根拠 3, 関連性 3, 流暢さ 3, 正確さ 3, 長さ・配分 3, 敬語 3");
  });

  it("names an English rubric's dimensions in English and paces in words", () => {
    const scores = en.dimensions.map((dimension) => ({ dimension: dimension.key, value: 4 }));
    const input = renderFeedbackInput({ rubric: en, answers: [{ ...answer, pace: 150, scores }] });
    expect(input).toContain("pace: 150 words per minute");
    expect(input).toContain("scores: Structure 4, Evidence 4, Relevance 4, Fluency 4, Accuracy 4, Length and pacing 4");
  });
});
