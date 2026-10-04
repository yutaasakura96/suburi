import type { CheckReading, DigestFigure, SelfCheckSignal, Status } from "../../../lib/monitor/status";
import { NEAR_DUPLICATE_THRESHOLD } from "../../../lib/questions/near-duplicate-threshold";
import { tokyoDate, tokyoDateTime } from "../../../lib/monitor/week";

// English chrome, as on every app-level screen (10 §0). Relative imports: the unit tests load this
// file outside Next's path aliases.

/** 10 §14's names, in 12 §6's order. Home's status line uses the same names. */
export const CHECK_NAMES: Record<SelfCheckSignal, string> = {
  scoring_pending_over_24h: "Scores pending over 24 hours",
  scoring_failed_unsuperseded: "Failed scores not retried",
  spend_week_to_date_usd: "Spend this week",
  cv_spans_rejected: "CV quotes not found in text",
  cv_claims_split: "CV claims split",
  cv_claims_duplicated: "CV claims duplicated",
  cv_unclaimed_run_max: "CV longest unread run",
  cv_quotes_outside_window: "CV quotes outside window",
  round_feedback_missing_over_24h: "Rounds without feedback over 24 hours",
  backup_dump_failed: "Daily backup failed",
};

type Figures = Readonly<Record<DigestFigure, number | null>>;

const similarity = (value: number | null) => (value === null ? null : value.toFixed(3));

/** `0.412 – 0.655 – 0.871`: lowest, median, highest. `—` for a week with no near-miss (10 §14). */
export function similarityRange(figures: Figures) {
  const parts = [
    similarity(figures.digest_near_miss_similarity_min),
    similarity(figures.digest_near_miss_similarity_median),
    similarity(figures.digest_near_miss_similarity_max),
  ];
  return parts.some((part) => part === null) ? "—" : parts.join(" – ");
}

/**
 * 10 §14's "Last week" list, in order. One row per figure, but for the near-miss similarities, which
 * are one row of three: a distribution reads as one thing.
 */
export const LAST_WEEK_ROWS: readonly { key: string; name: string; hint?: string; value: (figures: Figures) => string }[] = [
  { key: "digest_rounds_started", name: "Rounds started", value: (figures) => formatValue("digest_rounds_started", figures.digest_rounds_started) },
  { key: "digest_rounds_completed", name: "Rounds completed", value: (figures) => formatValue("digest_rounds_completed", figures.digest_rounds_completed) },
  { key: "digest_tokens_in", name: "Tokens in", value: (figures) => formatValue("digest_tokens_in", figures.digest_tokens_in) },
  { key: "digest_tokens_out", name: "Tokens out", value: (figures) => formatValue("digest_tokens_out", figures.digest_tokens_out) },
  { key: "digest_spend_usd", name: "Spend", value: (figures) => formatValue("digest_spend_usd", figures.digest_spend_usd) },
  { key: "digest_near_misses", name: "Near-miss questions", value: (figures) => formatValue("digest_near_misses", figures.digest_near_misses) },
  { key: "digest_near_miss_similarity", name: "Near-miss similarity", hint: "lowest – median – highest", value: similarityRange },
  {
    key: "digest_near_duplicates_reused",
    name: "Questions reused as duplicates",
    value: (figures) => formatValue("digest_near_duplicates_reused", figures.digest_near_duplicates_reused),
  },
];

/** Under the list (10 §14). The threshold is read from the constant, never written. */
export const NEAR_MISS_NOTE = `A near-miss is a generated question that went into the bank beside a similar one, below the duplicate threshold of ${NEAR_DUPLICATE_THRESHOLD.toFixed(2)}. At or above it, the existing question is reused. The threshold is a guess; these figures are what it gets tuned from.`;

const count = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const dollars = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

function isMoney(signal: SelfCheckSignal | DigestFigure) {
  return signal === "spend_week_to_date_usd" || signal === "digest_spend_usd";
}

/** `3`, `1,071`, `$0.84`; `—` with no reading. */
export function formatValue(signal: SelfCheckSignal | DigestFigure, value: number | null) {
  if (value === null) return "—";
  return isMoney(signal) ? dollars.format(value) : count.format(value);
}

export function formatThreshold(signal: SelfCheckSignal, threshold: number | null) {
  if (threshold === null) return "—";
  return `above ${formatValue(signal, threshold)}`;
}

export function unpricedModelsText(modelIds: readonly (string | null)[]) {
  if (modelIds.length === 0) return null;
  return `Unpriced model${modelIds.length === 1 ? "" : "s"}: ${modelIds.map((id) => id ?? "missing model ID").join(", ")}.`;
}

export function stateOf(check: CheckReading): "Red" | "OK" | "No reading" {
  if (check.value === null) return "No reading";
  return check.isRed ? "Red" : "OK";
}

export function lastRunText(lastRun: Date | null) {
  return lastRun === null ? "Never" : tokyoDateTime(lastRun);
}

/** The status page's first line (10 §14), or null when `self-check` ran within 48 hours. */
export function stalenessNotice(status: Status) {
  if (!status.selfCheck.stale) return null;
  if (status.selfCheck.lastRun === null) return "Self-check has never run. Nothing below has been checked.";
  return `Self-check has not run since ${tokyoDateTime(status.selfCheck.lastRun)}. Every reading below is from that run or earlier.`;
}

/** `2026-09-21 – 2026-09-27`: the Monday and the Sunday of a Tokyo week. */
export function weekRange(start: Date, end: Date) {
  return `${tokyoDate(start)} – ${tokyoDate(new Date(end.getTime() - 1))}`;
}

/**
 * Home's one line (10 §1): the staleness sentence first, then the red checks, or null when neither.
 * Names and counts only.
 */
export function statusLine(status: Status): string | null {
  const parts: string[] = [];
  if (status.selfCheck.stale) {
    parts.push(
      status.selfCheck.lastRun === null
        ? "Self-check has never run."
        : `Self-check has not run since ${tokyoDateTime(status.selfCheck.lastRun)}.`,
    );
  }
  const red = status.checks.filter((check) => check.isRed).map((check) => {
    const unpriced = unpricedModelsText(check.unpricedModelIds);
    return unpriced ? `${CHECK_NAMES[check.signal]} (${unpriced.slice(0, -1)})` : CHECK_NAMES[check.signal];
  });
  if (red.length > 0) {
    parts.push(`${red.length} ${red.length === 1 ? "check is" : "checks are"} red: ${red.join(", ")}.`);
  }
  return parts.length === 0 ? null : parts.join(" ");
}
