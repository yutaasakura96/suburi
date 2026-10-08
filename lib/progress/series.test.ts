import { describe, expect, it } from "vitest";
import {
  boundaries,
  boundaryX,
  placeLabels,
  segments,
  trendLine,
  trendStanding,
  xAt,
  yAt,
  type FirstAttemptPoint,
  type PointStamps,
} from "./series";

const BASE: PointStamps = {
  cvVersionId: "cv-1",
  cvLabel: "CV v1",
  rubricVersionId: "rubric-1",
  rubricLabel: "v1.0",
  generatorPromptVersion: "generate-hr-en-1.0",
  origin: "generated",
  modelId: "model-a",
  scoringPromptVersion: "score-en-1.0",
};

function point(index: number, stamps: Partial<PointStamps> = {}, scores: Record<string, number> = { structure: 3 }): FirstAttemptPoint {
  return { answerId: `answer-${index}`, date: "2026-09-12", position: 1, stamps: { ...BASE, ...stamps }, scores };
}

describe("boundaries (11 §3.6)", () => {
  it("draws none while no stamp changes", () => {
    expect(boundaries([point(0), point(1), point(2)])).toEqual([]);
  });

  it("draws one at each stamp change: model, rubric, scoring prompt, CV, generator, set pieces", () => {
    const setPiece = { origin: "set_piece", generatorPromptVersion: "set-piece-en-1.0" } as const;
    const series = [
      point(0, setPiece),
      point(1),
      point(2, { modelId: "model-b" }),
      point(3, { modelId: "model-b", rubricVersionId: "rubric-2", rubricLabel: "v1.1" }),
      point(4, { modelId: "model-b", rubricVersionId: "rubric-2", rubricLabel: "v1.1", scoringPromptVersion: "score-en-1.1" }),
      point(5, { modelId: "model-b", rubricVersionId: "rubric-2", scoringPromptVersion: "score-en-1.1", cvVersionId: "cv-2", cvLabel: "CV v2" }),
      point(6, {
        modelId: "model-b",
        rubricVersionId: "rubric-2",
        scoringPromptVersion: "score-en-1.1",
        cvVersionId: "cv-2",
        generatorPromptVersion: "generate-hr-en-1.1",
      }),
      point(7, {
        modelId: "model-b",
        rubricVersionId: "rubric-2",
        scoringPromptVersion: "score-en-1.1",
        cvVersionId: "cv-2",
        origin: "set_piece",
        generatorPromptVersion: "set-piece-en-1.1",
      }),
    ];
    expect(boundaries(series)).toEqual([
      { before: 2, changes: [{ kind: "model", to: "model-b" }] },
      { before: 3, changes: [{ kind: "rubric", to: "v1.1" }] },
      { before: 4, changes: [{ kind: "scoring_prompt", to: "score-en-1.1" }] },
      { before: 5, changes: [{ kind: "cv", to: "CV v2" }] },
      { before: 6, changes: [{ kind: "generator", to: "generate-hr-en-1.1" }] },
      { before: 7, changes: [{ kind: "set_pieces", to: "set-piece-en-1.1" }] },
    ]);
  });

  it("draws none where a set piece and a generated question alternate with neither version changed", () => {
    const setPiece = { origin: "set_piece", generatorPromptVersion: "set-piece-en-1.0" } as const;
    expect(boundaries([point(0, setPiece), point(1), point(2), point(3, setPiece), point(4)])).toEqual([]);
  });

  it("names every stamp that changed at one boundary", () => {
    const changed = { cvVersionId: "cv-2", cvLabel: "CV v2", modelId: "model-b" };
    expect(boundaries([point(0), point(1, changed)])).toEqual([
      {
        before: 1,
        changes: [
          { kind: "cv", to: "CV v2" },
          { kind: "model", to: "model-b" },
        ],
      },
    ]);
  });
});

describe("segments", () => {
  it("is one run with no boundary, and none with no points", () => {
    expect(segments(4, [])).toEqual([{ start: 0, end: 4 }]);
    expect(segments(0, [])).toEqual([]);
  });

  it("cuts at every boundary", () => {
    expect(segments(8, [{ before: 2, changes: [] }, { before: 7, changes: [] }])).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 7 },
      { start: 7, end: 8 },
    ]);
  });
});

describe("plot layout (05 §5.4)", () => {
  it("maps a score to its line: 5 → 4, 4 → 12, 3 → 20, 2 → 28, 1 → 36", () => {
    expect([5, 4, 3, 2, 1].map(yAt)).toEqual([4, 12, 20, 28, 36]);
  });

  it("spreads points from 18 to 342, oldest first", () => {
    expect([0, 1, 2, 3].map((index) => xAt(index, 4))).toEqual([18, 126, 234, 342]);
    expect(xAt(0, 1)).toBe(18);
  });

  it("puts a boundary midway between the points it separates", () => {
    expect(boundaryX({ before: 1, changes: [] }, 4)).toBe(72);
  });
});

describe("trendLine", () => {
  const all = (count: number) => ({ start: 0, end: count });

  it("is not drawn under five first attempts", () => {
    const four = [0, 1, 2, 3].map((index) => point(index));
    expect(trendLine(four, "structure", all(4))).toBeNull();
  });

  it("is drawn at five, through the least-squares fit", () => {
    const five = [1, 2, 3, 4, 5].map((score, index) => point(index, {}, { structure: score }));
    expect(trendLine(five, "structure", all(5))).toEqual({ x1: 18, y1: yAt(1), x2: 342, y2: yAt(5) });
  });

  it("is flat for a flat series", () => {
    const flat = [0, 1, 2, 3, 4, 5].map((index) => point(index));
    expect(trendLine(flat, "structure", all(6))).toEqual({ x1: 18, y1: 20, x2: 342, y2: 20 });
  });

  it("reads one dimension only", () => {
    const series = [0, 1, 2, 3, 4].map((index) => point(index, {}, { structure: 2, evidence: 5 }));
    expect(trendLine(series, "structure", all(5))).toMatchObject({ y1: yAt(2), y2: yAt(2) });
    expect(trendLine(series, "evidence", all(5))).toMatchObject({ y1: yAt(5), y2: yAt(5) });
  });

  it("covers its own segment and nothing past the boundary", () => {
    const series = [0, 1, 2, 3, 4, 5, 6].map((index) => point(index, {}, { structure: index < 5 ? 2 : 5 }));
    const line = trendLine(series, "structure", { start: 0, end: 5 });
    expect(line).toEqual({ x1: xAt(0, 7), y1: yAt(2), x2: xAt(4, 7), y2: yAt(2) });
    expect(trendLine(series, "structure", { start: 5, end: 7 })).toBeNull();
  });

  it("counts only the points that scored the dimension", () => {
    const series = [0, 1, 2, 3, 4].map((index) => point(index, {}, index === 2 ? { evidence: 3 } : { structure: 3, evidence: 3 }));
    expect(trendLine(series, "structure", all(5))).toBeNull();
    expect(trendLine(series, "evidence", all(5))).not.toBeNull();
  });

  it("stays inside the scale", () => {
    const steep = [1, 1, 1, 1, 5, 5].map((score, index) => point(index, {}, { structure: score }));
    const line = trendLine(steep, "structure", all(6))!;
    expect(line.y1).toBeLessThanOrEqual(36);
    expect(line.y2).toBeGreaterThanOrEqual(4);
  });
});

describe("trendStanding", () => {
  it("names the shortfall under five", () => {
    expect(trendStanding(4, [])).toEqual({ count: 4, sinceChange: null, shortfall: 1 });
    expect(trendStanding(0, [])).toEqual({ count: 0, sinceChange: null, shortfall: 5 });
  });

  it("has none at five", () => {
    expect(trendStanding(8, [])).toEqual({ count: 8, sinceChange: null, shortfall: 0 });
  });

  it("counts from the last stamp change", () => {
    expect(trendStanding(8, [{ before: 6, changes: [] }])).toEqual({ count: 8, sinceChange: 2, shortfall: 3 });
  });
});

describe("placeLabels", () => {
  it("keeps labels that clear each other on one lane, 5px right of their line", () => {
    expect(placeLabels([{ text: "CV v2", x: 72 }, { text: "CV v3", x: 180 }])).toEqual([
      { text: "CV v2", x: 77, width: 32.5, align: "left", lane: 0 },
      { text: "CV v3", x: 185, width: 32.5, align: "left", lane: 0 },
    ]);
  });

  it("drops a label that would collide onto the next lane", () => {
    const placed = placeLabels([{ text: "scoring score-en-1.1", x: 72 }, { text: "CV v2", x: 100 }, { text: "CV v3", x: 300 }]);
    expect(placed.map((label) => label.lane)).toEqual([0, 1, 0]);
  });

  it("ends late labels beside their own lines and uses their drawn boxes for lanes", () => {
    const labels = placeLabels([
      { text: "CV v2", x: 150 },
      { text: "model gpt-5.6-sol-2026-10-01", x: 318 },
      { text: "応募書類 v4", x: 330 },
    ]);
    expect(labels.map((label) => label.lane)).toEqual([0, 1, 0]);
    expect(labels[1]).toMatchObject({ x: 131, width: 182, align: "right" });
    expect(labels[2]).toMatchObject({ x: 265.5, width: 59.5, align: "right" });
    expect(labels[1].x + labels[1].width).toBe(318 - 5);
    expect(labels[2].x + labels[2].width).toBe(330 - 5);
    expect(labels.every((label) => label.x >= 0 && label.x + label.width <= PLOT.width)).toBe(true);

    const long = placeLabels([{ text: "X".repeat(60), x: 300 }])[0];
    expect(long).toMatchObject({ x: 0, width: 295, align: "right", lane: 0 });
  });
});
