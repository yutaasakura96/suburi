import type { Metadata } from "next";
import { requireSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { loadStatus } from "@/lib/monitor/status";
import {
  CHECK_NAMES,
  FIGURE_NAMES,
  formatThreshold,
  formatValue,
  lastRunText,
  stalenessNotice,
  stateOf,
  unpricedModelsText,
  weekRange,
} from "./copy";

export const metadata: Metadata = {
  title: "Status — Suburi",
};

const sectionLabel = "font-mono text-[11px] tracking-[0.16em] text-ink-label uppercase";
const row = "border-b border-rule-hairline py-[11px]";

const JOBS = [
  { key: "selfCheck", name: "Self-check", schedule: "Daily, 04:00–05:00" },
  { key: "digest", name: "Weekly digest", schedule: "Mondays, 05:00–06:00" },
] as const;

const STATE_INK = { Red: "font-medium text-attention-ink", OK: "text-ink-4", "No reading": "text-ink-9" } as const;

/**
 * The status page (10 §14): whether scores are landing and spend is where it should be, and whether
 * the job that checks is still running. The user's own page behind the session, not an admin route
 * (07 §6); it reads the newest runs and never writes. Counts only: no ids, no record text (12 §7).
 */
export default async function StatusPage() {
  const userId = await requireSession();
  const status = await loadStatus(getDb(), userId, new Date());
  const notice = stalenessNotice(status);
  const { lastWeek } = status;

  return (
    <main className="w-[1280px] px-[44px] py-[40px]">
      <section aria-labelledby="status-heading" className="border border-rule-frame bg-surface">
        <div className="border-b border-rule-frame px-[32px] py-[20px]">
          <h1 id="status-heading" className={sectionLabel}>
            Status
          </h1>
        </div>
        <div className="flex flex-col gap-[28px] px-[32px] pt-[26px] pb-[32px]">
          {notice ? (
            <div className="flex gap-[10px]" role="status" data-testid="status-staleness">
              <span aria-hidden className="w-[3px] shrink-0 self-stretch bg-attention-mark" />
              <p className="text-[12px] leading-[1.7] text-ink-3">{notice}</p>
            </div>
          ) : null}

          <section aria-labelledby="jobs-heading" className="flex flex-col gap-[10px]">
            <h2 id="jobs-heading" className={sectionLabel}>
              Jobs
            </h2>
            <ul>
              {JOBS.map((job) => {
                const lastRun = status[job.key].lastRun;
                return (
                  <li key={job.key} className={`${row} flex items-baseline gap-[18px]`} data-testid={`job-${job.key}`}>
                    <span className="text-[13px] text-ink-2">{job.name}</span>
                    <span className="text-[12px] text-ink-6">{job.schedule}</span>
                    <span className={`ml-auto font-mono text-[12px] ${lastRun ? "text-ink-3" : "text-ink-9"}`}>
                      {lastRunText(lastRun)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>

          <section aria-labelledby="checks-heading" className="flex flex-col gap-[10px]">
            <h2 id="checks-heading" className={sectionLabel}>
              Checks
            </h2>
            <table className="w-full border-collapse">
              <thead className="sr-only">
                <tr>
                  <th>Check</th>
                  <th>Reading</th>
                  <th>Threshold</th>
                  <th>State</th>
                </tr>
              </thead>
              <tbody>
                {status.checks.map((check) => {
                  const state = stateOf(check);
                  return (
                    <tr key={check.signal} className="border-b border-rule-hairline" data-testid={`check-${check.signal}`}>
                      <td className="py-[11px] text-[13px] text-ink-2">
                        {CHECK_NAMES[check.signal]}
                        {unpricedModelsText(check.unpricedModelIds) ? (
                          <span className="block text-[12px] text-attention-ink">{unpricedModelsText(check.unpricedModelIds)}</span>
                        ) : null}
                      </td>
                      <td className={`w-[140px] py-[11px] text-right font-mono text-[13px] ${check.value === null ? "text-ink-9" : "text-ink-2"}`}>
                        {formatValue(check.signal, check.value)}
                      </td>
                      <td className={`w-[160px] py-[11px] text-right font-mono text-[12px] ${check.threshold === null ? "text-ink-9" : "text-ink-label"}`}>
                        {formatThreshold(check.signal, check.threshold)}
                      </td>
                      <td className={`w-[96px] py-[11px] text-right text-[12px] ${STATE_INK[state]}`}>{state}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="text-[12px] leading-[1.7] text-ink-6">
              Spend counts the stored token columns only, priced at lib/ai/models.ts&apos;s rates. Unpriced
              models are named and excluded from the dollar figure. The threshold is 3 × $0.40 per round
              started this week, with a floor of one round.
            </p>
          </section>

          <section aria-labelledby="week-heading" className="flex flex-col gap-[10px]">
            <h2 id="week-heading" className={sectionLabel}>
              Last week
            </h2>
            {lastWeek ? (
              <>
                <p className="font-mono text-[12px] text-ink-6" data-testid="digest-week">
                  {weekRange(lastWeek.start, lastWeek.end)}
                </p>
                <dl className="grid max-w-[420px] grid-cols-[minmax(0,1fr)_auto]">
                  {(Object.keys(FIGURE_NAMES) as (keyof typeof FIGURE_NAMES)[]).map((figure) => (
                    <div key={figure} className="contents">
                      <dt className={`${row} text-[13px] text-ink-3`}>{FIGURE_NAMES[figure]}</dt>
                      <dd className={`${row} text-right font-mono text-[13px] text-ink-2`} data-testid={`figure-${figure}`}>
                        {formatValue(figure, lastWeek.figures[figure])}
                      </dd>
                    </div>
                  ))}
                </dl>
                {unpricedModelsText(lastWeek.unpricedModelIds) ? (
                  <p className="text-[12px] text-attention-ink">{unpricedModelsText(lastWeek.unpricedModelIds)}</p>
                ) : null}
              </>
            ) : (
              <p className="text-[12px] text-ink-6">No weekly digest has run yet.</p>
            )}
          </section>
        </div>
      </section>
    </main>
  );
}
