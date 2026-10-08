import type { ProgressContext } from "../../../lib/progress/first-attempts";
import { FIRST_ATTEMPT_TARGET, TREND_MINIMUM, type StampChange } from "../../../lib/progress/series";
import { LANGUAGE_NAMES, type RoundLanguage } from "../round/copy";

// Progress's chrome (10 §9). An app-level screen, so it is written in English, one fixed app language
// (10 §0): the artboard's Japanese strings are layout, and each is replaced here. Data keeps its own
// language — a Japanese panel's dimension names and its 応募書類 stamp are shown as stored.

const attempts = (count: number) => `${count} first ${count === 1 ? "attempt" : "attempts"}`;

export const PROGRESS_COPY = {
  title: "Progress — Suburi",
  heading: "First attempts, realistic mode only",
  count: (language: RoundLanguage, count: number) => `${LANGUAGE_NAMES[language]} ${count} / ${FIRST_ATTEMPT_TARGET}`,
  roundTypes: "Round type",
  // Refusal #1, said where the eye looks for a total: the tabs are never summed.
  perRoundType: "One round type at a time. Never combined.",
  contexts: "Role context",
  context: { role: "Pitched at a role", general: "General practice" } as Record<ProgressContext, string>,
  // US-2: General practice is a first-class choice, and its rounds are grouped apart.
  perContext: "General-practice rounds are counted separately.",
  language: (language: RoundLanguage) => LANGUAGE_NAMES[language],

  /**
   * A panel's header (10 §9): how many first attempts it plots, and **the shortfall named** whenever
   * no trend line can be drawn yet. A trend line needs five that share every stamp (11 §3.6), so
   * after a boundary the count that matters is the count since it — the newest one, the line nearest
   * the right edge. Kept short: it shares a 543px line with the language's name.
   */
  standing: ({ count, sinceChange, shortfall }: { count: number; sinceChange: number | null; shortfall: number }) => {
    if (count === 0) return `No first attempts yet — ${TREND_MINIMUM} for a trend line`;
    const have = sinceChange === null ? attempts(count) : `${attempts(count)} · ${sinceChange} since the change`;
    return shortfall === 0 ? `${have} · trend line` : `${have} — ${shortfall} more for a trend line`;
  },

  /** A boundary's label (05 §5.4): what changed, as the stamp is stored. */
  change: (change: StampChange) => (change.kind === "rubric" ? `rubric ${change.to}` : change.kind === "model" ? `model ${change.to}` : change.to),
  changes: (changes: readonly StampChange[]) => changes.map(PROGRESS_COPY.change).join(" / "),

  notScored: (language: RoundLanguage) => `Not scored in ${LANGUAGE_NAMES[language]}`,
  none: "—",
  /** The dot's tooltip (05 §5.4): the day, the dimension and its score, and which question of its round. */
  dot: (date: string, dimension: string, score: number, position: number) => `${date} · ${dimension} ${score} · Q${position}`,
  /** A row, named for a reader that cannot see the plot. */
  row: (dimension: string, count: number) => `${dimension}: ${attempts(count)}. Use the left and right arrow keys to read each one.`,

  // The first line is the exclusion list, and it is what `lib/progress/first-attempts.ts` excludes (10 §9).
  footer: [
    [
      "Oldest on the left. Practice rounds, retries, follow-ups and typed answers are not plotted.",
      "Nor are questions practised before a realistic round, answers in the wrong language, abandoned rounds, or scores that are pending or failed.",
    ],
    [
      "A vertical line marks where the rubric, the question generator, the set pieces, the CV, or the scoring model or its prompt changed. No trend line crosses one.",
      "Hover over a dot, or focus a row and use the arrow keys, for its date and question.",
    ],
  ],
} as const;
