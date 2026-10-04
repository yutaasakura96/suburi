"use client";

import { useState } from "react";
import { ROUND_COPY, type RoundLanguage } from "../../copy";
import type { FeedbackAnswerView, ModelAnswerView } from "../../load";
import { CalloutRail, ScoreRow, caption, roundSectionLabel } from "../../parts";
import { ModelAnswersRetry } from "./model-answers-retry";

const answerText = "text-[13px] leading-[1.85] whitespace-pre-wrap";

/**
 * 10 §8, under the pager: what the user said beside the model answer stored for it (04
 * `model_answers`). **An underline is a stored span of the stored model answer** — what the round's CV
 * version does not back — and the caption says so in words, so the mark is never colour alone. A
 * Japanese round's model answer is read in English with the rest of the feedback (PRD §4); what the
 * user said is never translated. An answer with none written says so and offers the retry.
 */
function AnswerTexts({
  roundId,
  language,
  reading,
  cvLabel,
  own,
  modelAnswer,
  labels,
}: {
  roundId: string;
  language: RoundLanguage;
  reading: RoundLanguage;
  cvLabel: string;
  own: string;
  modelAnswer: ModelAnswerView | null;
  labels: { readonly own: string; readonly model: string };
}) {
  const copy = ROUND_COPY[language];
  const translated = reading !== language ? (modelAnswer?.translated ?? null) : null;
  const segments = translated ?? modelAnswer?.segments ?? [];
  return (
    <div className="grid grid-cols-2 gap-[28px]" data-testid="answer-texts">
      <div className="flex flex-col gap-[10px]">
        <h2 className={roundSectionLabel(language)}>{labels.own}</h2>
        <p className={`${answerText} text-ink-3`} data-testid="own-answer">
          {own}
        </p>
      </div>
      <div className="flex flex-col gap-[10px]">
        <h2 className={roundSectionLabel(language)}>{labels.model}</h2>
        {modelAnswer ? (
          <>
            <p className={`${answerText} text-ink-2`} lang={translated ? reading : language} data-testid="model-answer">
              {segments.map((segment, index) =>
                segment.unsupported ? (
                  <span key={index} className="border-b border-attention-mark" data-testid="model-answer-unsupported">
                    {segment.text}
                  </span>
                ) : (
                  segment.text
                ),
              )}
            </p>
            <p className={caption} data-testid="model-answer-legend">
              {segments.some((segment) => segment.unsupported) ? copy.modelAnswerMarked(cvLabel) : copy.modelAnswerUnmarked(cvLabel)}
            </p>
          </>
        ) : (
          <ModelAnswersRetry roundId={roundId} language={language} />
        )}
      </div>
    </div>
  );
}

/**
 * 10 §8's per-answer region: one answer at a time, its scores as 05 §5.3 rows, a pager to the rest,
 * and under it what was said beside its model answer. Every row is one dimension; there is no row,
 * cell or line that combines them. A dimension is named in the language the feedback is being read in
 * (PRD §4); the rest is the round's chrome.
 */
export function AnswerPager({
  roundId,
  answers,
  length,
  language,
  reading,
  cvLabel,
}: {
  roundId: string;
  answers: readonly FeedbackAnswerView[];
  length: number;
  language: RoundLanguage;
  reading: RoundLanguage;
  cvLabel: string;
}) {
  const copy = ROUND_COPY[language];
  const [index, setIndex] = useState(0);
  const answer = answers[index];
  if (!answer) return null;
  const unscored = answer.status === "pending" ? copy.notScoredYet : copy.notScored;

  return (
    <div className="flex flex-col gap-[14px]" data-testid="answer-region" data-position={answer.position} data-again={answer.again}>
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[11px] tracking-[0.16em] text-ink-label">
          {/* 10 §15: an answer given again has its own page, headed as the same question, again. */}
          {answer.again > 0 ? copy.stepAgain(copy.questionOf(answer.position, length)) : copy.questionOf(answer.position, length)}
        </span>
        <span className="font-mono text-[12px] text-ink-label" data-testid="answer-figures">
          {copy.answerFigures(answer.durationMs, answer.wpm, answer.rewrite)}
        </span>
      </div>
      <p className="text-[15px] leading-[1.85] text-ink-2">{answer.prompt}</p>
      <div className="flex flex-col">
        {answer.scores.map((score) => (
          <ScoreRow key={score.key} label={score.labels[reading]} value={score.value} unscored={unscored} />
        ))}
        {/* 10 §8: the follow-up shares the row rhythm and carries no scale; its scores are History's. */}
        {answer.followUp ? (
          <div className="flex items-baseline gap-[18px] border-t border-rule-row py-[11px] last:border-b" data-testid="follow-up-row">
            <span className="w-[120px] shrink-0 text-[12px] text-ink-6">{copy.followUp}</span>
            {answer.followUp.kind === "missing" ? (
              <span className="text-[12px] text-attention-ink" data-testid="follow-up-missing">
                {copy.followUpMissing}
              </span>
            ) : (
              <>
                <span className="flex-1 text-[12px] leading-[1.7] text-ink-7">{answer.followUp.text}</span>
                <span className="shrink-0 text-[11px] text-ink-label">
                  {answer.followUp.status === "ok"
                    ? copy.followUpScored(answer.scores.length)
                    : answer.followUp.status === "pending"
                      ? copy.followUpNotScoredYet
                      : copy.followUpNotScored}
                </span>
              </>
            )}
          </div>
        ) : null}
      </div>
      {answer.answeredIn ? (
        <div data-testid="wrong-language">
          <CalloutRail tone="information" live={false}>
            {copy.wrongLanguage(answer.answeredIn)}
          </CalloutRail>
        </div>
      ) : null}
      {answers.length > 1 ? (
        <nav className="flex items-center gap-[14px] pt-[6px] text-[12px] text-ink-label" aria-label={copy.answers}>
          {answers.map((other, otherIndex) => (
            <button
              key={`${other.position}-${other.again}`}
              type="button"
              onClick={() => setIndex(otherIndex)}
              aria-current={otherIndex === index}
              className={otherIndex === index ? "text-ink-1" : "hover:text-ink-2"}
            >
              {other.again > 0 ? copy.questionAgain(other.position, other.again) : copy.question(other.position)}
            </button>
          ))}
          <span className="h-px flex-1 bg-rule-section" />
        </nav>
      ) : null}
      <div className="flex flex-col gap-[24px] pt-[12px]">
        <AnswerTexts
          roundId={roundId}
          language={language}
          reading={reading}
          cvLabel={cvLabel}
          own={answer.own}
          modelAnswer={answer.modelAnswer}
          labels={{ own: copy.ownAnswer, model: copy.modelAnswer }}
        />
        {answer.followUp?.kind === "asked" && answer.followUp.own !== null ? (
          <div data-testid="follow-up-texts">
            <AnswerTexts
              roundId={roundId}
              language={language}
              reading={reading}
              cvLabel={cvLabel}
              own={answer.followUp.own}
              modelAnswer={answer.followUp.modelAnswer}
              labels={{ own: copy.followUpOwnAnswer, model: copy.followUpModelAnswer }}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
