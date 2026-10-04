"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { sliceQuote } from "@/lib/cv/spans";
import type { ScoringRead } from "@/lib/round/read-round";
import { ROUND_COPY, type RoundLanguage } from "../copy";
import type { AnsweredView, NextView, RoundFrame } from "../load";
import { CalloutRail, ErrorLine, ScoreRow, caption, roundSectionLabel, type Failure } from "../parts";

/** Where the frame leads. `missing` is a follow-up that could not be generated: said here, never skipped (US-7). */
export type FrameNext = NextView | { readonly kind: "missing" };

// The frame asks the round every two seconds while the score is pending — scoring's median is about
// seven (03 §4) — then every ten, and gives up after the invocation that scores it must have ended
// (07 §5.10). The frame says "being scored" throughout; nothing on it waits.
const POLL_MS = 2_000;
const SLOW_POLL_MS = 10_000;
const SLOW_AFTER_MS = 60_000;
const GIVE_UP_AFTER_MS = 6 * 60_000;

/**
 * The answer's scoring, from the round's read (07 §5.5) while it is pending. A practice round's read
 * carries the scores and flags once the attempt is `ok`; a missed poll is not a failure, the next one
 * asks again.
 */
function useScoring(roundId: string, answerId: string, initial: ScoringRead) {
  const complete = (read: ScoringRead) =>
    read.status === "ok" && (read.scores === undefined || read.flags === undefined)
      ? { ...read, status: "pending" as const }
      : read;
  const [scoring, setScoring] = useState(() => complete(initial));
  const pending = scoring.status === "pending";
  useEffect(() => {
    if (!pending) return;
    const started = Date.now();
    let timer: number | undefined;
    let cancelled = false;
    async function poll() {
      try {
        const response = await fetch(`/api/rounds/${roundId}`, { cache: "no-store" });
        const read = response.ok ? ((await response.json()) as { answers: { id: string; scoring?: ScoringRead }[] }) : null;
        const landed = read?.answers.find((answer) => answer.id === answerId)?.scoring;
        if (cancelled) return;
        if (landed && complete(landed).status !== "pending") return setScoring(landed);
      } catch {
        if (cancelled) return;
      }
      const waited = Date.now() - started;
      if (waited < GIVE_UP_AFTER_MS) timer = window.setTimeout(() => void poll(), waited < SLOW_AFTER_MS ? POLL_MS : SLOW_POLL_MS);
    }
    timer = window.setTimeout(() => void poll(), POLL_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [roundId, answerId, pending]);
  return scoring;
}

/**
 * 10 §15, practice's per-answer frame: the answer just sent with its score rows — stated as pending
 * until they land, never a spinner — its flags once scored, what the round asks next ready beside
 * it, and "answer again". **Every row is one dimension; nothing here combines them**, and nothing
 * compares this answer with another to the same question.
 */
export function AnsweredFrame({
  roundId,
  language,
  dimensions,
  cvLabel,
  step,
  answer,
  next,
  nextStep,
  missingNotice,
  busy,
  error,
  stamp,
  onGoOn,
  onAnswerAgain,
}: {
  roundId: string;
  language: RoundLanguage;
  dimensions: RoundFrame["dimensions"];
  cvLabel: string;
  /** The answer's own step, as the header names it. */
  step: string;
  answer: AnsweredView;
  next: FrameNext;
  /** The step of the question that is next, when one is. */
  nextStep: string | null;
  /** The catalogue's `followup_generation_failed` sentence, in the round's language. */
  missingNotice: string;
  busy: boolean;
  error: Failure | null;
  stamp: string;
  onGoOn: () => void;
  onAnswerAgain: () => void;
}) {
  const copy = ROUND_COPY[language];
  const scoring = useScoring(roundId, answer.answerId, answer.scoring);
  const scored = scoring.status === "ok";
  const sectionLabel = roundSectionLabel(language);
  // Only an answer that went through the CV check says what it found (10 §8's rule).
  const checked = scored && scoring.answered_language != null;
  const answeredIn = checked && scoring.answered_language !== language ? (scoring.answered_language as RoundLanguage) : null;

  const goOn =
    next.kind === "follow_up"
      ? copy.answerFollowUp
      : next.kind === "question"
        ? copy.nextQuestion
        : next.kind === "feedback"
          ? copy.toFeedback
          : copy.goOn;
  const goOnCaption = next.kind === "feedback" ? (busy ? copy.retryingFindings : copy.finishCaption) : busy ? copy.sending : copy.goOnCaption;

  return (
    <div className="grid flex-grow grid-cols-3" data-testid="answered-frame" data-scoring={scoring.status}>
      <div className="col-span-2 flex flex-col gap-[14px] border-r border-rule-frame px-[32px] pt-[30px] pb-[32px]">
        <div className="flex items-baseline justify-between">
          <span className="font-mono text-[11px] tracking-[0.16em] text-ink-label">{step}</span>
          <span className="font-mono text-[12px] text-ink-label" data-testid="answer-figures">
            {copy.answerFigures(answer.durationMs, answer.wpm, answer.rewrite)}
          </span>
        </div>
        <p className="text-[15px] leading-[1.85] text-ink-2" data-testid="answered-question">
          {answer.text}
        </p>
        <div className="flex flex-col">
          {dimensions.map((dimension) => (
            <ScoreRow
              key={dimension.key}
              label={dimension.label}
              value={scored ? (scoring.scores?.find((score) => score.dimension === dimension.key)?.value ?? null) : null}
              unscored={scoring.status === "pending" ? copy.notScoredYet : copy.notScored}
            />
          ))}
        </div>
        {scoring.status === "pending" ? (
          <div data-testid="scoring-pending">
            <CalloutRail tone="information">{copy.scoringPending}</CalloutRail>
          </div>
        ) : null}
        {scoring.status === "failed" ? (
          <div data-testid="scoring-failed">
            <CalloutRail tone="attention">{copy.scoringFailed}</CalloutRail>
          </div>
        ) : null}
        {checked ? (
          <div className="flex flex-col gap-[12px]" data-testid="answer-flags">
            {scoring.flags && scoring.flags.length > 0 ? (
              scoring.flags.map((flag, index) => (
                <div key={index} data-testid="unsupported">
                  <CalloutRail tone="attention" live={false}>
                    {/* The answer's own words by span, never the scorer's (04 `answer_flags`). */}
                    {copy.unsupportedHere(sliceQuote(answer.corrected, { start: flag.span_start, end: flag.span_end }), cvLabel)}
                  </CalloutRail>
                </div>
              ))
            ) : (
              <CalloutRail tone="quiet" live={false}>
                {copy.nothingUnsupported(cvLabel)}
              </CalloutRail>
            )}
            {answeredIn ? (
              <div data-testid="wrong-language">
                <CalloutRail tone="information" live={false}>
                  {copy.wrongLanguage(answeredIn)}
                </CalloutRail>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-[20px] px-[32px] pt-[30px] pb-[32px]">
        <span className={sectionLabel}>{copy.next}</span>
        {next.kind === "follow_up" ? (
          <div className="flex flex-col gap-[6px]" data-testid="next-follow-up">
            <span className="text-[12px] text-ink-6">{copy.followUp}</span>
            <p className="text-[13px] leading-[1.75] text-ink-2">{next.text}</p>
          </div>
        ) : null}
        {nextStep ? <p className="font-mono text-[12px] text-ink-label">{nextStep}</p> : null}
        {next.kind === "missing" || next.kind === "follow_up_due" ? (
          <div data-testid="follow-up-notice">
            <CalloutRail tone={next.kind === "missing" ? "attention" : "information"}>
              {next.kind === "missing" ? missingNotice : copy.followUpNotStored}
            </CalloutRail>
          </div>
        ) : null}
        <div className="flex flex-col gap-[10px]">
          <ErrorLine error={error} retryLabel={copy.tryAgain} />
          <Button onClick={onGoOn} disabled={busy}>
            {goOn}
          </Button>
          <p className={caption} role="status">
            {goOnCaption}
          </p>
        </div>

        <div className="flex flex-col gap-[10px] border-t border-rule-section pt-[20px]">
          <Button variant="outline" onClick={onAnswerAgain} disabled={busy}>
            {copy.answerAgain}
          </Button>
          <p className={caption}>{copy.answerAgainCaption}</p>
        </div>

        <p className="mt-auto border-t border-rule-section pt-[12px] font-mono text-[10px] leading-[1.9] text-ink-8" data-testid="round-stamp">
          {stamp}
        </p>
      </div>
    </div>
  );
}
