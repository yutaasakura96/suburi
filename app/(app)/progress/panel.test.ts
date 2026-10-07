import { describe, expect, it } from "vitest";
import { PLOT, type FirstAttemptPoint, type PointStamps } from "../../../lib/progress/series";
import { panelView } from "./panel";

// One panel of Progress (10 §9), laid out from a series.

const STAMPS: PointStamps = {
  cvVersionId: "cv-1",
  cvLabel: "CV v1",
  rubricVersionId: "rubric-1",
  rubricLabel: "v1.0",
  generatorPromptVersion: "generate-hr-en-1.0",
  origin: "generated",
  modelId: "model-a",
  scoringPromptVersion: "score-en-1.0",
};

const EN = { structure: 3, evidence: 3, relevance: 4, fluency: 4, accuracy: 4, length_pacing: 2 };

function point(index: number, scores: Record<string, number> = EN, stamps: Partial<PointStamps> = {}): FirstAttemptPoint {
  return { answerId: `answer-${index}`, date: `2026-09-${String(index + 1).padStart(2, "0")}`, position: 1, stamps: { ...STAMPS, ...stamps }, scores };
}

const series = (count: number) => Array.from({ length: count }, (_, index) => point(index));

describe("a Progress panel", () => {
  it("draws one row per dimension of the language's rubric, in the rubric's order", () => {
    const en = panelView("en", series(1));
    expect(en.rows.filter((row) => row.kind === "plot").map((row) => row.key)).toEqual(Object.keys(EN));
    expect(en.rows.filter((row) => row.kind === "plot").map((row) => row.label)).toEqual([
      "Structure",
      "Evidence",
      "Relevance",
      "Fluency",
      "Accuracy",
      "Length and pacing",
    ]);
    expect(panelView("ja", []).rows.map((row) => [row.kind, row.key])).toEqual([
      ["plot", "structure"],
      ["plot", "evidence"],
      ["plot", "relevance"],
      ["plot", "fluency"],
      ["plot", "accuracy"],
      ["plot", "length_pacing"],
      ["plot", "keigo"],
    ]);
  });

  // 10 §9: the row is kept, not removed — the absence is data.
  it("keeps keigo as a not-scored row in English, with no plot and no numeral", () => {
    const en = panelView("en", series(6));
    expect(en.rows.at(-1)).toEqual({ kind: "not_scored", key: "keigo", label: "Keigo (register)" });
    expect(en.rows).toHaveLength(7);
  });

  it("draws no trend line under five first attempts, and says how many more it needs", () => {
    const four = panelView("en", series(4));
    expect(four.status).toBe("4 first attempts — 1 more for a trend line");
    for (const row of four.rows) if (row.kind === "plot") expect(row.lines).toEqual([]);
    for (const row of four.rows) if (row.kind === "plot") expect(row.dots).toHaveLength(4);

    const five = panelView("en", series(5));
    expect(five.status).toBe("5 first attempts · trend line");
    for (const row of five.rows) if (row.kind === "plot") expect(row.lines).toHaveLength(1);
  });

  it("shows every row with no dots and no numeral before the first attempt", () => {
    const empty = panelView("ja", []);
    expect(empty.status).toBe("No first attempts yet — 5 for a trend line");
    expect(empty.boundaries).toEqual([]);
    for (const row of empty.rows) expect(row).toMatchObject({ kind: "plot", dots: [], lines: [], latest: null });
  });

  it("puts the newest first attempt's score in the numeral column, and writes each dot's tooltip", () => {
    const view = panelView("en", [point(0), point(1, { ...EN, structure: 5 })]);
    const [structure, evidence] = view.rows;
    expect(structure).toMatchObject({ kind: "plot", latest: 5 });
    expect(evidence).toMatchObject({ kind: "plot", latest: 3 });
    if (structure.kind !== "plot") throw new Error("expected a plot row");
    expect(structure.dots.map((dot) => dot.tooltip)).toEqual(["2026-09-01 · Structure 3 · Q1", "2026-09-02 · Structure 5 · Q1"]);
    expect(structure.dots[0].x).toBe(PLOT.left);
    expect(structure.dots[1].x).toBe(PLOT.right);
  });

  // 11 §3.6: a boundary where a stamp changed, labelled, and no trend line across it.
  it("draws a labelled boundary where a stamp changed, and a trend line only inside a segment of five", () => {
    const later = { scoringPromptVersion: "score-en-1.1" };
    const view = panelView("en", [...series(5), point(5, EN, later), point(6, EN, later), point(7, EN, later)]);
    expect(view.boundaries).toHaveLength(1);
    expect(view.labels.map((label) => label.text)).toEqual(["score-en-1.1"]);
    expect(view.status).toBe("8 first attempts · 3 since the change — 2 more for a trend line");
    const [structure] = view.rows;
    if (structure.kind !== "plot") throw new Error("expected a plot row");
    expect(structure.lines).toHaveLength(1);
    expect(structure.lines[0].x2).toBeLessThan(view.boundaries[0]);
  });

  it("leaves a dimension the answer was not scored on without a dot, rather than plotting a zero", () => {
    const { structure: _structure, ...rest } = EN;
    void _structure;
    const [structure] = panelView("en", [point(0, rest)]).rows;
    expect(structure).toMatchObject({ kind: "plot", dots: [], latest: null });
  });
});
