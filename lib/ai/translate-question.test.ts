import { describe, expect, it } from "vitest";
import { MAX_QUESTION_ENGLISH_CODE_POINTS, checkQuestionEnglish, renderQuestionTranslationInput } from "./translate-question";
import { ModelCallFailed } from "./upstream";

// The question-translation port's check (04 `question_translations`): what comes back is checked,
// not trusted, and a refused English writes no row.

describe("checkQuestionEnglish", () => {
  it("returns the English, trimmed", () => {
    expect(checkQuestionEnglish("  Please tell us why you applied.\n")).toBe("Please tell us why you applied.");
  });

  it("refuses a blank English", () => {
    expect(() => checkQuestionEnglish("   ")).toThrow(new ModelCallFailed("Question translation", "malformed_output"));
  });

  it("refuses a runaway output, counted in code points", () => {
    expect(checkQuestionEnglish("😀".repeat(MAX_QUESTION_ENGLISH_CODE_POINTS))).toHaveLength(MAX_QUESTION_ENGLISH_CODE_POINTS * 2);
    expect(() => checkQuestionEnglish("a".repeat(MAX_QUESTION_ENGLISH_CODE_POINTS + 1))).toThrow(ModelCallFailed);
  });

  it.each(["ひらがな", "カタカナ", "漢字", "𠮷"])("refuses Japanese script in English: %s", (script) => {
    expect(() => checkQuestionEnglish(`Please explain ${script}.`)).toThrow(new ModelCallFailed("Question translation", "malformed_output"));
  });
});

describe("renderQuestionTranslationInput", () => {
  it("gives the kind of interview and the question, nothing else", () => {
    expect(renderQuestionTranslationInput({ roundType: "ceo", body: "当社を志望した理由を教えてください。" })).toBe(
      "=== interview ===\nCEO / final\n=== question ===\n当社を志望した理由を教えてください。",
    );
  });
});
