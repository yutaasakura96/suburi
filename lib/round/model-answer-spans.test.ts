import { describe, expect, it } from "vitest";
import { locatedModelAnswer } from "./model-answer-spans";

describe("stored model-answer marks", () => {
  it("adds unsupported figures to both language representations and merges overlapping quotes", () => {
    const cv = "Improved response time by 20%.";
    const own = "I improved response time.";
    const english = "I improved response time by 83%.";
    expect(locatedModelAnswer({ answer: english, unsupported: [] }, cv, own).spans).toEqual([
      { start: 28, end: 31 },
    ]);

    const japanese = "応答時間を83%短縮しました。";
    const located = locatedModelAnswer(
      { answer: japanese, unsupported: [{ quote: "83%", startHint: 5 }] },
      cv,
      own,
    );
    expect(located.spans).toEqual([{ start: 5, end: 8 }]);
    expect(located.dropped).toBe(0);
  });
});
