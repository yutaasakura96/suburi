"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useDeferredValue, useState } from "react";
import { Button } from "@/components/ui/button";
import { paceUnits, rewriteMagnitude, rewritePercent } from "@/lib/round/measures";
import { failureText, postJson, type FailureCode } from "../api";
import { ROUND_COPY, clock, type RoundCopy, type RoundLanguage } from "../copy";
import type { RoundFrame } from "../load";
import { CalloutRail, RoundFooter, RoundHeader, caption, roundSectionLabel } from "../parts";
import { WAVEFORM_BARS, useRecorder, type Take } from "./recorder";

interface Transcript {
  readonly answerId: string;
  readonly raw: string;
  readonly durationMs: number | null;
  readonly wpm: number | null;
}

/** What is being asked: a bank question, or the follow-up to its answer, at the same position. */
interface Question {
  readonly position: number;
  readonly text: string;
  /** Set for a follow-up: its prompt version, which its answer carries where a question's carries the generator's. */
  readonly followUpVersion: string | null;
}

type Screen =
  | { readonly kind: "asked"; readonly question: Question }
  | { readonly kind: "uploading"; readonly question: Question; readonly take: Take }
  | { readonly kind: "transcript"; readonly question: Question; readonly transcript: Transcript }
  | { readonly kind: "correct"; readonly question: Question; readonly transcript: Transcript }
  /**
   * The answer is submitted and the round has not moved on: its follow-up could not be generated
   * (`missing`), or the page loaded before it was stored (`reloaded`). The same text sent again is
   * what moves it on (07 §5.9); it can no longer be edited.
   */
  | {
      readonly kind: "saved";
      readonly question: Question;
      readonly answerId: string;
      readonly corrected: string;
      readonly reason: "missing" | "reloaded";
    }
  | { readonly kind: "pressure" }
  | { readonly kind: "abandoned"; readonly answered: number };

function initialScreen(start: RoundFrame["start"]): Screen {
  if (start.kind === "follow_up_due") {
    const question = { position: start.position, text: start.text, followUpVersion: null };
    return { kind: "saved", question, answerId: start.answerId, corrected: start.corrected, reason: "reloaded" };
  }
  if (start.kind !== "question") return start;
  const question = { position: start.position, text: start.text, followUpVersion: start.followUpVersion };
  return start.transcript ? { kind: "transcript", question, transcript: start.transcript } : { kind: "asked", question };
}

interface OpenedAnswer {
  answer_id: string;
  upload: { method: "PUT"; url: string; headers: Record<string, string> };
}

interface Transcribed {
  answer_id: string;
  transcript_raw: string;
  audio_duration_ms: number | null;
  words_per_minute: number | null;
}

interface Submitted {
  next:
    | { kind: "question"; position: number; text: string }
    | { kind: "follow_up"; position: number; text: string; prompt_version: string }
    | { kind: "pressure" }
    | { kind: "feedback" };
}

interface Failure {
  readonly text: string;
  readonly retry: (() => void) | null;
}

/**
 * A running round (10 §3–§7). Every step is a server call that leaves the database in a state a
 * reload resumes from, so nothing here is the record of where the round is.
 */
export function RoundRunner({ frame }: { frame: RoundFrame }) {
  const { language } = frame.round;
  const copy = ROUND_COPY[language];
  const router = useRouter();
  const [screen, setScreen] = useState<Screen>(() => initialScreen(frame.start));
  const [error, setError] = useState<Failure | null>(null);
  const [busy, setBusy] = useState(false);
  const [followUpVersions, setFollowUpVersions] = useState(frame.followUpVersions);
  const { round } = frame;

  const position =
    "question" in screen
      ? screen.question.position
      : screen.kind === "abandoned"
        ? Math.min(screen.answered + 1, round.length)
        : round.length;
  const done = screen.kind === "pressure" ? round.length : screen.kind === "abandoned" ? screen.answered : position - 1;
  const header = (
    <RoundHeader
      title={copy.roundTypes[round.roundType]}
      meta={copy.meta(round.length)}
      done={done}
      length={round.length}
      step={
        "question" in screen && screen.question.followUpVersion !== null
          ? copy.followUpStep(position, round.length)
          : copy.step(position, round.length)
      }
    />
  );
  // 10 §3: the prompt's generator version and the CV version; the rubric joins them where scores are.
  // A follow-up's is the follow-up prompt's version (04 `scoring_attempts`).
  const stamp = (question: Question) =>
    copy.stamps([question.followUpVersion ?? frame.generatorVersions[question.position - 1], frame.cvLabel]);
  const roundStamp = copy.stamps([
    copy.rubricStamp(frame.rubricLabel),
    ...new Set([...frame.generatorVersions, ...followUpVersions]),
    frame.cvLabel,
  ]);

  function fail(code: FailureCode, retry: (() => void) | null) {
    setError({ text: failureText(code, language), retry: code === "round_abandoned" ? null : retry });
    setBusy(false);
  }

  /** Open the slot after the take exists (07 §5.6), PUT it to S3, transcribe it. */
  async function deliver(question: Question, take: Take) {
    setScreen({ kind: "uploading", question, take });
    setError(null);
    setBusy(true);
    const retry = () => void deliver(question, take);
    const opened = await postJson<OpenedAnswer>(`/api/rounds/${round.id}/answers`, {
      content_type: take.contentType,
      expected_bytes: take.blob.size,
    });
    if (!opened.ok) return fail(opened.code, retry);
    try {
      const put = await fetch(opened.json.upload.url, {
        method: opened.json.upload.method,
        headers: opened.json.upload.headers,
        body: take.blob,
      });
      if (!put.ok) throw new Error(`upload ${put.status}`);
    } catch {
      setError({ text: copy.uploadFailed, retry });
      setBusy(false);
      return;
    }
    await transcribe(question, take, opened.json.answer_id);
  }

  /** Transcribe the uploaded take (07 §5.7). Idempotent, so it is retried on its own. */
  async function transcribe(question: Question, take: Take, answerId: string) {
    setScreen({ kind: "uploading", question, take });
    setError(null);
    setBusy(true);
    const transcribed = await postJson<Transcribed>(`/api/answers/${answerId}/transcribe`);
    if (!transcribed.ok) return fail(transcribed.code, () => void transcribe(question, take, answerId));
    setBusy(false);
    setScreen({
      kind: "transcript",
      question,
      transcript: {
        answerId: transcribed.json.answer_id,
        raw: transcribed.json.transcript_raw,
        durationMs: transcribed.json.audio_duration_ms,
        wpm: transcribed.json.words_per_minute,
      },
    });
  }

  /** Submit (07 §5.9). The same text sent again is a retry: it returns what the first call made. */
  async function submit(question: Question, answerId: string, corrected: string) {
    setError(null);
    setBusy(true);
    const submitted = await postJson<Submitted>(`/api/answers/${answerId}/submit`, { transcript_corrected: corrected });
    if (!submitted.ok) {
      if (submitted.code !== "followup_generation_failed") return fail(submitted.code, () => void submit(question, answerId, corrected));
      // Not fatal: the answer is saved and the hole is recorded. The round goes on without the follow-up.
      setBusy(false);
      setScreen({ kind: "saved", question, answerId, corrected, reason: "missing" });
      return;
    }
    setBusy(false);
    const next = submitted.json.next;
    if (next.kind === "question") {
      setScreen({ kind: "asked", question: { position: next.position, text: next.text, followUpVersion: null } });
    } else if (next.kind === "follow_up") {
      setFollowUpVersions((versions) => (versions.includes(next.prompt_version) ? versions : [...versions, next.prompt_version]));
      setScreen({ kind: "asked", question: { position: next.position, text: next.text, followUpVersion: next.prompt_version } });
    } else {
      setScreen({ kind: "pressure" });
    }
  }

  async function complete(value: number) {
    setError(null);
    setBusy(true);
    const result = await postJson(`/api/rounds/${round.id}/complete`, { felt_pressure: value });
    // The round is complete in all three: feedback written, feedback not ready, or completed already.
    const completed =
      result.ok || result.code === "feedback_generation_failed" || result.code === "round_already_complete";
    if (!completed) return fail(result.code, () => void complete(value));
    router.push(`/round/${round.id}/feedback`);
  }

  let body: React.ReactNode;
  switch (screen.kind) {
    case "abandoned":
      body = (
        <div className="flex flex-col gap-[14px] px-[32px] py-[36px]">
          <p className="text-[15px] text-ink-3">{copy.abandoned}</p>
          <Link href="/" className="text-[13px] text-link hover:text-link-hover hover:underline">
            {copy.home}
          </Link>
        </div>
      );
      break;
    case "asked":
    case "uploading":
      body = (
        <RecordFrame
          copy={copy}
          capSeconds={round.capSeconds}
          question={screen.question}
          uploading={screen.kind === "uploading"}
          onTake={(take) => void deliver(screen.question, take)}
          error={error}
          stamp={stamp(screen.question)}
        />
      );
      break;
    case "transcript":
      body = (
        <TranscriptFrame
          copy={copy}
          language={language}
          question={screen.question}
          transcript={screen.transcript}
          onCorrect={() => setScreen({ kind: "correct", question: screen.question, transcript: screen.transcript })}
        />
      );
      break;
    case "correct":
      body = (
        <CorrectionFrame
          copy={copy}
          language={language}
          question={screen.question}
          transcript={screen.transcript}
          busy={busy}
          error={error}
          stamp={stamp(screen.question)}
          onSubmit={(corrected) => void submit(screen.question, screen.transcript.answerId, corrected)}
        />
      );
      break;
    case "saved":
      body = (
        <SavedFrame
          copy={copy}
          question={screen.question}
          missing={screen.reason === "missing"}
          notice={screen.reason === "missing" ? failureText("followup_generation_failed", frame.round.language) : copy.followUpNotStored}
          busy={busy}
          error={error}
          onGoOn={() => void submit(screen.question, screen.answerId, screen.corrected)}
        />
      );
      break;
    case "pressure":
      body = (
        <PressureFrame copy={copy} language={language} busy={busy} error={error} stamp={roundStamp} onPick={(value) => void complete(value)} />
      );
      break;
  }

  return (
    <section className="flex min-h-[680px] flex-col border border-rule-frame bg-surface" aria-label={copy.roundTypes[round.roundType]}>
      {header}
      {body}
    </section>
  );
}

function ErrorLine({ error, retryLabel }: { error: Failure | null; retryLabel: string }) {
  if (!error) return null;
  return (
    <div className="flex flex-col gap-[10px]">
      <CalloutRail tone="attention">{error.text}</CalloutRail>
      {error.retry ? (
        <button type="button" onClick={error.retry} className="self-start text-[13px] text-link hover:text-link-hover hover:underline">
          {retryLabel}
        </button>
      ) : null}
    </div>
  );
}

/** 10 §3 and §4: the question at 19px, which does not move when recording starts. */
function RecordFrame({
  copy,
  capSeconds,
  question,
  uploading,
  onTake,
  error,
  stamp,
}: {
  copy: RoundCopy;
  capSeconds: number;
  question: Question;
  uploading: boolean;
  onTake: (take: Take) => void;
  error: Failure | null;
  stamp: string;
}) {
  const recorder = useRecorder(capSeconds, onTake);
  const recording = recorder.state.kind === "recording" ? recorder.state : null;
  const failed = recorder.state.kind === "failed" ? recorder.state.reason : null;

  return (
    <div className="flex flex-grow flex-col gap-[26px] px-[32px] pt-[36px] pb-[32px]">
      {/* The status replaces the speaker line (10 §4); until speech arrives (#45) the line is empty but
          keeps its height, so the question does not move when recording starts. */}
      <div className="flex h-[18px] items-center gap-[9px]" role="status">
        {recording ? (
          <>
            <span className="size-[9px] rounded-full bg-attention-mark" aria-hidden />
            <span className="text-[12px] text-attention-ink">{copy.recording}</span>
          </>
        ) : null}
      </div>

      <p className="max-w-[880px] text-[19px] leading-[1.9] text-ink-2" data-testid="round-question">
        {question.text}
      </p>
      <div className="h-px bg-rule-row" />

      {recording ? (
        <>
          <p className="flex items-baseline gap-[10px]">
            <span className="font-mono text-[30px] font-medium tracking-[0.02em]" data-testid="record-timer">
              {clock(recording.elapsedMs)}
            </span>
            <span className="font-mono text-[13px] text-ink-label">/ {clock(capSeconds * 1000)}</span>
          </p>
          <div className="flex h-[34px] w-[880px] items-center" aria-hidden data-testid="waveform">
            <span className="flex items-center gap-[3px]">
              {recording.bars.map((height, index) => (
                <span key={index} className="w-[2px] bg-mark-mid" style={{ height }} />
              ))}
            </span>
            {recording.bars.length < WAVEFORM_BARS ? <span className="ml-[4px] h-px flex-1 bg-rule-axis" /> : null}
          </div>
          <div className="flex items-center gap-[22px]">
            <Button variant="outline" onClick={recorder.stop} className="gap-[12px]">
              <span className="size-[10px] bg-ink-1" aria-hidden />
              {copy.stop}
            </Button>
            <span className={caption}>{copy.autoStop(capSeconds)}</span>
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center gap-[22px]">
            <Button variant="outline" onClick={() => void recorder.start()} disabled={uploading} className="gap-[12px]">
              <span className="size-[11px] rounded-full bg-attention-mark" aria-hidden />
              {copy.startRecording}
            </Button>
            <span className="font-mono text-[12px] text-ink-label">{copy.cap(capSeconds)}</span>
          </div>
          {uploading && !error ? (
            <p className={caption} role="status">
              {copy.transcribing}
            </p>
          ) : (
            <div className="flex flex-col gap-[9px] text-[12px] leading-[1.75] text-ink-6">
              <span>{copy.oneTake}</span>
              <span>{copy.correctAfter}</span>
            </div>
          )}
          {failed ? <CalloutRail tone="attention">{failed === "unavailable" ? copy.micUnavailable : copy.recordingFailed}</CalloutRail> : null}
          <ErrorLine error={error} retryLabel={copy.tryAgain} />
        </>
      )}

      <div className="flex-grow" />
      <RoundFooter sentence={copy.withheld} stamp={stamp} />
    </div>
  );
}

/** 10 §5: the question demoted to context, the raw transcript with its errors intact. */
function TranscriptFrame({
  copy,
  language,
  question,
  transcript,
  onCorrect,
}: {
  copy: RoundCopy;
  language: RoundLanguage;
  question: Question;
  transcript: Transcript;
  onCorrect: () => void;
}) {
  return (
    <div className="flex flex-grow flex-col gap-[22px] px-[32px] pt-[36px] pb-[32px]">
      <p className="max-w-[880px] text-[14px] leading-[1.85] text-ink-5">{question.text}</p>
      <div className="flex items-baseline justify-between">
        <span className={roundSectionLabel(language)}>{copy.rawTranscript}</span>
        <span className="font-mono text-[12px] text-ink-label" data-testid="take-figures">
          {transcript.durationMs !== null && transcript.wpm !== null
            ? copy.takeFigures(transcript.durationMs, transcript.wpm, paceUnits(language, transcript.raw))
            : null}
        </span>
      </div>
      <p
        className="max-h-[232px] overflow-hidden border-l-2 border-rule-axis pl-[18px] text-[15px] leading-[1.95] whitespace-pre-wrap text-ink-2"
        data-testid="raw-transcript"
      >
        {transcript.raw}
      </p>
      <div className="flex flex-col gap-[10px]">
        <Button onClick={onCorrect} className="self-start">
          {copy.correct}
        </Button>
        <p className={caption}>{copy.correctCaption}</p>
      </div>
      <div className="flex-grow" />
      <div className="border-t border-rule-section pt-[14px] text-[12px] text-ink-6">{copy.goesOn}</div>
    </div>
  );
}

/** 10 §6: the editor, the raw text always beside it, and the rewrite meter — a tick, not a bar. */
function CorrectionFrame({
  copy,
  language,
  question,
  transcript,
  busy,
  error,
  stamp,
  onSubmit,
}: {
  copy: RoundCopy;
  language: RoundLanguage;
  question: Question;
  transcript: Transcript;
  busy: boolean;
  error: Failure | null;
  stamp: string;
  onSubmit: (corrected: string) => void;
}) {
  // A bank question's answer gets one follow-up, made from this text; a follow-up's own answer gets none.
  const followUpNext = question.followUpVersion === null;
  const [text, setText] = useState(transcript.raw);
  // The meter trails typing rather than blocking it; the server stores the same measure (07 §5.9).
  const deferred = useDeferredValue(text);
  const percent = rewritePercent(rewriteMagnitude(transcript.raw, deferred));
  const empty = text.trim() === "";
  const sectionLabel = roundSectionLabel(language);

  return (
    <div className="grid flex-grow grid-cols-3">
      <div className="col-span-2 flex flex-col gap-[18px] border-r border-rule-frame px-[32px] pt-[30px] pb-[32px]">
        <p className="text-[14px] leading-[1.85] text-ink-5">{question.text}</p>
        <div className="h-px bg-rule-row" />
        <div className="flex items-baseline justify-between">
          <label htmlFor="answer-text" className={sectionLabel}>
            {copy.yourAnswer}
          </label>
          <span className="font-mono text-[12px] text-ink-label" data-testid="word-change">
            {copy.unitsChange(paceUnits(language, transcript.raw), paceUnits(language, text))}
          </span>
        </div>
        <textarea
          id="answer-text"
          value={text}
          onChange={(event) => setText(event.target.value)}
          className="h-[300px] resize-none border border-rule-frame px-[18px] py-[16px] font-sans text-[15px] leading-[1.95] text-ink-1 outline-none"
        />
        <div className="flex flex-col gap-[10px]">
          <span className={sectionLabel}>{copy.rawKept}</span>
          <p className="border-l-2 border-rule-section pl-[18px] text-[13px] leading-[1.9] whitespace-pre-wrap text-ink-label" data-testid="raw-kept">
            {transcript.raw}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-[20px] px-[32px] pt-[30px] pb-[32px]">
        <span className={sectionLabel}>{copy.rewrite}</span>
        <p className="flex items-baseline gap-[12px]">
          <span className="font-mono text-[34px] font-medium" data-testid="rewrite-percent">
            {percent}%
          </span>
          <span className="text-[12px] leading-[1.6] text-ink-6">{copy.rewriteOf}</span>
        </p>
        <div className="flex flex-col gap-[4px]" aria-hidden>
          <div className="relative h-[14px]">
            <span className="absolute inset-x-0 top-[6px] h-px bg-rule-axis" />
            <span className="absolute top-0 h-[14px] w-px -translate-x-[0.5px] bg-mark" style={{ left: `${percent}%` }} />
          </div>
          <div className="flex justify-between font-mono text-[10px] text-ink-8">
            <span>0%</span>
            <span>100%</span>
          </div>
        </div>
        <div className="flex flex-col gap-[6px] text-[12px] leading-[1.8] text-ink-4">
          {copy.rewriteNotes.map((line) => (
            <span key={line}>{line}</span>
          ))}
        </div>

        <div className="mt-auto flex flex-col gap-[10px]">
          <ErrorLine error={error} retryLabel={copy.tryAgain} />
          <Button onClick={() => onSubmit(text)} disabled={busy || empty}>
            {copy.send}
          </Button>
          <p className={caption}>
            {busy
              ? followUpNext
                ? copy.sendingForFollowUp
                : copy.sending
              : empty
                ? copy.emptyAnswer
                : followUpNext
                  ? copy.sendCaptionFollowUp
                  : copy.sendCaption}
          </p>
          <p className="font-mono text-[10px] leading-[1.9] text-ink-8">
            {transcript.durationMs !== null && transcript.wpm !== null ? copy.takeSummary(transcript.durationMs, transcript.wpm) : null}
            <br />
            {stamp}
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * 10 §6, after the commit: the answer is saved and can no longer be edited, and the round has not
 * moved on — its follow-up could not be generated, or was not stored before the page loaded. One
 * control goes on; a missing follow-up is said, never skipped silently (PRD US-7).
 */
function SavedFrame({
  copy,
  question,
  missing,
  notice,
  busy,
  error,
  onGoOn,
}: {
  copy: RoundCopy;
  question: Question;
  /** The hole takes the attention colour; a follow-up merely not stored yet does not. */
  missing: boolean;
  notice: string;
  busy: boolean;
  error: Failure | null;
  onGoOn: () => void;
}) {
  return (
    <div className="flex flex-grow flex-col gap-[22px] px-[32px] pt-[36px] pb-[32px]">
      <p className="max-w-[880px] text-[14px] leading-[1.85] text-ink-5">{question.text}</p>
      <div className="h-px bg-rule-row" />
      <div data-testid="follow-up-notice">
        <CalloutRail tone={missing ? "attention" : "information"}>{notice}</CalloutRail>
      </div>
      <div className="flex flex-col gap-[10px]">
        <ErrorLine error={error} retryLabel={copy.tryAgain} />
        <Button onClick={onGoOn} disabled={busy} className="self-start">
          {copy.goOn}
        </Button>
        <p className={caption} role="status">
          {busy ? copy.sending : copy.goOnCaption}
        </p>
      </div>
      <div className="flex-grow" />
      <div className="border-t border-rule-section pt-[14px] text-[12px] text-ink-6">{copy.withheld}</div>
    </div>
  );
}

/**
 * 10 §7: once per round, before the feedback, and **not skippable** — the only way on is a rating,
 * and the button is inert until one is picked.
 */
function PressureFrame({
  copy,
  language,
  busy,
  error,
  stamp,
  onPick,
}: {
  copy: RoundCopy;
  language: RoundLanguage;
  busy: boolean;
  error: Failure | null;
  stamp: string;
  onPick: (value: number) => void;
}) {
  const [picked, setPicked] = useState<number | null>(null);
  const sectionLabel = roundSectionLabel(language);
  return (
    <div className="grid flex-grow grid-cols-3">
      <div className="col-span-2 flex flex-col gap-[14px] border-r border-rule-frame px-[32px] pt-[30px] pb-[32px]">
        <span className={sectionLabel}>{copy.beforeFeedback}</span>
        <h2 className="text-[22px] leading-[1.65] font-medium">{copy.pressureQuestion}</h2>
        <p className="text-[13px] leading-[1.8] text-ink-5">{copy.pressureAsk}</p>
        <div className="mt-[8px] flex flex-col" role="radiogroup" aria-label={copy.pressureQuestion}>
          {copy.pressureOptions.map((option) => {
            const selected = picked === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setPicked(option.value)}
                className="flex items-center gap-[18px] border-t border-rule-row py-[15px] text-left last:border-b"
              >
                <span aria-hidden className={`h-[22px] w-[2px] ${selected ? "bg-mark" : "bg-rule-row"}`} />
                <span className="w-[10px] font-mono text-[11px] text-ink-label">{option.value}</span>
                <span className={`text-[15px] leading-[1.6] ${selected ? "font-medium text-ink-1" : "text-ink-3"}`}>{option.label}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex flex-col gap-[14px] px-[32px] pt-[30px] pb-[32px]">
        <span className={sectionLabel}>{copy.whatThisIsNot}</span>
        <div className="flex flex-col gap-[8px] text-[12px] leading-[1.85] text-ink-4">
          {copy.pressureNotes.map((line) => (
            <span key={line}>{line}</span>
          ))}
        </div>
        <div className="mt-auto flex flex-col gap-[10px]">
          <ErrorLine error={error} retryLabel={copy.tryAgain} />
          <Button
            onClick={() => picked !== null && onPick(picked)}
            disabled={picked === null || busy}
            className={picked === null ? "border-rule-section bg-surface-inert text-ink-8 opacity-100" : ""}
          >
            {copy.toFeedback}
          </Button>
          <p className={caption} role="status">
            {busy ? copy.completing : picked === null ? copy.pickOne : copy.willRecord(picked)}
          </p>
          <p className="border-t border-rule-section pt-[12px] font-mono text-[10px] leading-[1.9] text-ink-8" data-testid="round-stamp">
            {stamp}
          </p>
        </div>
      </div>
    </div>
  );
}
