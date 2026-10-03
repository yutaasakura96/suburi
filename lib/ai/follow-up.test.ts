import { describe, expect, it } from "vitest";
import * as en from "../prompts/follow-up-en-1.0";
import * as ja from "../prompts/follow-up-ja-1.0";
import { MAX_FOLLOW_UP_CODE_POINTS, checkFollowUp, openAiFollowUpGenerator, renderFollowUpInput } from "./follow-up";
import { FOLLOW_UP_MODEL } from "./models";
import { ModelCallFailed } from "./upstream";

// The follow-up port's own rules (07 §5.9): what the model is shown, and what is accepted back. The
// call itself is faked everywhere else (11 §2).
describe("checkFollowUp", () => {
  it("returns the question trimmed", () => {
    expect(checkFollowUp("  How did you measure it?\n")).toBe("How did you measure it?");
  });

  it.each(["", "   ", "\n\t"])("refuses a blank output %j as malformed_output", (text) => {
    expect(() => checkFollowUp(text)).toThrowError(ModelCallFailed);
    try {
      checkFollowUp(text);
    } catch (error) {
      expect((error as ModelCallFailed).errorClass).toBe("malformed_output");
    }
  });

  it("refuses a runaway output, and accepts one at the limit", () => {
    expect(checkFollowUp("a".repeat(MAX_FOLLOW_UP_CODE_POINTS))).toHaveLength(MAX_FOLLOW_UP_CODE_POINTS);
    expect(() => checkFollowUp("a".repeat(MAX_FOLLOW_UP_CODE_POINTS + 1))).toThrowError(ModelCallFailed);
  });

  it("counts code points, so a question in astral characters is not cut at half the length", () => {
    // Two UTF-16 units each: 400 of them are 800 units and still one question's worth.
    expect(() => checkFollowUp("𠮷".repeat(MAX_FOLLOW_UP_CODE_POINTS))).not.toThrow();
    expect(() => checkFollowUp("𠮷".repeat(MAX_FOLLOW_UP_CODE_POINTS + 1))).toThrowError(ModelCallFailed);
  });
});

describe("renderFollowUpInput", () => {
  it("gives the kind of interview, the question as asked and the answer, and nothing else", () => {
    expect(
      renderFollowUpInput({ language: "en", roundType: "hr", prompt: "Why are you leaving?", answer: "I want a larger scope." }),
    ).toBe(
      ["=== interview ===", "HR", "=== question ===", "Why are you leaving?", "=== answer ===", "I want a larger scope."].join("\n"),
    );
  });

  it.each([
    ["behavioural", "behavioural"],
    ["technical", "technical"],
    ["hr", "HR"],
    ["ceo", "CEO / final"],
  ] as const)("names a %s round as %s", (roundType, name) => {
    expect(renderFollowUpInput({ language: "en", roundType, prompt: "Q", answer: "A" }).split("\n")[1]).toBe(name);
  });
});

describe("openAiFollowUpGenerator", () => {
  it("stamps the pinned model and a prompt version per language", () => {
    const generator = openAiFollowUpGenerator({ apiKey: "unit-not-a-real-key" });
    expect(generator.modelId).toBe(FOLLOW_UP_MODEL);
    expect(generator.promptVersions).toEqual({ en: en.version, ja: ja.version });
  });
});
