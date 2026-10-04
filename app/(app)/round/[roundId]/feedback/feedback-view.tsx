"use client";

import { useState } from "react";
import { FEEDBACK_READING, ROUND_COPY, type RoundLanguage } from "../../copy";
import type { FeedbackScreen } from "../../load";
import { CalloutRail } from "../../parts";
import { AnswerPager } from "./answer-pager";
import { FindingsRetry } from "./findings-retry";

/**
 * Screen 8's card (10 §8), and the one piece of state it holds: the language the feedback is read in.
 *
 * **A Japanese round's feedback is Japanese, with a pill to read it in English** (PRD §4). The pill
 * changes the feedback and nothing else: the dimension names, which follow the feedback language, and
 * the round-level findings with their two headings, which are read from the translation stored with
 * them (04 `body_translated`). The round's own chrome — the header, the question, its figures, the
 * pager, the CV check and the stamps — stays in the round's language (10 §0). An English round has no
 * pill.
 */
export function FeedbackView({ screen }: { screen: FeedbackScreen }) {
  const { language } = screen.round;
  const copy = ROUND_COPY[language];
  const [selectedReading, setReading] = useState<RoundLanguage>(language);
  const reading = language === "ja" && screen.translated ? selectedReading : language;
  const other: RoundLanguage = reading === "ja" ? "en" : "ja";
  const read = ROUND_COPY[reading];
  const findings = reading === language ? screen.findings : screen.translated;
  const { rubricLabel, generatorVersions, cvLabel } = screen.stamps;
  const { grounding } = screen;

  return (
    <section className="border border-rule-frame bg-surface" aria-label={copy.roundTypes[screen.round.roundType]}>
      <header className="flex items-baseline justify-between border-b border-rule-frame px-[32px] py-[20px]">
        <div className="flex items-baseline gap-[14px]">
          <h1 className="text-[17px] font-semibold">{copy.roundTypes[screen.round.roundType]}</h1>
          <span className="text-[13px] text-ink-4">{copy.meta(screen.round.mode, screen.round.length)}</span>
        </div>
        <div className="flex items-baseline gap-[14px]">
          <span className="font-mono text-[11px] text-ink-label">{screen.round.date}</span>
          {language === "ja" && screen.translated ? (
            <button
              type="button"
              lang={other}
              onClick={() => setReading(other)}
              className="border border-tick px-[10px] py-[4px] text-[11px] text-ink-4 hover:text-ink-1"
              data-testid="feedback-language"
            >
              {FEEDBACK_READING[other]}
            </button>
          ) : null}
        </div>
      </header>

      <div className="grid grid-cols-3">
        <div className="col-span-2 border-r border-rule-frame px-[32px] pt-[30px] pb-[32px]">
          <AnswerPager answers={screen.answers} length={screen.round.length} language={language} reading={reading} />
        </div>

        <div className="flex flex-col gap-[26px] px-[32px] pt-[30px] pb-[32px]">
          {findings ? (
            <>
              <div className="flex flex-col gap-[26px]" lang={reading} data-testid="findings">
                <div className="flex flex-col gap-[12px]" data-testid="to-fix">
                  <h2 className="font-mono text-[12px] tracking-[0.1em] text-ink-label">{read.toFix(findings.toFix.length)}</h2>
                  <ol className="flex flex-col gap-[12px]">
                    {findings.toFix.map((item, index) => (
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
                  <h2 className="font-mono text-[12px] tracking-[0.1em] text-ink-label">{read.whatWorked}</h2>
                  <p className="text-[13px] leading-[1.75] text-ink-3">{findings.whatWorked}</p>
                </div>
              </div>
              {grounding ? (
                <div className="flex flex-col gap-[12px]" data-testid="grounding">
                  <h2 className="font-mono text-[12px] tracking-[0.1em] text-ink-label">{copy.grounding}</h2>
                  {grounding.unsupported.length === 0 ? (
                    <CalloutRail tone="quiet" live={false}>
                      {copy.nothingUnsupported(grounding.cvLabel)}
                    </CalloutRail>
                  ) : (
                    grounding.unsupported.map((flag, index) => (
                      <div key={index} data-testid="unsupported">
                        <CalloutRail tone="attention" live={false}>
                          {copy.unsupported(flag.position, flag.quote, grounding.cvLabel)}
                        </CalloutRail>
                      </div>
                    ))
                  )}
                  <div data-testid="untouched">
                    <CalloutRail tone="quiet" live={false}>
                      {grounding.untouched.length === 0 ? copy.nothingUnused : copy.unused(grounding.untouched)}
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
            {copy.stamps([copy.rubricStamp(rubricLabel), ...generatorVersions, cvLabel])}
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
  );
}
