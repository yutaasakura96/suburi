// A rubric version as data (04 `rubric_versions`): its dimensions in their scored order, each with a
// definition that carries an anchor for every level 1–5 (06, 2026-09-27). The order is part of the
// version (07 §4): scores are always returned and shown in it.

export type RubricLanguage = "ja" | "en";

export type DimensionKey =
  | "structure"
  | "evidence"
  | "relevance"
  | "fluency"
  | "accuracy"
  | "length_pacing"
  | "keigo";

/** One anchor per level, index 0 being level 1. Five, always. */
export type Anchors = readonly [string, string, string, string, string];

export interface RubricDimension {
  readonly key: DimensionKey;
  readonly label_ja: string;
  readonly label_en: string;
  /** In the rubric's language: what the dimension reads, then what each level looks like. */
  readonly definition: { readonly summary: string; readonly anchors: Anchors };
}

export interface Rubric {
  /** The string screen 2 stamps (`v1.0`). */
  readonly versionLabel: string;
  readonly language: RubricLanguage;
  readonly dimensions: readonly RubricDimension[];
}
