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
  type PlacedLabel,
  type TrendLine,
} from "../../../lib/progress/series";
import { RUBRICS, type RubricDimension } from "../../../lib/rubric";
import type { RoundLanguage } from "../round/copy";
import { PROGRESS_COPY as COPY } from "./copy";
import type { PlotDot } from "./dot-plot";

// One panel of Progress (10 §9) as the page draws it: a language's series, within one round type and
// one context group, laid out by `lib/progress/series.ts`. No model call and no arithmetic of its own.

export type PanelRow =
  | {
      readonly kind: "plot";
      readonly key: string;
      readonly label: string;
      readonly dots: readonly PlotDot[];
      readonly lines: readonly TrendLine[];
      /** The newest first attempt's score on this dimension: the numeral column. Null with no dot there. */
      readonly latest: number | null;
    }
  /** A dimension another language's rubric scores and this one does not: kept, because the absence is data. */
  | { readonly kind: "not_scored"; readonly key: string; readonly label: string };

export interface PanelView {
  readonly language: RoundLanguage;
  readonly status: string;
  readonly labels: readonly PlacedLabel[];
  /** How many lanes the labels take, so the row above the plots is as tall as they need. */
  readonly lanes: number;
  readonly boundaries: readonly number[];
  readonly rows: readonly PanelRow[];
}

/** The newest rubric in a language (`lib/rubric/`): the dimensions a panel plots, in their scored order. */
function rubricOf(language: RoundLanguage) {
  const rubric = RUBRICS.findLast((candidate) => candidate.language === language);
  if (!rubric) throw new Error(`no rubric for ${language}`);
  return rubric;
}

/** A dimension is named in its panel's language, as History names it (10 §0: data keeps its language). */
const labelOf = (dimension: RubricDimension, language: RoundLanguage) => (language === "ja" ? dimension.label_ja : dimension.label_en);

export function panelView(language: RoundLanguage, series: readonly FirstAttemptPoint[]): PanelView {
  const own = rubricOf(language).dimensions;
  const elsewhere = RUBRICS.filter((rubric) => rubric.language !== language)
    .flatMap((rubric) => rubric.dimensions)
    .filter((dimension, index, all) => all.findIndex((other) => other.key === dimension.key) === index)
    .filter((dimension) => !own.some((scored) => scored.key === dimension.key));

  const bounds = boundaries(series);
  const runs = segments(series.length, bounds);
  const labels = placeLabels(bounds.map((boundary) => ({ text: COPY.changes(boundary.changes), x: boundaryX(boundary, series.length) })));

  return {
    language,
    status: COPY.standing(trendStanding(series.length, bounds)),
    labels,
    lanes: Math.max(1, ...labels.map((label) => label.lane + 1)),
    boundaries: bounds.map((boundary) => boundaryX(boundary, series.length)),
    rows: [
      ...own.map((dimension): PanelRow => {
        const label = labelOf(dimension, language);
        const dots = series.flatMap((point, index) => {
          const score = point.scores[dimension.key];
          if (score === undefined) return [];
          return [{ x: xAt(index, series.length), y: yAt(score), tooltip: COPY.dot(point.date, label, score, point.position) }];
        });
        return {
          kind: "plot",
          key: dimension.key,
          label,
          dots,
          lines: runs.flatMap((run) => trendLine(series, dimension.key, run) ?? []),
          latest: series.at(-1)?.scores[dimension.key] ?? null,
        };
      }),
      ...elsewhere.map((dimension): PanelRow => ({ kind: "not_scored", key: dimension.key, label: labelOf(dimension, language) })),
    ],
  };
}
