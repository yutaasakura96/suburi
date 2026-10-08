import { describe, expect, it } from "vitest";
import { HOME_COPY as COPY } from "./copy";

// Home's chrome (10 §1), in English (10 §0). The expected strings are 10 §1's own.

describe("Home's copy", () => {
  it("says the list is a suggestion, never an assignment", () => {
    expect(COPY.suggestion).toBe("Suggestion only — start anything");
  });

  it("writes an interval in days, and a pair never practised as a word, not as 0d", () => {
    expect(COPY.interval(18)).toBe("18d");
    expect(COPY.interval(0)).toBe("0d");
    expect(COPY.interval(null)).toBe("Never");
    expect(COPY.intervalSpoken(null)).toBe("never practised in a realistic round");
    expect(COPY.intervalSpoken(0)).toBe("last practised today");
    expect(COPY.intervalSpoken(1)).toBe("last practised 1 day ago");
    expect(COPY.intervalSpoken(18)).toBe("last practised 18 days ago");
  });

  it("counts first attempts against thirty, and fills the track no further than full", () => {
    expect(COPY.count(12)).toBe("12 / 30");
    expect(COPY.count(0)).toBe("0 / 30");
    expect(COPY.countShare(0)).toBe(0);
    expect(COPY.countShare(12)).toBeCloseTo(0.4);
    expect(COPY.countShare(41)).toBe(1);
  });

  it("names the four defaults Setup will open on, and that each can be changed", () => {
    expect(COPY.defaults({ roundType: "behavioural", language: "ja", length: 5, mode: "realistic", reason: { kind: "interval", days: 18 } })).toBe(
      "Defaults to Behavioural · Japanese · realistic · 5. All four overridable.",
    );
    expect(COPY.defaults({ roundType: "ceo", language: "en", length: 5, mode: "realistic", reason: { kind: "never" } })).toBe(
      "Defaults to CEO / final · English · realistic · 5. All four overridable.",
    );
  });
});
