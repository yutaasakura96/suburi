import { and, eq, isNotNull, max } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as s from "../../db/schema";
import { tokyoDate } from "../monitor/week";
import type { ProgressLanguage, ProgressRoundType } from "./first-attempts";

// What is due (US-14, 10 §1): how long since each round type × language pair was last practised in
// realistic mode. A suggestion, never an assignment — nothing here blocks a round or scores a choice.

type Reader = Pick<NodePgDatabase, "select">;

export interface DuePair {
  readonly roundType: ProgressRoundType;
  readonly language: ProgressLanguage;
}

/** When each pair's newest completed realistic round started. A pair never practised has no entry. */
export type LastPractised = readonly (DuePair & { readonly startedAt: Date })[];

/**
 * **Completed realistic rounds only.** A practice round is not what the interval measures (US-14), and
 * an abandoned round is not a sitting (PRD §7): leaving one behind does not make its pair less due.
 */
export async function lastPractised(db: Reader, userId: string): Promise<LastPractised> {
  const rows = await db
    .select({ roundType: s.rounds.roundType, language: s.rounds.language, startedAt: max(s.rounds.startedAt) })
    .from(s.rounds)
    .where(and(eq(s.rounds.userId, userId), eq(s.rounds.mode, "realistic"), isNotNull(s.rounds.completedAt)))
    .groupBy(s.rounds.roundType, s.rounds.language);
  return rows.flatMap((row) => (row.startedAt ? [{ roundType: row.roundType, language: row.language, startedAt: row.startedAt }] : []));
}

/** How due a row reads (10 §1's rail): never practised, or a third of the longest interval on the list. */
export type Urgency = "never" | "most" | "mid" | "least";

export interface DueRow extends DuePair {
  /** Whole Asia/Tokyo days since the pair was last practised; null when it never was. */
  readonly days: number | null;
  /** The interval as a share of the longest on the list, 0–1: the spacing bar's width. Null with `days`. */
  readonly share: number | null;
  readonly urgency: Urgency;
}

/** The order a pair is listed in when nothing separates it from another: 10 §2's default first. */
export const DUE_PAIRS: readonly DuePair[] = s.ROUND_TYPES.flatMap((roundType) =>
  s.LANGUAGES.map((language) => ({ roundType, language })),
);

const DAY_MS = 86_400_000;
/** The calendar days between two instants, as the user's day counts them (06, 2026-09-28). */
function tokyoDaysBetween(earlier: Date, later: Date) {
  return Math.round((Date.parse(tokyoDate(later)) - Date.parse(tokyoDate(earlier))) / DAY_MS);
}

/**
 * The Due list (10 §1): **never-practised pairs first**, in their listed order and with no interval,
 * then the rest most overdue first. Computed from stored timestamps against `now` (PRD §7), so a
 * clock change moves what is due today and never what was recorded.
 */
export function dueList(last: LastPractised, now: Date): DueRow[] {
  const practised = DUE_PAIRS.flatMap((pair) => {
    const found = last.find((row) => row.roundType === pair.roundType && row.language === pair.language);
    return found ? [{ ...pair, days: Math.max(0, tokyoDaysBetween(found.startedAt, now)) }] : [];
  });
  const never = DUE_PAIRS.filter((pair) => !practised.some((row) => row.roundType === pair.roundType && row.language === pair.language));
  const longest = Math.max(0, ...practised.map((row) => row.days));

  return [
    ...never.map((pair) => ({ ...pair, days: null, share: null, urgency: "never" as const })),
    ...practised
      // `sort` is stable, so equal intervals keep their listed order.
      .sort((a, b) => b.days - a.days)
      .map((row) => {
        const share = longest === 0 ? 0 : row.days / longest;
        return { ...row, share, urgency: share > 2 / 3 ? ("most" as const) : share > 1 / 3 ? ("mid" as const) : ("least" as const) };
      }),
  ];
}

/** Whether anything has been practised at all: with nothing, there is nothing to be due from (10 §1). */
export function nothingPractised(rows: readonly DueRow[]) {
  return rows.every((row) => row.days === null);
}

/**
 * Setup's defaults (US-3, 10 §2): the pair at the top of the Due list, with the fact they came from.
 * Length and mode are not spacing's to choose, and stay 10 §2's: five questions, realistic.
 */
export interface DueDefaults extends DuePair {
  readonly length: 5;
  readonly mode: "realistic";
  /** `nothing` when no realistic round was ever completed; `never` for a pair not yet practised. */
  readonly reason: { readonly kind: "nothing" } | { readonly kind: "never" } | { readonly kind: "interval"; readonly days: number };
}

export function dueDefaults(rows: readonly DueRow[]): DueDefaults {
  const [top] = rows;
  const reason: DueDefaults["reason"] = nothingPractised(rows)
    ? { kind: "nothing" }
    : top.days === null
      ? { kind: "never" }
      : { kind: "interval", days: top.days };
  return { roundType: top.roundType, language: top.language, length: 5, mode: "realistic", reason };
}
