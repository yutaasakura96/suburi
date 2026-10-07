import type { DueDefaults, DueRow } from "../../../lib/progress/due";
import { FIRST_ATTEMPT_TARGET } from "../../../lib/progress/series";
import { LANGUAGE_NAMES, ROUND_TYPE_NAMES, SETUP_COPY, type RoundLanguage } from "../round/copy";

// Home's chrome (10 §1). An app-level screen, so it is written in English, one fixed app language
// (10 §0): the artboard's Japanese strings are layout, and each is replaced here.

export const HOME_COPY = {
  heading: "Home",
  due: "Due",
  // A requirement, not decoration (10 §1): the list must never read as an assignment.
  suggestion: "Suggestion only — start anything",
  roundType: (row: Pick<DueRow, "roundType">) => ROUND_TYPE_NAMES[row.roundType],
  language: (language: RoundLanguage) => LANGUAGE_NAMES[language],
  /** `18d`, or the word for a pair never practised: it has no interval and draws no bar. */
  interval: (days: number | null) => (days === null ? "Never" : `${days}d`),
  /** The interval, said in full for a reader that cannot see the row. */
  intervalSpoken: (days: number | null) =>
    days === null
      ? "never practised in a realistic round"
      : days === 0
        ? "last practised today"
        : `last practised ${days} ${days === 1 ? "day" : "days"} ago`,

  firstAttempts: "First attempts",
  count: (count: number) => `${count} / ${FIRST_ATTEMPT_TARGET}`,
  /** The track's fill: a count against a target, never a score (10 §1). Capped at the full track. */
  countShare: (count: number) => Math.min(1, count / FIRST_ATTEMPT_TARGET),

  start: "Start a round",
  defaults: (defaults: DueDefaults) =>
    `Defaults to ${ROUND_TYPE_NAMES[defaults.roundType]} · ${LANGUAGE_NAMES[defaults.language]} · ${SETUP_COPY.modes[
      defaults.mode
    ].toLowerCase()} · ${defaults.length}. All four overridable.`,
} as const;
