import { EN_1_0 } from "./en-1.0.ts";
import { JA_1_0 } from "./ja-1.0.ts";
import type { Rubric } from "./types.ts";

// Every rubric version ever written, oldest first. Seeded from here (12 §3 step 9); a round is scored
// against the newest `rubric_versions` row in its language, resolved server-side (07 §5.4).
export const RUBRICS: readonly Rubric[] = [EN_1_0, JA_1_0];

export type { Anchors, DimensionKey, Rubric, RubricDimension, RubricLanguage } from "./types.ts";
