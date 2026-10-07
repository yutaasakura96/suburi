// Progress's arithmetic (10 §9, 05 §5.4): where the boundaries fall in a series of first attempts,
// where a trend line may be drawn, and where each mark sits in the plot. Pure, so the three things
// the screen must never get wrong — a line under five, a line across a boundary, a boundary where
// no stamp changed — are tested without a database.

/** The stamps of the attempt that scored one first attempt (04 `scoring_attempts`), with their labels. */
export interface PointStamps {
  readonly cvVersionId: string;
  readonly cvLabel: string;
  readonly rubricVersionId: string;
  readonly rubricLabel: string;
  /** Stamp 3: the generator prompt version, or a set piece's content version (06, 2026-09-27). */
  readonly generatorPromptVersion: string;
  /** Which of the two stamp 3 is: a round asks one set piece and then generated questions. */
  readonly origin: "set_piece" | "generated";
  readonly modelId: string;
  readonly scoringPromptVersion: string;
}

/** One plotted first attempt: when, which question of its round, what scored it, and its scores. */
export interface FirstAttemptPoint {
  readonly answerId: string;
  /** The day it was answered, in Asia/Tokyo. */
  readonly date: string;
  readonly position: number;
  readonly stamps: PointStamps;
  /** By dimension key. A dimension the attempt's rubric did not score has no entry — never a null. */
  readonly scores: Readonly<Record<string, number>>;
}

export type StampKind = "rubric" | "generator" | "set_pieces" | "cv" | "model" | "scoring_prompt";

/** What changed at a boundary, and what it changed to — as stored, for the label. */
export interface StampChange {
  readonly kind: StampKind;
  readonly to: string;
}

/** A boundary sits between point `before - 1` and point `before`. */
export interface Boundary {
  readonly before: number;
  readonly changes: readonly StampChange[];
}

/**
 * A boundary wherever a stamp changed between one first attempt and the next (refusal #5, 11 §3.6):
 * the CV version, the rubric version, the scoring model, the scoring prompt, and stamp 3.
 *
 * **Stamp 3 is compared within its own kind.** A round asks one set piece and then generated
 * questions, so the set pieces' content version and the generator's prompt version alternate in every
 * such round without either having changed. A boundary there would mark a change that did not happen;
 * one is drawn when a set piece's content version differs from the last set piece's, and when a
 * generated question's prompt version differs from the last generated question's.
 */
export function boundaries(points: readonly FirstAttemptPoint[]): Boundary[] {
  const found: Boundary[] = [];
  const lastStamp3: Partial<Record<PointStamps["origin"], string>> = {};
  for (const [index, { stamps }] of points.entries()) {
    const previous = points[index - 1]?.stamps;
    const changes: StampChange[] = [];
    if (previous) {
      if (stamps.rubricVersionId !== previous.rubricVersionId) changes.push({ kind: "rubric", to: stamps.rubricLabel });
      const earlier = lastStamp3[stamps.origin];
      if (earlier !== undefined && earlier !== stamps.generatorPromptVersion) {
        changes.push({ kind: stamps.origin === "set_piece" ? "set_pieces" : "generator", to: stamps.generatorPromptVersion });
      }
      if (stamps.cvVersionId !== previous.cvVersionId) changes.push({ kind: "cv", to: stamps.cvLabel });
      if (stamps.modelId !== previous.modelId) changes.push({ kind: "model", to: stamps.modelId });
      if (stamps.scoringPromptVersion !== previous.scoringPromptVersion) {
        changes.push({ kind: "scoring_prompt", to: stamps.scoringPromptVersion });
      }
    }
    lastStamp3[stamps.origin] = stamps.generatorPromptVersion;
    if (changes.length > 0) found.push({ before: index, changes });
  }
  return found;
}

/** `[start, end)` runs of points with no boundary inside: what one trend line may cover. */
export function segments(count: number, bounds: readonly Boundary[]): { readonly start: number; readonly end: number }[] {
  if (count === 0) return [];
  const cuts = [0, ...bounds.map((boundary) => boundary.before), count];
  return cuts.slice(0, -1).map((start, index) => ({ start, end: cuts[index + 1] }));
}

/** 05 §5.4: no trend line under five first attempts. */
export const TREND_MINIMUM = 5;
/** PRD §1: the count each language is measured against. */
export const FIRST_ATTEMPT_TARGET = 30;

// 05 §5.4's plot: 360×40, dots inset to x = 18 … 342, eight pixels a score step between y = 4 and 36.
export const PLOT = { width: 360, height: 40, left: 18, right: 342, top: 4, bottom: 36 } as const;

/** Oldest at the left. One point alone sits at the left edge: the series grows rightwards from it. */
export function xAt(index: number, count: number) {
  if (count <= 1) return PLOT.left;
  return PLOT.left + (index * (PLOT.right - PLOT.left)) / (count - 1);
}

/** 5 → 4, 4 → 12, 3 → 20, 2 → 28, 1 → 36. A fitted line's value is not an integer, and maps the same way. */
export function yAt(score: number) {
  return PLOT.top + (5 - score) * 8;
}

/** A boundary is drawn midway between the two points it separates. */
export function boundaryX(boundary: Boundary, count: number) {
  return (xAt(boundary.before - 1, count) + xAt(boundary.before, count)) / 2;
}

export interface TrendLine {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

/**
 * The least-squares line through one dimension's scores in one segment, or null under five (05 §5.4).
 * **One dimension, one segment**: it never reads a second dimension, and it never crosses a boundary
 * (11 §3.6). The fitted values are clamped to the scale, so the line stays inside the frame.
 */
export function trendLine(
  points: readonly FirstAttemptPoint[],
  dimension: string,
  segment: { readonly start: number; readonly end: number },
): TrendLine | null {
  const marks: { readonly x: number; readonly score: number }[] = [];
  for (let index = segment.start; index < segment.end; index += 1) {
    const score = points[index].scores[dimension];
    if (score !== undefined) marks.push({ x: xAt(index, points.length), score });
  }
  if (marks.length < TREND_MINIMUM) return null;

  const n = marks.length;
  const centreX = marks.reduce((acc, mark) => acc + mark.x, 0) / n;
  const centreScore = marks.reduce((acc, mark) => acc + mark.score, 0) / n;
  const spread = marks.reduce((acc, mark) => acc + (mark.x - centreX) ** 2, 0);
  const slope = spread === 0 ? 0 : marks.reduce((acc, mark) => acc + (mark.x - centreX) * (mark.score - centreScore), 0) / spread;
  const fitted = (x: number) => Math.min(5, Math.max(1, centreScore + slope * (x - centreX)));
  const x1 = marks[0].x;
  const x2 = marks[n - 1].x;
  return { x1, y1: yAt(fitted(x1)), x2, y2: yAt(fitted(x2)) };
}

/**
 * How a panel's series stands against the five a trend line needs, counted in its newest segment —
 * the only one a new first attempt can extend. `sinceChange` is null when no stamp has changed.
 */
export function trendStanding(count: number, bounds: readonly Boundary[]) {
  const last = segments(count, bounds).at(-1);
  const inSegment = last ? last.end - last.start : 0;
  return {
    count,
    sinceChange: bounds.length === 0 ? null : inSegment,
    shortfall: Math.max(0, TREND_MINIMUM - inSegment),
  };
}

/** A label's lane and left edge in the row above the plots: lanes stack so no two labels collide. */
export interface PlacedLabel {
  readonly text: string;
  readonly x: number;
  readonly lane: number;
}

// 9px mono at 0.06em (05 §5.4): about 5.9px a character, measured against the artboard's labels.
const LABEL_CHARACTER_WIDTH = 5.9;
const LABEL_GAP = 8;
/** 05 §5.4: the label sits 5px right of its line. */
const LABEL_OFFSET = 5;

/** Each boundary's label, in the first lane where it clears the label before it. */
export function placeLabels(labels: readonly { readonly text: string; readonly x: number }[]): PlacedLabel[] {
  const laneEnds: number[] = [];
  return labels.map(({ text, x }) => {
    const left = x + LABEL_OFFSET;
    const right = left + [...text].length * LABEL_CHARACTER_WIDTH;
    let lane = laneEnds.findIndex((end) => end + LABEL_GAP <= left);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = right;
    return { text, x: left, lane };
  });
}
