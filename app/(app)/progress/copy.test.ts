import { describe, expect, it } from "vitest";
import { PROGRESS_COPY as COPY } from "./copy";

// Progress's chrome (10 §9), in English (10 §0).

describe("Progress's copy", () => {
  it("counts each language's first attempts against thirty", () => {
    expect(COPY.count("ja", 12)).toBe("Japanese 12 / 30");
    expect(COPY.count("en", 9)).toBe("English 9 / 30");
  });

  // 10 §9: below five, no trend line, and the screen says how many more are needed.
  it("names the shortfall whenever no trend line can be drawn", () => {
    expect(COPY.standing({ count: 0, sinceChange: null, shortfall: 5 })).toBe("No first attempts yet — 5 for a trend line");
    expect(COPY.standing({ count: 1, sinceChange: null, shortfall: 4 })).toBe("1 first attempt — 4 more for a trend line");
    expect(COPY.standing({ count: 4, sinceChange: null, shortfall: 1 })).toBe("4 first attempts — 1 more for a trend line");
    expect(COPY.standing({ count: 8, sinceChange: null, shortfall: 0 })).toBe("8 first attempts · trend line");
  });

  // 11 §3.6: a trend line needs five that share every stamp, so a boundary starts the count again.
  it("counts from the newest boundary once there is one", () => {
    expect(COPY.standing({ count: 8, sinceChange: 3, shortfall: 2 })).toBe("8 first attempts · 3 since the change — 2 more for a trend line");
    expect(COPY.standing({ count: 12, sinceChange: 6, shortfall: 0 })).toBe("12 first attempts · 6 since the change · trend line");
  });

  it("labels a boundary with what changed, as the stamp is stored", () => {
    expect(COPY.change({ kind: "rubric", to: "v1.1" })).toBe("rubric v1.1");
    expect(COPY.change({ kind: "model", to: "gpt-5.6-sol" })).toBe("model gpt-5.6-sol");
    expect(COPY.change({ kind: "cv", to: "応募書類 v4" })).toBe("応募書類 v4");
    expect(COPY.change({ kind: "generator", to: "generate-hr-ja-1.1" })).toBe("generate-hr-ja-1.1");
    expect(COPY.change({ kind: "set_pieces", to: "set-piece-ja-1.1" })).toBe("set-piece-ja-1.1");
    expect(COPY.change({ kind: "scoring_prompt", to: "score-ja-1.1" })).toBe("score-ja-1.1");
    expect(
      COPY.changes([
        { kind: "rubric", to: "v1.1" },
        { kind: "cv", to: "CV v2" },
      ]),
    ).toBe("rubric v1.1 / CV v2");
  });

  it("writes a dot's tooltip as the day, the dimension and its score, and the question", () => {
    expect(COPY.dot("2026-09-12", "Structure", 4, 1)).toBe("2026-09-12 · Structure 4 · Q1");
  });

  // 10 §9: the footer's exclusion list must match what the data layer leaves out (11 §3.5).
  it("lists every exclusion the data layer makes, and what a boundary marks", () => {
    const footer = COPY.footer.flat().join(" ");
    for (const excluded of [
      "Practice rounds",
      "retries",
      "follow-ups",
      "typed answers",
      "questions practised before a realistic round",
      "answers in the wrong language",
      "abandoned rounds",
      "pending or failed",
    ]) {
      expect(footer).toContain(excluded);
    }
    for (const stamp of ["rubric", "question generator", "set pieces", "CV", "scoring model", "prompt"]) expect(footer).toContain(stamp);
  });

  // Refusal #1: nothing on this screen names a figure that combines dimensions, languages or types.
  it("never offers an overall, an average or a total", () => {
    const text = JSON.stringify([
      COPY.heading,
      COPY.perRoundType,
      COPY.perContext,
      COPY.footer,
      COPY.standing({ count: 8, sinceChange: 3, shortfall: 2 }),
      COPY.row("Structure", 8),
    ]).toLowerCase();
    for (const word of ["overall", "average", "total", "mean", "composite"]) expect(text).not.toContain(word);
  });
});
