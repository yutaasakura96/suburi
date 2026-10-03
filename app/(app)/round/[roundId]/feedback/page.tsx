import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { isUuid } from "@/lib/round/http";
import { getRound } from "@/lib/round/state";
import { ROUND_COPY, ROUND_TYPE_NAMES, type RoundLanguage } from "../../copy";
import { feedbackScreen } from "../../load";
import { CalloutRail } from "../../parts";
import { AnswerPager } from "./answer-pager";
import { FindingsRetry } from "./findings-retry";

export const metadata: Metadata = {
  title: "Round feedback — Suburi",
};

/**
 * Round feedback (10 §8): the screen the product exists for. It reads stored rows and nothing else —
 * `complete` already waited, bounded, and wrote what it could — so it renders at once, and a missing
 * piece is a stated state, never a spinner.
 */
export default async function FeedbackPage({ params }: PageProps<"/round/[roundId]/feedback">) {
  const userId = await requireSession();
  const { roundId } = await params;
  const db = getDb();
  const round = isUuid(roundId) ? await getRound(db, userId, roundId) : null;
  if (!round) notFound();
  if (round.completedAt === null) redirect(`/round/${round.id}`);

  const language = round.language as RoundLanguage;
  const copy = ROUND_COPY[language];
  const screen = await feedbackScreen(db, round);

  return (
    <main className="w-[1280px] px-[44px] py-[40px]">
      <section className="border border-rule-frame bg-surface" aria-label={ROUND_TYPE_NAMES[screen.round.roundType]}>
        <header className="flex items-baseline justify-between border-b border-rule-frame px-[32px] py-[20px]">
          <div className="flex items-baseline gap-[14px]">
            <h1 className="text-[17px] font-semibold">{ROUND_TYPE_NAMES[screen.round.roundType]}</h1>
            <span className="text-[13px] text-ink-4">{copy.meta(screen.round.length)}</span>
          </div>
          <span className="font-mono text-[11px] text-ink-label">{screen.round.date}</span>
        </header>

        <div className="grid grid-cols-3">
          <div className="col-span-2 border-r border-rule-frame px-[32px] pt-[30px] pb-[32px]">
            <AnswerPager answers={screen.answers} length={screen.round.length} language={language} />
          </div>

          <div className="flex flex-col gap-[26px] px-[32px] pt-[30px] pb-[32px]">
            {screen.findings ? (
              <>
                <div className="flex flex-col gap-[12px]" data-testid="to-fix">
                  <h2 className="font-mono text-[12px] tracking-[0.1em] text-ink-label">{copy.toFix(screen.findings.toFix.length)}</h2>
                  <ol className="flex flex-col gap-[12px]">
                    {screen.findings.toFix.map((item, index) => (
                      <li key={index} className="flex gap-[10px] text-[13px] leading-[1.75]">
                        <span className="font-mono text-ink-label">{index + 1}</span>
                        <span>
                          <span className="font-medium">{item.title}</span> <span className="text-ink-3">{item.body}</span>
                        </span>
                      </li>
                    ))}
                  </ol>
                </div>
                <div className="flex flex-col gap-[12px]" data-testid="what-worked">
                  <h2 className="font-mono text-[12px] tracking-[0.1em] text-ink-label">{copy.whatWorked}</h2>
                  <p className="text-[13px] leading-[1.75] text-ink-3">{screen.findings.whatWorked}</p>
                </div>
                {screen.grounding ? (
                  <div className="flex flex-col gap-[12px]" data-testid="grounding">
                    <h2 className="font-mono text-[12px] tracking-[0.1em] text-ink-label">{copy.grounding}</h2>
                    {screen.grounding.unsupported.length === 0 ? (
                      <CalloutRail tone="quiet" live={false}>
                        {copy.nothingUnsupported(screen.grounding.cvLabel)}
                      </CalloutRail>
                    ) : (
                      screen.grounding.unsupported.map((flag, index) => (
                        <div key={index} data-testid="unsupported">
                          <CalloutRail tone="attention" live={false}>
                            {copy.unsupported(flag.position, flag.quote, screen.grounding!.cvLabel)}
                          </CalloutRail>
                        </div>
                      ))
                    )}
                    <div data-testid="untouched">
                      <CalloutRail tone="quiet" live={false}>
                        {screen.grounding.untouched.length === 0
                          ? copy.nothingUnused
                          : [copy.unused, ...screen.grounding.untouched.map(copy.quoted)].join(" ")}
                      </CalloutRail>
                    </div>
                  </div>
                ) : null}
              </>
            ) : screen.findingsUnavailable ? (
              <p className="text-[13px] leading-[1.75] text-ink-3" data-testid="findings-unavailable">
                {copy.findingsUnavailable}
              </p>
            ) : (
              <FindingsRetry roundId={screen.round.id} language={language} />
            )}

            <div className="mt-auto border-t border-rule-section pt-[12px] font-mono text-[10px] leading-[1.9] text-ink-8" data-testid="round-stamp">
              {screen.stamps}
              {screen.feltPressure !== null ? (
                <>
                  <br />
                  <span data-testid="pressure-stamp">{copy.pressureRecorded(screen.feltPressure)}</span>
                </>
              ) : null}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
