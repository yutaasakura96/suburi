"use client";

import { useEffect, useState } from "react";
import { FEEDBACK_READING, roundCopy, type RoundLanguage } from "../../copy";
import type { FeedbackScreen } from "../../load";
import { CalloutRail, Quoting } from "../../parts";
import { AnswerPager } from "./answer-pager";
import { FindingsRetry } from "./findings-retry";

/**
 * Screen 8's card (10 §8), and the one piece of state it holds: the language it is read in.
 *
 * **A Japanese round's feedback is Japanese, with a pill to read it in English** (PRD §4), in either
 * mode. Pressed, the feedback is read from the translations stored with it — the dimension names, the
 * round-level findings (04 `body_translated`) and each model answer — the question's and follow-up's
 * stored English appears under them, and the screen's chrome is an English round's (10 §0; 06,
 * Q106-3). What stays Japanese: the question and follow-up as asked, what the user said, every quote in
 * the CV region and the justifications (Q106-6). It starts from the user's English help setting and is
 * page state after that, never stored. An English round has no pill.
 */
export function FeedbackView({ screen }: { screen: FeedbackScreen }) {
  const { language } = screen.round;
  const pill = screen.englishHelp !== null;
  const [selectedReading, setReading] = useState<RoundLanguage>(screen.englishHelp ? "en" : language);
  const reading = pill ? selectedReading : language;
  const other: RoundLanguage = reading === "ja" ? "en" : "ja";
  // The chrome follows the reading: a Japanese round read in English has an English round's chrome.
  const copy = roundCopy(language, reading !== language);
  const findings = reading === language ? screen.findings : (screen.translated ?? screen.findings);
  const findingsLanguage = reading !== language && screen.translated ? reading : language;
  const { rubricLabel, generatorVersions, cvLabel } = screen.stamps;
  const { grounding } = screen;
  // A practice round records no rating, so the sentences that stand in for findings mention none (10 §15).
  const rated = screen.round.mode === "realistic";
  // The tab title is chrome too. The page's metadata sets it from where the pill starts; this follows it.
  useEffect(() => {
    document.title = copy.feedbackTitle;
  }, [copy.feedbackTitle]);

  return (
    <section className="border border-rule-frame bg-surface" lang={reading} aria-label={copy.roundTypes[screen.round.roundType]}>
      <header className="flex items-baseline justify-between border-b border-rule-frame px-[32px] py-[20px]">
        <div className="flex items-baseline gap-[14px]">
          <h1 className="text-[17px] font-semibold">{copy.roundTypes[screen.round.roundType]}</h1>
          <span className="text-[13px] text-ink-4">{copy.meta(screen.round.mode, screen.round.length)}</span>
        </div>
        <div className="flex items-baseline gap-[14px]">
          <span className="font-mono text-[11px] text-ink-label">{screen.round.date}</span>
          {pill ? (
            <button
              type="button"
              lang={other}
              aria-pressed={reading !== language}
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
          <AnswerPager
            roundId={screen.round.id}
            answers={screen.answers}
            length={screen.round.length}
            language={language}
            reading={reading}
            cvLabel={cvLabel}
          />
        </div>

        <div className="flex flex-col gap-[26px] px-[32px] pt-[30px] pb-[32px]">
          {findings ? (
            <>
              <div className="flex flex-col gap-[26px]" lang={findingsLanguage} data-testid="findings">
                <div className="flex flex-col gap-[12px]" data-testid="to-fix">
                  <h2 className="font-mono text-[12px] tracking-[0.1em] text-ink-label" lang={reading}>
                    {copy.toFix(findings.toFix.length)}
                  </h2>
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
                  <h2 className="font-mono text-[12px] tracking-[0.1em] text-ink-label" lang={reading}>
                    {copy.whatWorked}
                  </h2>
                  <p className="text-[13px] leading-[1.75] text-ink-3">{findings.whatWorked}</p>
                </div>
              </div>
              {grounding ? (
                <div className="flex flex-col gap-[12px]" data-testid="grounding">
                  <h2 className="font-mono text-[12px] tracking-[0.1em] text-ink-label">{copy.grounding}</h2>
                  {grounding.unsupported.length === 0 ? (
                    <CalloutRail tone="quiet" live={false}>
                      <Quoting sentence={copy.nothingUnsupported} quotes={[grounding.cvLabel]} lang={language} />
                    </CalloutRail>
                  ) : (
                    grounding.unsupported.map((flag, index) => (
                      <div key={index} data-testid="unsupported">
                        <CalloutRail tone="attention" live={false}>
                          {/* Every quote stays as stored, in the round's language, whatever the chrome (Q106-3). */}
                          <Quoting
                            sentence={(quote: string, cv: string) => copy.unsupported(flag.position, quote, cv)}
                            quotes={[flag.quote, grounding.cvLabel]}
                            lang={language}
                          />
                        </CalloutRail>
                      </div>
                    ))
                  )}
                  <div data-testid="untouched">
                    <CalloutRail tone="quiet" live={false}>
                      {grounding.untouched.length === 0 ? (
                        copy.nothingUnused
                      ) : (
                        <Quoting sentence={(...quotes: readonly string[]) => copy.unused(quotes)} quotes={grounding.untouched} lang={language} />
                      )}
                    </CalloutRail>
                  </div>
                </div>
              ) : null}
            </>
          ) : screen.findingsUnavailable ? (
            <p className="text-[13px] leading-[1.75] text-ink-3" data-testid="findings-unavailable">
              {copy.findingsUnavailable(rated)}
            </p>
          ) : (
            <FindingsRetry roundId={screen.round.id} language={reading} rated={rated} />
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
