import { describe, expect, it } from "vitest";
import { HISTORY_COPY, statusLine } from "./copy";

// 10 §10's copy, in English (10 §0): the status lines are designed in, and exactly one is shown.

const scoring = (pending = 0, failed = 0) => ({ pending, failed });

describe("the rail's status line", () => {
  it("is absent for a complete round with every score in", () => {
    expect(statusLine({ status: "complete", scoring: scoring() })).toBeNull();
  });

  it("offers the retry for a complete round with a failed or a pending score", () => {
    const line = { kind: "unscored", text: "Unscored — retry scoring" };
    expect(statusLine({ status: "complete", scoring: scoring(0, 1) })).toEqual(line);
    expect(statusLine({ status: "complete", scoring: scoring(1, 0) })).toEqual(line);
  });

  it("says an abandoned round is out of progress, whatever its scores", () => {
    const line = { kind: "abandoned", text: "Abandoned — not counted in progress" };
    expect(statusLine({ status: "abandoned", scoring: scoring() })).toEqual(line);
    expect(statusLine({ status: "abandoned", scoring: scoring(1, 1) })).toEqual(line);
  });

  it("offers the newest open round for resuming rather than marking it", () => {
    expect(statusLine({ status: "in_progress", scoring: scoring(2, 0) })).toEqual({ kind: "resume", text: "In progress — resume" });
  });
});

describe("History's copy", () => {
  it("dates a round by its day in Asia/Tokyo", () => {
    // 23:30 on 11 September in UTC is 08:30 on the 12th in Tokyo.
    expect(HISTORY_COPY.date("2026-09-11T23:30:00.000Z")).toBe("2026-09-12");
  });

  it("names the round in English, whatever its language", () => {
    expect(HISTORY_COPY.roundType("behavioural")).toBe("Behavioural");
    expect(HISTORY_COPY.meta("ja", "realistic", 5)).toBe("Japanese · Realistic · 5 questions");
    expect(HISTORY_COPY.meta("en", "practice", 3)).toBe("English · Practice · 3 questions");
  });

  it("names the role context, and General practice by name", () => {
    expect(HISTORY_COPY.roleContext("general", null, null)).toBe("General practice");
    expect(HISTORY_COPY.roleContext("posting", "Example Ltd.", "SRE")).toBe("Posting: Example Ltd., SRE");
    expect(HISTORY_COPY.roleContext("researched", "Example Ltd.", null)).toBe("Researched: Example Ltd.");
    expect(HISTORY_COPY.roleContext("posting", null, null)).toBe("Posting");
  });

  it("gives the pace in the language's own unit, and no figure where none was stored", () => {
    expect(HISTORY_COPY.figures("en", 141.6, 12)).toBe("~142 wpm · rewrite 12%");
    expect(HISTORY_COPY.figures("ja", 298, 0)).toBe("~298 characters/min · rewrite 0%");
    expect(HISTORY_COPY.figures("en", null, null)).toBe("");
  });

  it("shows a take's length as a clock, and a dash where there is none", () => {
    expect(HISTORY_COPY.duration(192_000)).toBe("3:12");
    expect(HISTORY_COPY.duration(null)).toBe("—");
  });
});
