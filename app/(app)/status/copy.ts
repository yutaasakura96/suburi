import type { CheckReading, DigestFigure, SelfCheckSignal, Status } from "../../../lib/monitor/status";
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
};

export const FIGURE_NAMES: Record<DigestFigure, string> = {
  digest_rounds_started: "Rounds started",
  digest_rounds_completed: "Rounds completed",
  digest_tokens_in: "Tokens in",
  digest_tokens_out: "Tokens out",
  digest_spend_usd: "Spend",
};

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
  const red = status.checks.filter((check) => check.isRed).map((check) => CHECK_NAMES[check.signal]);
  if (red.length > 0) {
    parts.push(`${red.length} ${red.length === 1 ? "check is" : "checks are"} red: ${red.join(", ")}.`);
  }
  return parts.length === 0 ? null : parts.join(" ");
}
