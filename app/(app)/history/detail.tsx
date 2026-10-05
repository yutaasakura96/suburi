"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { failureText, getJson, postJson, type FailureCode } from "../round/api";
import { FEEDBACK_READING, type RoundLanguage } from "../round/copy";
import { CalloutRail, LOW_END, caption, sectionLabel } from "../round/parts";
import { HISTORY_COPY } from "./copy";
import type { HistoryDetail, HistoryRow, RowScoring } from "./load";

type AnswerRow = Extract<HistoryRow, { kind: "answer" }>;

// 05 §5.5: question, one column per dimension, TIME, play. Six dimensions in English, seven in Japanese.
const COLUMNS: Record<number, string> = {
  6: "grid-cols-[196px_repeat(6,minmax(0,1fr))_58px_34px]",
  7: "grid-cols-[196px_repeat(7,minmax(0,1fr))_58px_34px]",
};
const SPAN: Record<number, string> = { 6: "col-span-6", 7: "col-span-7" };
// Each cell fills its row, so a row's hairline is one line however tall its tallest cell is.
const cell = "flex items-center border-b border-rule-hairline py-[11px]";

/** What a row is called: `Q1` for a bank question, and the follow-up or the retry under it by name. */
function rowLabel(row: HistoryRow) {
  if (row.kind === "question_unanswered") return HISTORY_COPY.question(row.position);
  if (row.kind !== "answer") return HISTORY_COPY.followUp;
  if (row.retry) return HISTORY_COPY.answeredAgain;
  return row.asked === "follow_up" ? HISTORY_COPY.followUp : HISTORY_COPY.question(row.position);
}

/**
 * History's detail (10 §10): the round's header, its matrix, and the stamps its scores carry.
 *
 * **A past round is read-only.** The matrix has no control that edits, deletes or shares anything
 * (07 §6). It holds two pieces of state — which row's recording is open, and, on a Japanese round with
 * a stored translation, the language the dimensions are named in — and one action: retrying the score
 * of an answer that has none, **for that answer alone** (07 §5.11).
 *
 * **Every cell is one dimension of one answer.** No row, column or cell combines them (04 §6).
 */
export function HistoryDetailView({ detail }: { detail: HistoryDetail }) {
  const { round, stamps } = detail;
  const [selectedReading, setReading] = useState<RoundLanguage>(round.language);
  const reading = detail.translated ? selectedReading : round.language;
  const other: RoundLanguage = reading === "ja" ? "en" : "ja";
  const [open, setOpen] = useState<string | null>(null);
  const dimensions = detail.dimensions.length;

  return (
    <>
      <header className="flex items-start justify-between">
        <div className="flex flex-col gap-[7px]">
          <div className="flex items-baseline gap-[14px]">
            <h2 className="text-[17px] font-semibold">{HISTORY_COPY.roundType(round.roundType)}</h2>
            <span className="text-[13px] text-ink-4">{HISTORY_COPY.meta(round.language, round.mode, round.length)}</span>
            <span className="font-mono text-[11px] text-ink-label">{HISTORY_COPY.date(round.startedAt)}</span>
          </div>
          <span className="text-[12px] text-ink-6" data-testid="history-context">
            {[
              HISTORY_COPY.roleContext(detail.roleContext.kind, detail.roleContext.companyName, detail.roleContext.roleTitle),
              detail.feltPressure === null ? null : HISTORY_COPY.pressure(detail.feltPressure),
            ]
              .filter((part) => part !== null)
              .join(" · ")}
          </span>
          {round.status === "abandoned" ? (
            <span className="text-[12px] text-attention-ink" data-testid="history-abandoned">
              {HISTORY_COPY.abandoned}
            </span>
          ) : null}
          {round.status === "in_progress" ? (
            <Link href={`/round/${round.id}`} className="self-start text-[12px] text-link hover:text-link-hover hover:underline">
              {HISTORY_COPY.resume}
            </Link>
          ) : null}
          {round.status === "complete" ? (
            <Link
              href={`/round/${round.id}/feedback`}
              className="self-start text-[12px] text-link hover:text-link-hover hover:underline"
            >
              {HISTORY_COPY.feedbackLink}
            </Link>
          ) : null}
        </div>
        <div className="flex items-center gap-[14px]">
          {detail.translated ? (
            <button
              type="button"
              lang={other}
              onClick={() => setReading(other)}
              className="border border-tick px-[10px] py-[4px] text-[11px] text-ink-4 hover:text-ink-1"
              data-testid="history-language"
            >
              {FEEDBACK_READING[other]}
            </button>
          ) : null}
          <span className="text-[11px] text-ink-8">{HISTORY_COPY.readOnly}</span>
        </div>
      </header>

      <div className={`grid ${COLUMNS[dimensions]}`} role="table" aria-label={HISTORY_COPY.roundType(round.roundType)} data-testid="history-matrix">
        <div className="contents" role="row">
          <span className="border-b border-rule-axis pb-[10px]" role="columnheader" />
          {detail.dimensions.map((dimension) => (
            <span
              key={dimension.key}
              role="columnheader"
              lang={reading}
              className="border-b border-rule-axis pb-[10px] text-center text-[11px] text-ink-label"
              data-testid="history-dimension"
            >
              {dimension.labels[reading]}
            </span>
          ))}
          <span
            role="columnheader"
            className="border-b border-rule-axis pb-[10px] text-right font-mono text-[10px] tracking-[0.08em] text-ink-label uppercase"
          >
            {HISTORY_COPY.time}
          </span>
          <span className="border-b border-rule-axis pb-[10px]" role="columnheader" />
        </div>

        {detail.rows.map((row, index) => {
          const label = rowLabel(row);
          const answer = row.kind === "answer" ? row : null;
          const id = answer?.answerId ?? null;
          // A follow-up, and a retry, sit one ink level back from the answer they belong to (05 §5.5).
          const secondary = !(row.kind === "question_unanswered" || (row.kind === "answer" && row.asked === "question" && !row.retry));
          const prompt = row.kind === "answer" || row.kind === "follow_up_unanswered" ? row.prompt : null;
          return (
            <div key={id ?? `${row.kind}-${row.position}-${index}`} className="contents" role="row" data-testid="history-row" data-kind={row.kind}>
              <span role="cell" className={`${cell} min-w-0 pr-[12px] ${secondary ? "pl-[18px] text-[12px] text-ink-7" : "text-[13px]"}`}>
                <span className="truncate" lang={round.language} title={prompt ?? undefined}>
                  <span lang="en">{label}</span>
                  {prompt ? `\u2002${prompt}` : null}
                </span>
              </span>
              {row.kind === "answer" ? (
                <ScoreCells row={row} dimensions={dimensions} secondary={secondary} />
              ) : (
                <span
                  role="cell"
                  className={`${cell} ${SPAN[dimensions]} text-[11px] ${row.kind === "follow_up_missing" ? "text-attention-ink" : "text-ink-9"}`}
                  data-testid={row.kind === "follow_up_missing" ? "history-follow-up-missing" : undefined}
                >
                  {row.kind === "follow_up_missing" ? HISTORY_COPY.followUpMissing : HISTORY_COPY.notAnswered}
                </span>
              )}
              <span role="cell" className={`${cell} justify-end font-mono text-[12px] text-ink-label`}>
                {HISTORY_COPY.duration(row.kind === "answer" ? row.durationMs : null)}
              </span>
              <span role="cell" className={`${cell} justify-end`}>
                {answer ? (
                  <button
                    type="button"
                    onClick={() => setOpen(open === id ? null : id)}
                    aria-expanded={open === id}
                    aria-label={(open === id ? HISTORY_COPY.close : HISTORY_COPY.open)(HISTORY_COPY.rowName(answer.position, answer.asked, answer.retry))}
                    className={`flex size-[18px] items-center justify-end hover:text-ink-1 ${open === id ? "text-mark" : "text-ink-8"}`}
                    data-testid="history-play"
                  >
                    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" aria-hidden>
                      <path d="M4.6 3.2 10.6 7l-6 3.8V3.2Z" />
                    </svg>
                  </button>
                ) : (
                  // Keeps the row's height where there is nothing to open.
                  <span className="size-[18px]" />
                )}
              </span>
              {answer && open === id ? <RowRecord row={answer} language={round.language} /> : null}
            </div>
          );
        })}
      </div>

      <div className="mt-auto flex items-baseline justify-between gap-[20px] border-t border-rule-section pt-[14px]">
        <div className="flex min-w-0 flex-col gap-[4px] text-[12px] leading-[1.75] text-ink-6">
          {HISTORY_COPY.footer.map((sentence) => (
            <span key={sentence}>{sentence}</span>
          ))}
        </div>
        <span className="shrink-0 text-right font-mono text-[10px] leading-[1.9] whitespace-nowrap text-ink-8" data-testid="history-stamp">
          {[HISTORY_COPY.rubricStamp(stamps.rubricLabel), ...stamps.generatorVersions].join(" · ")}
          <br />
          {[stamps.cvLabel, ...stamps.scoringModels].join(" · ")}
        </span>
      </div>
    </>
  );
}

/** One numeral per dimension, or — across the same columns — why there is none. */
function ScoreCells({ row, dimensions, secondary }: { row: AnswerRow; dimensions: number; secondary: boolean }) {
  const { scoring } = row;
  if (scoring.state === "ok") {
    return scoring.values.map((value, index) => {
      const low = value !== null && value <= LOW_END;
      return (
        <span
          key={index}
          role="cell"
          className={`${cell} justify-center font-mono text-[13px] ${low ? "font-medium text-attention-ink" : secondary ? "text-ink-7" : "text-ink-2"}`}
          data-testid="history-score"
        >
          {value ?? "—"}
        </span>
      );
    });
  }
  return (
    <span role="cell" className={`${cell} ${SPAN[dimensions]} gap-[14px] text-[11px]`} data-testid="history-unscored">
      <Unscored answerId={row.answerId} scoring={scoring} name={HISTORY_COPY.rowName(row.position, row.asked, row.retry)} />
    </span>
  );
}

/**
 * An answer with no score (PRD §6): stated, with a retry **for that answer alone**. A failed score
 * gets a new attempt, then its run; a pending one is run as it is (07 §5.10–§5.11). Neither touches
 * the round's feedback. Stated in words while it runs: no spinner (03 §8).
 */
function Unscored({
  answerId,
  scoring,
  name,
}: {
  answerId: string;
  scoring: Exclude<RowScoring, { state: "ok" }>;
  /** The row, for the control's accessible name: a round can have more than one unscored answer. */
  name: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<FailureCode | null>(null);

  if (scoring.state === "withheld") return <span className="text-ink-9">{HISTORY_COPY.withheld}</span>;
  if (scoring.state === "not_submitted") return <span className="text-ink-9">{HISTORY_COPY.notSubmitted}</span>;

  async function retry() {
    setBusy(true);
    setError(null);
    let attemptId = scoring.state === "pending" ? scoring.attemptId : null;
    if (attemptId === null) {
      const created = await postJson<{ attempt_id: string }>("/api/scoring-attempts", { answer_id: answerId });
      if (!created.ok) {
        setBusy(false);
        setError(created.code);
        router.refresh();
        return;
      }
      attemptId = created.json.attempt_id;
    }
    const run = await postJson(`/api/scoring-attempts/${attemptId}/run`);
    setBusy(false);
    if (!run.ok) setError(run.code);
    // Either way the rows are read again: a new attempt exists, scored or not.
    router.refresh();
  }

  return (
    <>
      <span className="text-attention-ink">{scoring.state === "pending" ? HISTORY_COPY.notScoredYet : HISTORY_COPY.notScored}</span>
      <button
        type="button"
        onClick={() => void retry()}
        disabled={busy}
        aria-label={HISTORY_COPY.retryScoringFor(name)}
        className="text-link hover:text-link-hover hover:underline disabled:text-ink-9"
        data-testid="history-retry"
      >
        {HISTORY_COPY.retryScoring}
      </button>
      {busy ? (
        <span className="text-ink-6" role="status">
          {HISTORY_COPY.scoringNow}
        </span>
      ) : null}
      {error ? (
        <span className="text-attention-ink" role="alert">
          {failureText(error, "en")}
        </span>
      ) : null}
    </>
  );
}

type Playback = { readonly state: "opening" } | { readonly state: "ready"; readonly url: string } | { readonly state: "failed"; readonly text: string };

/**
 * What the play triangle opens (10 §10): the take, and the transcript exactly as it was transcribed,
 * beside what it was corrected to. The playback URL is minted when the row opens (07 §5.14) and never
 * kept; **a missing recording is a sentence, not a broken page** (04 §5).
 */
function RowRecord({ row, language }: { row: AnswerRow; language: RoundLanguage }) {
  const [playback, setPlayback] = useState<Playback>({ state: "opening" });

  // Asked for when the row opens, and again never: the URL is short-lived and is not kept.
  useEffect(() => {
    let current = true;
    void getJson<{ url: string }>(`/api/answers/${row.answerId}/audio`).then((result) => {
      if (!current) return;
      setPlayback(result.ok ? { state: "ready", url: result.json.url } : { state: "failed", text: failureText(result.code, "en") });
    });
    return () => {
      current = false;
    };
  }, [row.answerId]);
  const figures = HISTORY_COPY.figures(language, row.pace, row.rewrite);

  return (
    <div className="col-span-full flex flex-col gap-[14px] border-b border-rule-hairline bg-surface-inert px-[18px] py-[16px]" data-testid="history-record">
      <p className="text-[13px] leading-[1.75] text-ink-2" lang={language}>
        {row.prompt}
      </p>
      <div className="flex items-center gap-[14px]">
        <span className={sectionLabel}>{HISTORY_COPY.recording}</span>
        {playback.state === "opening" ? (
          <span className={caption} role="status">
            {HISTORY_COPY.openingAudio}
          </span>
        ) : playback.state === "ready" ? (
          <audio
            controls
            autoPlay
            src={playback.url}
            onError={() => setPlayback({ state: "failed", text: HISTORY_COPY.audioUnplayable })}
            className="h-[32px]"
            data-testid="history-audio"
          />
        ) : (
          <div data-testid="history-audio-missing">
            <CalloutRail tone="attention">{playback.text}</CalloutRail>
          </div>
        )}
        {figures ? <span className="ml-auto font-mono text-[11px] text-ink-label">{figures}</span> : null}
      </div>
      <div className="grid grid-cols-2 gap-[24px]">
        <div className="flex flex-col gap-[8px]">
          <h3 className={sectionLabel}>{HISTORY_COPY.rawTranscript}</h3>
          <p className="text-[13px] leading-[1.85] whitespace-pre-wrap text-ink-3" lang={language} data-testid="history-raw">
            {row.raw ?? HISTORY_COPY.noTranscript}
          </p>
        </div>
        <div className="flex flex-col gap-[8px]">
          <h3 className={sectionLabel}>{HISTORY_COPY.corrected}</h3>
          <p className="text-[13px] leading-[1.85] whitespace-pre-wrap text-ink-2" lang={language} data-testid="history-corrected">
            {row.corrected ?? HISTORY_COPY.noTranscript}
          </p>
        </div>
      </div>
    </div>
  );
}
