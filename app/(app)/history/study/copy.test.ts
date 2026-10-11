import { describe, expect, it } from "vitest";
import { STUDY_COPY } from "./copy";

// 10 §16's copy: an app-level screen, so English (10 §0), in screen 8's and History's words.

describe("the study view's copy", () => {
  it("names a round as History does, in English whatever its language", () => {
    expect(STUDY_COPY.roundType("behavioural")).toBe("Behavioural");
    expect(STUDY_COPY.meta("ja", "realistic", 5)).toBe("Japanese · Realistic · 5 questions");
    // 23:30 on 11 September in UTC is 08:30 on the 12th in Tokyo.
    expect(STUDY_COPY.roundName("hr", "2026-09-11T23:30:00.000Z")).toBe("HR, 2026-09-12");
  });

  it("numbers a question as the findings name it", () => {
    expect(STUDY_COPY.question(2, 5)).toBe("Question 2 / 5");
  });

  it("numbers an answer given again from the second on, as screen 8 does", () => {
    expect(STUDY_COPY.answeredAgain(1)).toBe("Answered again");
    expect(STUDY_COPY.answeredAgain(2)).toBe("Answered again 2");
  });

  it("names the round's CV stamp in the model answer's legend, as stored", () => {
    expect(STUDY_COPY.modelAnswerMarked("応募書類 v3")).toBe("Written from 応募書類 v3 and what you said. An underline marks what 応募書類 v3 does not back.");
    expect(STUDY_COPY.modelAnswerUnmarked("CV v2")).toBe("Written from CV v2 and what you said. Nothing in it is underlined as going beyond CV v2.");
  });

  it("says where a missing model answer can be written, since this screen writes nothing", () => {
    expect(STUDY_COPY.modelAnswerNotWritten).toBe("No model answer is written for this question yet. It can be written from the round's feedback.");
  });

  it("has no Japanese chrome, and no word for a combined figure", () => {
    const strings = [
      ...Object.values(STUDY_COPY).filter((value): value is string => typeof value === "string"),
      ...STUDY_COPY.footer,
      STUDY_COPY.answeredAgain(2),
      STUDY_COPY.toFix(3),
      STUDY_COPY.question(1, 3),
      STUDY_COPY.modelAnswerMarked("CV v1"),
    ];
    for (const text of strings) {
      expect(text).not.toMatch(/[぀-ヿ一-鿿]/u);
      expect(text).not.toMatch(/overall|average|total|composite/i);
    }
  });
});
