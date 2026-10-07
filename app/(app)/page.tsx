import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { requireSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { loadStatus } from "@/lib/monitor/status";
import { dueDefaults, dueList, lastPractised } from "@/lib/progress/due";
import { firstAttemptCounts, firstAttempts } from "@/lib/progress/first-attempts";
import { AppHeader } from "./app-header";
import { HOME_COPY as COPY } from "./home/copy";
import { DueList } from "./home/due-list";
import { ROUND_LANGUAGES } from "./round/copy";
import { sectionLabel } from "./round/parts";
import { statusLine } from "./status/copy";
import { StatusLine } from "./status/status-line";

/**
 * Home (10 §1): what is due, how many first attempts there are against thirty, and the way into a
 * round. It answers "what should I practise?" without deciding — the list is a suggestion, and the
 * button starts anything. Protected here as well as in the proxy (08 §5).
 */
export default async function HomePage() {
  const userId = await requireSession();
  const db = getDb();
  const now = new Date();
  const [status, last, attempts] = await Promise.all([loadStatus(db, userId, now), lastPractised(db, userId), firstAttempts(db, userId)]);
  const line = statusLine(status);
  const rows = dueList(last, now);
  const counts = firstAttemptCounts(attempts);

  return (
    <main className="flex w-[1280px] flex-col gap-[14px] px-[44px] py-[40px]">
      {line ? <StatusLine line={line} /> : null}
      <section className="flex flex-col border border-rule-frame bg-surface" aria-label={COPY.heading}>
        <AppHeader active="home" />
        <h1 className="sr-only">{COPY.heading}</h1>
        <div className="grid grid-cols-3">
          <div className="col-span-2 flex flex-col gap-[18px] border-r border-rule-frame px-[32px] py-[30px]">
            <div className="flex items-baseline justify-between">
              <h2 className={sectionLabel}>{COPY.due}</h2>
              <span className="text-[12px] text-ink-label" data-testid="due-caption">
                {COPY.suggestion}
              </span>
            </div>
            <DueList rows={rows} />
          </div>

          <div className="flex flex-col gap-[24px] px-[32px] py-[30px]">
            <div className="flex flex-col gap-[14px]" data-testid="first-attempts">
              <h2 className={sectionLabel}>{COPY.firstAttempts}</h2>
              {ROUND_LANGUAGES.map((language) => (
                <div key={language} className="flex flex-col gap-[7px]" data-testid="first-attempt-count" data-language={language}>
                  <div className="flex items-baseline justify-between">
                    <span className="text-[13px]">{COPY.language(language)}</span>
                    <span className="font-mono text-[13px] text-ink-4">{COPY.count(counts[language])}</span>
                  </div>
                  {/* The one filled bar in the system (10 §1): attempts against a target, never a score. */}
                  <div className="flex h-[3px] bg-rule-section" aria-hidden>
                    <span className="bg-mark" style={{ width: `${COPY.countShare(counts[language]) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>

            <div className="h-px bg-rule-section" />

            <div className="flex flex-col gap-[12px]">
              <Link href="/round/new" className={buttonVariants()}>
                {COPY.start}
              </Link>
              <p className="text-[12px] leading-[1.6] text-ink-6" data-testid="home-defaults">
                {COPY.defaults(dueDefaults(rows))}
              </p>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
