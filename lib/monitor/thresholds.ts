/**
 * Every threshold in 12 §6, named. A signal is red when its reading is **above** its threshold, and
 * an age is over its limit only when strictly older: an attempt pending for exactly 24 hours is not
 * yet red (12 §6, 06 #55). Each constant has a unit test at, below and above it.
 */

const HOUR_MS = 60 * 60 * 1000;

/** `scoring_attempts` in `pending` for over this long. Hobby cron is daily-only (12 §6). */
export const PENDING_SCORE_MAX_HOURS = 24;

/** A completed round with no `round_feedback` for over this long (07 §5.12). */
export const ROUND_FEEDBACK_MAX_HOURS = 24;

/** The status page and Home say `self-check` has stopped once its newest run is older than this. */
export const SELF_CHECK_STALE_HOURS = 48;

/** "Any" in 12 §6: red above zero. */
export const ANY = 0;

/** `unclaimed_run_max`, in code points: a section of the CV may have gone unread (12 §6, #27). */
export const UNCLAIMED_RUN_MAX_CODE_POINTS = 2_000;

/**
 * The round-cost baseline, US dollars per round: 03 §6's estimate plus #74's model-answer spend.
 * **Replaced by the measured cost of the first eight real rounds**, with an entry in 06 (2026-09-29).
 */
export const ROUND_COST_BASELINE_USD = 0.7;

/** Week-to-date spend is red above this many baselines per round started that week. */
export const SPEND_MULTIPLE = 3;

/** The instant `hours` before `now`. Rows created strictly before it are over the limit. */
export function hoursBefore(now: Date, hours: number): Date {
  return new Date(now.getTime() - hours * HOUR_MS);
}

export function isOlderThan(at: Date, now: Date, hours: number): boolean {
  return at.getTime() < hoursBefore(now, hours).getTime();
}

/**
 * 3 × the baseline × max(1, rounds started that week), in whole cents. The floor of one round keeps a
 * week with late scoring but no round started from having a threshold of zero (06, 2026-09-29).
 */
export function spendThresholdUsd(roundsStarted: number): number {
  return Math.round(SPEND_MULTIPLE * ROUND_COST_BASELINE_USD * Math.max(1, roundsStarted) * 100) / 100;
}

/** Null is no reading, never zero, and never red. */
export function isRed(value: number | null, threshold: number): boolean {
  return value !== null && value > threshold;
}

/** No run at all is stale too: a cron that never ran must not read as "all clear". */
export function isStale(lastRun: Date | null, now: Date): boolean {
  return lastRun === null || isOlderThan(lastRun, now, SELF_CHECK_STALE_HOURS);
}
