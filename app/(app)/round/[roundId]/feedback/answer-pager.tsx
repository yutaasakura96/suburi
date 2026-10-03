"use client";

import { useState } from "react";
import { ROUND_COPY, type RoundLanguage } from "../../copy";
import type { FeedbackAnswerView } from "../../load";
import { CalloutRail, ScoreRow } from "../../parts";

/**
 * 10 §8's per-answer region: one answer at a time, its scores as 05 §5.3 rows, and a pager to the
 * rest. Every row is one dimension; there is no row, cell or line that combines them.
 */
export function AnswerPager({
  answers,
  length,
  language,
}: {
  answers: readonly FeedbackAnswerView[];
  length: number;
  language: RoundLanguage;
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
          <ScoreRow key={score.label} label={score.label} value={score.value} unscored={unscored} />
        ))}
      </div>
      {answer.answeredIn ? (
        <div data-testid="wrong-language">
          <CalloutRail tone="information" live={false}>
            {copy.wrongLanguage(answer.answeredIn)}
          </CalloutRail>
        </div>
      ) : null}
      {answers.length > 1 ? (
        <nav className="flex items-center gap-[14px] pt-[6px] text-[12px] text-ink-label" aria-label="Answers">
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
