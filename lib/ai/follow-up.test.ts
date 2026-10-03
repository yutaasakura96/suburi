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
    expect(checkFollowUp("  How did you measure it?\n", "en")).toBe("How did you measure it?");
  });

  it.each(["", "   ", "\n\t"])("refuses a blank output %j as malformed_output", (text) => {
    expect(() => checkFollowUp(text, "en")).toThrowError(ModelCallFailed);
    try {
      checkFollowUp(text, "en");
    } catch (error) {
      expect((error as ModelCallFailed).errorClass).toBe("malformed_output");
    }
  });

  it.each([
    ["en", "What did you measure? Who approved it?"],
    ["en", "That is interesting. What did you measure?"],
    ["en", "I see. how did you measure it?"],
    ["en", "You said no. why was that?"],
    ["en", "You measured the result."],
    ["ja", "何を測りましたか。誰が承認しましたか。"],
    ["ja", "興味深いです。何を測りましたか。"],
    ["ja", "その結果を測定しました。"],
    ["en", "?"],
    ["en", "Wow! What did you measure?"],
    ["en", "What did you measure\nand who approved it?"],
  ] as const)("refuses malformed %s output as malformed_output", (language, text) => {
    expect(() => checkFollowUp(text, language)).toThrowError(ModelCallFailed);
    try {
      checkFollowUp(text, language);
    } catch (error) {
      expect((error as ModelCallFailed).errorClass).toBe("malformed_output");
    }
  });

  it.each(["その数字はどう測りましたか。", "その数字はどう測りましたか？", "その数字はどう測りましたか?"])(
    "accepts a Japanese question ending %s",
    (text) => {
      expect(checkFollowUp(text, "ja")).toBe(text);
    },
  );

  // A full stop inside a figure or an abbreviation does not end a sentence: a follow-up that quotes
  // the speaker's own number is the kind the prompt asks for.
  it.each([
    ["en", "How did you bring the p95 from 1.2 s down to 0.4 s?"],
    ["en", "What changed between v1.2 and v2.0 of the rollout?"],
    ["en", "Which costs, e.g. licences or hosting, did the 12.5% saving come from?"],
    ["en", "How did the U.S. rollout compare vs. the approx. 40 stores in Japan?"],
    ["en", "What did Acme Inc. decide about the rollout?"],
    ["en", "How did Acme Co. and Initech Ltd. split the work with Globex Corp. afterwards?"],
    ["en", "What did Dr. Sato, Mr. Abe, Mrs. Ito and Ms. Ono each ask of the St. Louis team?"],
    ["ja", "障害率を40.5%下げたとのことですが、どう測りましたか。"],
  ] as const)("accepts one %s question that contains a full stop", (language, text) => {
    expect(checkFollowUp(text, language)).toBe(text);
  });

  // Not refused, and known: no conjunction rule tells this from "How did you and your manager
  // resolve it?" (06, 2026-10-03). The prompt is what asks for one thing.
  it("accepts one sentence that asks two things", () => {
    expect(() => checkFollowUp("What did you measure and who approved it?", "en")).not.toThrow();
  });

  it("refuses a runaway output, and accepts one at the limit", () => {
    expect(checkFollowUp(`${"a".repeat(MAX_FOLLOW_UP_CODE_POINTS - 1)}?`, "en")).toHaveLength(MAX_FOLLOW_UP_CODE_POINTS);
    expect(() => checkFollowUp(`${"a".repeat(MAX_FOLLOW_UP_CODE_POINTS)}?`, "en")).toThrowError(ModelCallFailed);
  });

  it("counts code points, so a question in astral characters is not cut at half the length", () => {
    expect(() => checkFollowUp(`${"𠮷".repeat(MAX_FOLLOW_UP_CODE_POINTS - 1)}？`, "ja")).not.toThrow();
    expect(() => checkFollowUp(`${"𠮷".repeat(MAX_FOLLOW_UP_CODE_POINTS)}？`, "ja")).toThrowError(ModelCallFailed);
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
