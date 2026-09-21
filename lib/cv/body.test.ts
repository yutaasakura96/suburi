import { describe, expect, it } from "vitest";
import { assembleBody } from "./body";
import { sliceQuote } from "./spans";

describe("assembleBody", () => {
  it("is the document's text, unchanged, when there is one", () => {
    const text = "  Led a team of 5.\r\nCut invoicing time by 40%.  ";
    expect(assembleBody([text])).toEqual({
      body: text,
      ranges: [{ start: 0, end: 48 }],
    });
  });

  it("joins documents in order with a blank line and records each range in characters", () => {
    const { body, ranges } = assembleBody(["𠮷田の履歴書", "ポートフォリオ"]);
    expect(body).toBe("𠮷田の履歴書\n\nポートフォリオ");
    expect(ranges).toEqual([
      { start: 0, end: 6 },
      { start: 8, end: 15 },
    ]);
    expect(ranges.map((range) => sliceQuote(body, range))).toEqual(["𠮷田の履歴書", "ポートフォリオ"]);
  });
});
