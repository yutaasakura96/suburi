// The derived round status (04 `rounds`, 07 §5.5): nothing about abandonment is stored.

export type RoundStatus = "in_progress" | "abandoned" | "complete";

const TOKYO_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The calendar day in Asia/Tokyo — the user's local day, whatever the server's zone (06, 2026-09-28). */
export function tokyoDay(instant: Date) {
  return TOKYO_DAY.format(instant);
}

/**
 * Complete once `completed_at` is set. An open round is **abandoned** when the same user has started
 * a newer round, or when it was not started today in Asia/Tokyo; otherwise it is in progress, and only
 * then resumable.
 */
export function roundStatus(
  round: { readonly startedAt: Date; readonly completedAt: Date | null },
  { newerRoundExists, now }: { readonly newerRoundExists: boolean; readonly now: Date },
): RoundStatus {
  if (round.completedAt !== null) return "complete";
  if (newerRoundExists) return "abandoned";
  if (tokyoDay(round.startedAt) !== tokyoDay(now)) return "abandoned";
  return "in_progress";
}
