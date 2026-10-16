"use client";

import Link from "next/link";
import { useState } from "react";
import { FEEDBACK_READING, type RoundLanguage } from "../../round/copy";
import { ModelAnswerText, PromptEnglish, answerText, caption, sectionLabel } from "../../round/parts";
import { STUDY_COPY as COPY } from "./copy";
import type { StudyAnswer, StudyRound } from "./load";

const link = "text-[12px] text-link hover:text-link-hover hover:underline";

/**
 * What was said beside the model answer stored for it, as on screen 8 (10 §8) — and, under what was
 * said, each time a practice round answered it again. **Nothing here writes**: an answer with no
 * model answer says so, and the control that writes one stays on the round's feedback (07 §5.19).
 */
function Texts({
  round,
  reading,
  answer,
  labels,
}: {
  round: StudyRound;
  reading: RoundLanguage;
  answer: StudyAnswer;
  labels: { readonly own: string; readonly model: string };
}) {
  const translated = reading !== round.language ? (answer.modelAnswer?.translated ?? null) : null;
  const segments = translated ?? answer.modelAnswer?.segments ?? [];
  return (
    <div className="grid grid-cols-2 gap-[28px]" data-testid="study-texts">
      <div className="flex flex-col gap-[10px]">
        <h4 className={sectionLabel}>{labels.own}</h4>
        <p className={`${answerText} text-ink-3`} lang={round.language} data-testid="own-answer">
          {answer.own}
        </p>
        {answer.again.map((text, index) => (
          <div key={index} className="flex flex-col gap-[10px] pt-[8px]" data-testid="answered-again">
            <h4 className={sectionLabel}>{COPY.answeredAgain(index + 1)}</h4>
            <p className={`${answerText} text-ink-3`} lang={round.language}>
              {text}
            </p>
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-[10px]">
        <h4 className={sectionLabel}>{labels.model}</h4>
        {answer.modelAnswer ? (
          <>
            <ModelAnswerText segments={segments} lang={translated ? reading : round.language} />
            <p className={caption} data-testid="model-answer-legend">
              {segments.some((segment) => segment.unsupported) ? COPY.modelAnswerMarked(round.cvLabel) : COPY.modelAnswerUnmarked(round.cvLabel)}
            </p>
          </>
        ) : (
          <p className="text-[13px] leading-[1.75] text-ink-3" data-testid="model-answer-not-written">
            {COPY.modelAnswerNotWritten}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * One round of the study view (10 §16): every answered question, unrolled — what was said,
 * the model answer, the follow-up the same way — beside the round's stored `To fix`. Screen 8's card
 * without its scores and without its pager.
 *
 * **Read-only by construction.** Its one piece of state is the language a Japanese round is read in,
 * when something of it was stored in English (PRD §4): its model answers and findings from their
 * translations, and each question's and follow-up's English under it (#106). The pill is its one
 * control and starts from the user's English help setting; the questions as asked, what was said and
 * the chrome never change. No score, no figure and nothing that combines dimensions is read by this
 * screen at all.
 */
export function StudyRoundView({ round, englishHelp }: { round: StudyRound; englishHelp: boolean }) {
  const { language } = round;
  const answered = round.questions.flatMap((question) => (question.followUp ? [question, question.followUp] : [question]));
  const translatable =
    language === "ja" &&
    (round.toFixTranslated !== null ||
      answered.some((answer) => answer.modelAnswer?.translated != null || (answer.promptEn ?? null) !== null));
  const [selectedReading, setReading] = useState<RoundLanguage>(englishHelp ? "en" : language);
  const reading = translatable ? selectedReading : language;
  /** What the pill shows under a prompt: undefined for nothing, null for the line saying there is none. */
  const englishFor = (promptEn: string | null | undefined) => (reading !== language ? (promptEn ?? null) : undefined);
  const other: RoundLanguage = reading === "ja" ? "en" : "ja";
  const toFix = reading === language ? round.toFix : (round.toFixTranslated ?? round.toFix);
  const toFixLanguage = reading !== language && round.toFixTranslated ? reading : language;

  return (
    <section
      className="border border-rule-frame bg-surface"
      aria-label={COPY.roundName(round.roundType, round.startedAt)}
      data-testid="study-round"
      data-round={round.id}
    >
      <header className="flex items-start justify-between border-b border-rule-frame px-[32px] py-[20px]">
        <div className="flex flex-col gap-[7px]">
          <div className="flex items-baseline gap-[14px]">
            <h2 className="text-[17px] font-semibold">{COPY.roundType(round.roundType)}</h2>
            <span className="text-[13px] text-ink-4">{COPY.meta(language, round.mode, round.length)}</span>
            <span className="font-mono text-[11px] text-ink-label">{COPY.date(round.startedAt)}</span>
          </div>
          <div className="flex gap-[18px]">
            {round.complete ? (
              <Link href={`/round/${round.id}/feedback`} className={link}>
                {COPY.feedbackLink}
              </Link>
            ) : null}
            <Link href={`/history/${round.id}`} className={link}>
              {COPY.historyLink}
            </Link>
          </div>
        </div>
        {translatable ? (
          <button
            type="button"
            lang={other}
            aria-pressed={reading !== language}
            onClick={() => setReading(other)}
            className="border border-tick px-[10px] py-[4px] text-[11px] text-ink-4 hover:text-ink-1"
            data-testid="study-language"
          >
            {FEEDBACK_READING[other]}
          </button>
        ) : null}
      </header>

      <div className="grid grid-cols-3">
        <div className="col-span-2 flex flex-col border-r border-rule-frame px-[32px]">
          {round.questions.map((question) => (
            <article
              key={question.position}
              className="flex flex-col gap-[14px] border-t border-rule-section pt-[26px] pb-[30px] first:border-t-0"
              data-testid="study-question"
              data-position={question.position}
            >
              <span className="font-mono text-[11px] tracking-[0.16em] text-ink-label">{COPY.question(question.position, round.length)}</span>
              <div className="flex flex-col gap-[6px]">
                <h3 className="text-[15px] leading-[1.85] text-ink-2" lang={language}>
                  {question.prompt}
                </h3>
                <PromptEnglish english={englishFor(question.promptEn)} className="text-[13px] leading-[1.75] text-ink-5" />
              </div>
              <Texts round={round} reading={reading} answer={question} labels={{ own: COPY.ownAnswer, model: COPY.modelAnswer }} />
              {question.followUp ? (
                <div className="flex flex-col gap-[14px] pt-[10px]" data-testid="study-follow-up">
                  <div className="flex items-baseline gap-[18px] text-[12px] leading-[1.7]">
                    <span className="shrink-0 text-ink-6">{COPY.followUp}</span>
                    <div className="flex flex-col gap-[4px]">
                      <p className="text-[13px] leading-[1.85] text-ink-2" lang={language}>
                        {question.followUp.prompt}
                      </p>
                      <PromptEnglish english={englishFor(question.followUp.promptEn)} className="text-[12px] leading-[1.7] text-ink-8" />
                    </div>
                  </div>
                  <Texts
                    round={round}
                    reading={reading}
                    answer={question.followUp}
                    labels={{ own: COPY.followUpOwnAnswer, model: COPY.followUpModelAnswer }}
                  />
                </div>
              ) : null}
            </article>
          ))}
        </div>

        <div className="px-[32px] pt-[26px] pb-[30px]">
          {/* The findings name their questions by number, so they stay in view beside the questions as the round is read. */}
          <div className="sticky top-[24px] flex flex-col gap-[12px]" data-testid="study-to-fix">
            {toFix ? (
              <>
                <h3 className="font-mono text-[12px] tracking-[0.1em] text-ink-label">{COPY.toFix(toFix.length)}</h3>
                <ol className="flex flex-col gap-[12px]" lang={toFixLanguage}>
                  {toFix.map((item, index) => (
                    <li key={index} className="flex gap-[10px] text-[13px] leading-[1.75]">
                      <span className="font-mono text-ink-label">{index + 1}</span>
                      <span>
                        <span className="font-medium">{item.title}</span> <span className="text-ink-3">{item.body}</span>
                      </span>
                    </li>
                  ))}
                </ol>
              </>
            ) : (
              <p className="text-[13px] leading-[1.75] text-ink-3" data-testid="study-no-findings">
                {COPY.noFindings}
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
