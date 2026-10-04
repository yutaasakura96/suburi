"use client";

import { useState } from "react";
import { ROUND_COPY, type RoundLanguage } from "../../copy";
import type { FeedbackAnswerView } from "../../load";
import { CalloutRail, ScoreRow } from "../../parts";

/**
 * 10 §8's per-answer region: one answer at a time, its scores as 05 §5.3 rows, and a pager to the
 * rest. Every row is one dimension; there is no row, cell or line that combines them. A dimension is
 * named in the language the feedback is being read in (PRD §4); the rest is the round's chrome.
 */
export function AnswerPager({
  answers,
  length,
  language,
  reading,
}: {
  answers: readonly FeedbackAnswerView[];
  length: number;
  language: RoundLanguage;
  reading: RoundLanguage;
}) {
  const copy = ROUND_COPY[language];
  const [index, setIndex] = useState(0);
  const answer = answers[index];
  if (!answer) return null;
  const unscored = answer.status === "pending" ? copy.notScoredYet : copy.notScored;

  return (
    <div className="flex flex-col gap-[14px]" data-testid="answer-region" data-position={answer.position}>
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[11px] tracking-[0.16em] text-ink-label">{copy.questionOf(answer.position, length)}</span>
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
              key={other.position}
              type="button"
              onClick={() => setIndex(otherIndex)}
              aria-current={otherIndex === index}
              className={otherIndex === index ? "text-ink-1" : "hover:text-ink-2"}
            >
              {copy.question(other.position)}
            </button>
          ))}
          <span className="h-px flex-1 bg-rule-section" />
        </nav>
      ) : null}
    </div>
  );
}
