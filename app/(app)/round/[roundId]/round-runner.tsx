"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useDeferredValue, useEffect, useEffectEvent, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { paceUnits, rewriteMagnitude, rewritePercent } from "@/lib/round/measures";
import type { ScoringRead } from "@/lib/round/read-round";
import { failureText, postJson, type FailureCode } from "../api";
import { ROUND_COPY, clock, type RoundCopy, type RoundLanguage, type RoundMode } from "../copy";
import type { RoundFrame } from "../load";
import { CalloutRail, RoundFooter, RoundHeader, caption, roundSectionLabel } from "../parts";
import { heldTake, holdTake, releaseTake } from "./held-take";
import { WAVEFORM_BARS, useRecorder, type Take } from "./recorder";
import { StuckTakeFrame } from "./stuck-take";

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
  /** Practice's "answer again" (10 §15): the answer this prompt is being answered again beside. */
  readonly again: string | null;
}

/** Practice's per-answer frame (10 §15): the answer sent last, and where the round goes from it. */
interface Answered {
  readonly kind: "answered";
  readonly answer: AnsweredView;
  readonly next: FrameNext;
}

type Screen =
  | { readonly kind: "asked"; readonly question: Question }
  /** The take is on its way: `uploaded` once it is in S3 and only the transcript is awaited. */
  | { readonly kind: "uploading"; readonly question: Question; readonly uploaded: boolean }
  /**
   * The take has not reached S3 (03 §5). It is held in IndexedDB — `onDevice` — or, where that could
   * not be written, only in this tab. `cause` is the refusal that stopped it, or null for the upload itself.
   */
  | { readonly kind: "held"; readonly question: Question; readonly take: Take; readonly onDevice: boolean; readonly cause: FailureCode | null }
  /** The take is uploaded and could not be transcribed: it is kept, and the answer is retried or typed (07 §5.7–§5.8). */
  | { readonly kind: "untranscribed"; readonly question: Question; readonly answerId: string }
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
  | Answered
  | { readonly kind: "pressure" }
  | { readonly kind: "abandoned"; readonly answered: number; readonly byDay: boolean };

function initialScreen(start: RoundFrame["start"]): Screen {
  if (start.kind === "follow_up_due") {
    const question = { position: start.position, text: start.text, followUpVersion: null, again: null };
    return { kind: "saved", question, answerId: start.answerId, corrected: start.corrected, reason: "reloaded" };
  }
  if (start.kind !== "question") return start;
  const question = { position: start.position, text: start.text, followUpVersion: start.followUpVersion };
  if (start.transcript) return { kind: "transcript", question, transcript: start.transcript };
  // A slot left open resumes at `transcribe` (07 §5.5), unless its take turns out to be held here.
  return start.openAnswerId ? { kind: "uploading", question, uploaded: true } : { kind: "asked", question };
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

interface Typed {
  transcript_raw: string;
}

interface Submitted {
  rewrite_magnitude: number | null;
  scoring: ScoringRead;
  next:
    | { kind: "question"; position: number; text: string }
    | { kind: "follow_up"; position: number; text: string; prompt_version: string }
    | { kind: "pressure" }
    | { kind: "feedback" };
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

  const practice = round.mode === "practice";

  // What the header names: the prompt on screen, or on the per-answer frame the answer it shows.
  const prompt =
    "question" in screen
      ? { position: screen.question.position, followUp: screen.question.followUpVersion !== null, again: screen.question.again !== null }
      : screen.kind === "answered"
        ? { position: screen.answer.position, followUp: screen.answer.followUpVersion !== null, again: screen.answer.again }
        : null;
  const position = prompt
    ? prompt.position
    : screen.kind === "abandoned"
      ? Math.min(screen.answered + 1, round.length)
      : round.length;
  // The stepper counts positions the round is past. The per-answer frame reads that from where the
  // round goes next, since an answer given again leaves the round wherever it already was.
  const done =
    screen.kind === "pressure"
      ? round.length
      : screen.kind === "abandoned"
        ? screen.answered
        : screen.kind !== "answered"
          ? position - 1
          : screen.next.kind === "feedback"
            ? round.length
            : screen.next.kind === "question"
              ? screen.next.position - 1
              : screen.next.kind === "follow_up"
                ? screen.next.position - 1
                : position - 1;
  const step = prompt?.followUp ? copy.followUpStep(position, round.length) : copy.step(position, round.length);
  const header = (
    <RoundHeader
      title={copy.roundTypes[round.roundType]}
      meta={copy.meta(round.mode, round.length)}
      done={done}
      length={round.length}
      step={prompt?.again ? copy.stepAgain(step) : step}
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

  const slotOf = (question: Question) => ({ roundId: round.id, position: question.position, followUp: question.followUpVersion !== null });

  /**
   * Open the slot after the take exists (07 §5.6), PUT it to S3, transcribe it. **The take is held in
   * IndexedDB before anything is sent** (03 §5), and released once it is in S3: whatever stops it on
   * the way, a reload finds it. `onDevice` is passed by a retry, which need not hold it again.
   */
  async function deliver(question: Question, take: Take, onDevice?: boolean) {
    setScreen({ kind: "uploading", question, uploaded: false });
    setError(null);
    setBusy(true);
    const held = onDevice ?? (await holdTake(slotOf(question), take));
    const hold = (cause: FailureCode | null) => {
      setBusy(false);
      setScreen({ kind: "held", question, take, onDevice: held, cause });
    };
    const opened = await postJson<OpenedAnswer>(`/api/rounds/${round.id}/answers`, {
      content_type: take.contentType,
      expected_bytes: take.blob.size,
      ...(question.again ? { retry_of_answer_id: question.again } : {}),
    });
    if (!opened.ok) return hold(opened.code);
    try {
      const put = await fetch(opened.json.upload.url, {
        method: opened.json.upload.method,
        headers: opened.json.upload.headers,
        body: take.blob,
      });
      if (!put.ok) throw new Error(`upload ${put.status}`);
    } catch {
      return hold(null);
    }
    await releaseTake(round.id);
    await transcribe(question, opened.json.answer_id);
  }

  /** Transcribe the uploaded take (07 §5.7). Idempotent, so it is retried on its own. */
  async function transcribe(question: Question, answerId: string) {
    setScreen({ kind: "uploading", question, uploaded: true });
    setError(null);
    setBusy(true);
    const transcribed = await postJson<Transcribed>(`/api/answers/${answerId}/transcribe`);
    if (!transcribed.ok) {
      if (transcribed.code === "transcription_failed") {
        // The take is kept (07 §5.7): the answer is retried, or typed.
        setBusy(false);
        setScreen({ kind: "untranscribed", question, answerId });
        return;
      }
      if (transcribed.code === "audio_missing") {
        // No take at the slot's key, and none held here: it never left a tab that is gone. The slot
        // stays open, so the question is recorded again into the same row (07 §5.6).
        setScreen({ kind: "asked", question });
        return fail(transcribed.code, null);
      }
      return fail(transcribed.code, () => void transcribe(question, answerId));
    }
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

  /** The typing fallback (07 §5.8): the typed text becomes the raw transcript, marked as no transcriber's. */
  async function saveTyped(question: Question, answerId: string, text: string) {
    setError(null);
    setBusy(true);
    const typed = await postJson<Typed>(`/api/answers/${answerId}/transcript`, { source: "typed", text });
    if (!typed.ok) {
      // A transcript landed first, and it is final: that one is shown.
      if (typed.code === "transcript_already_final") return transcribe(question, answerId);
      return fail(typed.code, () => void saveTyped(question, answerId, text));
    }
    setBusy(false);
    setScreen({ kind: "transcript", question, transcript: { answerId, raw: typed.json.transcript_raw, durationMs: null, wpm: null } });
  }

  // Once, when the page loads onto a question with no transcript: a take held on this device goes
  // back on screen; failing that, a slot already open resumes at `transcribe` (07 §5.5).
  const resumeTake = useEffectEvent(async () => {
    const { start } = frame;
    if (start.kind !== "question" || start.transcript) return releaseTake(round.id);
    const question = { position: start.position, text: start.text, followUpVersion: start.followUpVersion };
    const take = await heldTake(slotOf(question));
    if (take) setScreen({ kind: "held", question, take, onDevice: true, cause: null });
    else if (start.openAnswerId) await transcribe(question, start.openAnswerId);
  });
  const resumed = useRef(false);
  useEffect(() => {
    if (resumed.current) return;
    resumed.current = true;
    void resumeTake();
  }, []);

  // 03 §8: while a take is only in the browser, closing the tab is what would lose it.
  const unsent = screen.kind === "held" || (screen.kind === "uploading" && !screen.uploaded);
  useEffect(() => {
    if (!unsent) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsent]);

  /** Submit (07 §5.9). The same text sent again is a retry: it returns what the first call made. */
  async function submit(question: Question, transcript: Pick<Transcript, "answerId" | "raw" | "durationMs" | "wpm">, corrected: string) {
    setError(null);
    setBusy(true);
    const { answerId } = transcript;
    const submitted = await postJson<Submitted>(`/api/answers/${answerId}/submit`, { transcript_corrected: corrected });
    // Not fatal: the answer is saved and the hole is recorded. The round goes on without the follow-up.
    const missing = !submitted.ok && submitted.code === "followup_generation_failed";
    if (!submitted.ok && !missing) return fail(submitted.code, () => void submit(question, transcript, corrected));
    setBusy(false);
    const next = submitted.ok ? nextOf(submitted.json.next) : null;

    if (practice) {
      // 10 §15: every commit opens the answer's own frame, with its score pending until it lands.
      const magnitude = (submitted.ok ? submitted.json.rewrite_magnitude : null) ?? rewriteMagnitude(transcript.raw, corrected);
      setScreen({
        kind: "answered",
        answer: {
          answerId,
          position: question.position,
          text: question.text,
          followUpVersion: question.followUpVersion,
          again: question.again !== null,
          corrected,
          durationMs: transcript.durationMs,
          wpm: transcript.wpm,
          rewrite: rewritePercent(magnitude),
          // A failed call's envelope carries no attempt; the frame reads it from the round (07 §5.5).
          scoring: submitted.ok ? submitted.json.scoring : { attempt_id: "", status: "pending" },
        },
        next: next === null ? { kind: "missing" } : next.kind === "pressure" ? { kind: "feedback" } : next,
      });
      return;
    }
    if (next === null) setScreen({ kind: "saved", question, answerId, corrected, reason: "missing" });
    else if (next.kind === "question" || next.kind === "follow_up") setScreen(asked(next));
    else setScreen({ kind: "pressure" });
  }

  /**
   * Past a follow-up that is missing or not stored yet, from the per-answer frame: the same text sent
   * again returns where the round now stands (07 §5.9), and writes the follow-up if it was only owed.
   */
  async function goOnPast(frame: Answered) {
    setError(null);
    setBusy(true);
    const { answer } = frame;
    const submitted = await postJson<Submitted>(`/api/answers/${answer.answerId}/submit`, { transcript_corrected: answer.corrected });
    if (!submitted.ok) {
      if (submitted.code !== "followup_generation_failed") return fail(submitted.code, () => void goOnPast(frame));
      setBusy(false);
      setScreen({ ...frame, next: { kind: "missing" } });
      return;
    }
    setBusy(false);
    const next = nextOf(submitted.json.next);
    if (next.kind === "question" || next.kind === "follow_up") setScreen(asked(next));
    else setScreen({ ...frame, next: { kind: "feedback" } });
  }

  /** Close the round (07 §5.12): with the rating in a realistic round, and with none in practice. */
  async function complete(value: number | null) {
    setError(null);
    setBusy(true);
    const result = await postJson(`/api/rounds/${round.id}/complete`, value === null ? {} : { felt_pressure: value });
    // The round is complete in all three: feedback written, feedback not ready, or completed already.
    const completed =
      result.ok || result.code === "feedback_generation_failed" || result.code === "round_already_complete";
    if (!completed) return fail(result.code, () => void complete(value));
    router.push(`/round/${round.id}/feedback`);
  }

  function goOn(frame: Answered) {
    const { next } = frame;
    if (next.kind === "feedback") return void complete(null);
    if (next.kind === "follow_up" || next.kind === "question") {
      setError(null);
      return setScreen(asked(next));
    }
    void goOnPast(frame);
  }

  /** 10 §15: the same prompt, asked again. Nothing is written until a take exists. */
  function answerAgain(frame: Answered) {
    const { answer } = frame;
    setError(null);
    setScreen({
      kind: "asked",
      question: { position: answer.position, text: answer.text, followUpVersion: answer.followUpVersion, again: answer.answerId },
      back: frame,
    });
  }

  let body: React.ReactNode;
  switch (screen.kind) {
    case "abandoned":
      body = (
        <div className="flex flex-col gap-[14px] px-[32px] py-[36px]">
          <p className="text-[15px] text-ink-3">{screen.byDay ? copy.abandonedByDay : copy.abandoned}</p>
          <Link href="/" className="text-[13px] text-link hover:text-link-hover hover:underline">
            {copy.home}
          </Link>
        </div>
      );
      break;
    case "asked":
    case "uploading":
    case "held":
      body = (
        <RecordFrame
          copy={copy}
          mode={round.mode}
          capSeconds={round.capSeconds}
          // Named by position, never by text: the server reads what it says (07 §5.15). A follow-up
          // shares its question's position and the route does not speak `follow_ups` yet, so it is
          // asked as text rather than with its question's audio.
          speechSrc={
            round.mode === "realistic" && screen.question.followUpVersion === null
              ? `/api/rounds/${round.id}/speech?position=${screen.question.position}&kind=question`
              : null
          }
          speechFailed={failureText("speech_failed", round.language)}
          question={screen.question}
          uploading={screen.kind === "uploading" ? (screen.uploaded ? copy.transcribingTake : copy.transcribing) : null}
          onTake={(take) => void deliver(screen.question, take)}
          onTranscribe={screen.kind === "held" ? () => void transcribe(screen.question, null, screen.answerId) : null}
          onBack={screen.kind === "asked" && screen.back ? () => setScreen(screen.back!) : null}
          error={error}
          stamp={stamp(screen.question)}
        />
      );
      break;
    case "held":
      body = (
        <StuckTakeFrame
          copy={copy}
          language={language}
          question={screen.question.text}
          notices={[
            ...(screen.cause === null ? [] : [failureText(screen.cause, language)]),
            screen.onDevice ? copy.uploadHeld : copy.uploadFailed,
          ]}
          busy={busy}
          working={copy.transcribing}
          stamp={stamp(screen.question)}
          onRetry={screen.cause === "round_abandoned" ? null : () => void deliver(screen.question, screen.take, screen.onDevice)}
          onType={null}
        />
      );
      break;
    case "untranscribed":
      body = (
        <StuckTakeFrame
          copy={copy}
          language={language}
          question={screen.question.text}
          notices={[failureText("transcription_failed", language), ...(error ? [error.text] : [])]}
          busy={busy}
          working={copy.savingTyped}
          stamp={stamp(screen.question)}
          onRetry={() => void transcribe(screen.question, screen.answerId)}
          onType={(text) => void saveTyped(screen.question, screen.answerId, text)}
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
          mode={round.mode}
          question={screen.question}
          transcript={screen.transcript}
          busy={busy}
          error={error}
          stamp={stamp(screen.question)}
          onSubmit={(corrected) => void submit(screen.question, screen.transcript, corrected)}
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
          onGoOn={() =>
            void submit(screen.question, { answerId: screen.answerId, raw: screen.corrected, durationMs: null, wpm: null }, screen.corrected)
          }
        />
      );
      break;
    case "answered":
      body = (
        <AnsweredFrame
          // A new answer is a new frame: its own score to wait for.
          key={screen.answer.answerId}
          roundId={round.id}
          language={language}
          dimensions={frame.dimensions}
          cvLabel={frame.cvLabel}
          step={prompt?.again ? copy.stepAgain(step) : step}
          answer={screen.answer}
          next={screen.next}
          nextStep={screen.next.kind === "question" ? copy.step(screen.next.position, round.length) : null}
          missingNotice={failureText("followup_generation_failed", language)}
          busy={busy}
          error={error}
          stamp={roundStamp}
          onGoOn={() => goOn(screen)}
          onAnswerAgain={() => answerAgain(screen)}
        />
      );
      break;
    case "pressure":
      body = (
        <PressureFrame copy={copy} language={language} roundId={round.id} busy={busy} error={error} stamp={roundStamp} onPick={(value) => void complete(value)} />
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

/** 10 §3: a 15px speaker, 1.2 stroke, in the line's own colour. */
function SpeakerGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4.6 6H2.4v4h2.2l3 2.4V3.6L4.6 6Z" />
      <path d="M10.1 5.7a3.1 3.1 0 0 1 0 4.6" />
      <path d="M12 3.7a5.7 5.7 0 0 1 0 8.6" />
    </svg>
  );
}

/**
 * 10 §3 and §4: the question at 19px, which does not move when recording starts.
 *
 * **Realistic speaks the question, times the take and transcribes it at once; practice does none of
 * these** (10 §15). A practice take still ends at its cap — the runaway guard,
 * `per_answer_cap_seconds = 900` — and is kept, but the guard is never drawn: no clock, no `Up to`
 * line, no waveform filling toward an end (03 §7). Stopping holds the take, uploaded, and it can be
 * recorded again until the user has it transcribed.
 */
function RecordFrame({
  copy,
  mode,
  capSeconds,
  speechSrc,
  speechFailed,
  question,
  delivering,
  held,
  onTake,
  onTranscribe,
  onBack,
  error,
  stamp,
}: {
  copy: RoundCopy;
  mode: RoundMode;
  capSeconds: number;
  /** The speech route's URL for this prompt; null in practice, which is text only. */
  speechSrc: string | null;
  /** The catalogue's `speech_failed` sentence, in the round's language. */
  speechFailed: string;
  question: Question;
  /** What is being done with the take just recorded, while it is on its way; null when there is none. */
  uploading: string | null;
  onTake: (take: Take) => void;
  onTranscribe: (() => void) | null;
  /** Back to the per-answer frame an answer-again came from, while nothing is recorded yet. */
  onBack: (() => void) | null;
  error: Failure | null;
  stamp: string;
}) {
  const timed = mode === "realistic";
  const recorder = useRecorder(capSeconds, onTake, { timed });
  const recording = recorder.state.kind === "recording" ? recorder.state : null;
  const failed = recorder.state.kind === "failed" ? recorder.state.reason : null;
  const spoken = useSpokenQuestion(speechSrc);
  // 10 §3–5: the wait line stands in for the record controls until the take's calls end or one fails.
  const waiting = delivering !== null && !error;

  function startRecording() {
    spoken.silence();
    void recorder.start();
  }

  return (
    <div className="flex flex-grow flex-col gap-[26px] px-[32px] pt-[36px] pb-[32px]">
      {/* The status replaces the speaker line (10 §4). The line keeps its height in every state, an
          empty practice one included, so the question does not move when recording starts. */}
      <div className="flex h-[18px] items-center gap-[9px]" role="status" data-testid="speaker-line">
        {recording ? (
          <>
            <span className="size-[9px] rounded-full bg-attention-mark" aria-hidden />
            <span className="text-[12px] text-attention-ink">{copy.recording}</span>
          </>
        ) : held ? (
          <span className="text-[12px] text-ink-label" data-testid="take-held">
            {copy.takeHeld}
          </span>
        ) : spoken.status === "failed" ? (
          <span className="text-[12px] text-attention-ink">{speechFailed}</span>
        ) : spoken.status === "blocked" ? (
          <button type="button" onClick={spoken.play} className="flex items-center gap-[9px] text-[12px] text-link hover:text-link-hover hover:underline">
            <SpeakerGlyph />
            {copy.playQuestion}
          </button>
        ) : spoken.status === "asked" ? (
          <span className="flex items-center gap-[9px] text-ink-label">
            <SpeakerGlyph />
            <span className="text-[12px]">{copy.spoken}</span>
          </span>
        ) : null}
      </div>

      <p className="max-w-[880px] text-[19px] leading-[1.9] text-ink-2" data-testid="round-question">
        {question.text}
      </p>
      <div className="h-px bg-rule-row" />

      {recording ? (
        <>
          {timed ? (
            <p className="flex items-baseline gap-[10px]">
              <span className="font-mono text-[30px] font-medium tracking-[0.02em]" data-testid="record-timer">
                {clock(recording.elapsedMs)}
              </span>
              <span className="font-mono text-[13px] text-ink-label">/ {clock(capSeconds * 1000)}</span>
            </p>
          ) : null}
          <div className="flex h-[34px] w-[880px] items-center" aria-hidden data-testid="waveform">
            <span className="flex items-center gap-[3px]">
              {recording.bars.map((height, index) => (
                <span key={index} className="w-[2px] bg-mark-mid" style={{ height }} />
              ))}
            </span>
            {/* The un-elapsed remainder of the take (10 §4) — which an untimed take does not have. */}
            {timed && recording.bars.length < WAVEFORM_BARS ? <span className="ml-[4px] h-px flex-1 bg-rule-axis" /> : null}
          </div>
          <div className="flex items-center gap-[22px]">
            <Button variant="outline" onClick={recorder.stop} className="gap-[12px]">
              <span className="size-[10px] bg-ink-1" aria-hidden />
              {timed ? copy.stop : copy.stopRecording}
            </Button>
            {timed ? <span className={caption}>{copy.autoStop(capSeconds)}</span> : null}
          </div>
        </>
      ) : waiting ? (
        <WaitLine
          testId="take-wait"
          sentence={delivering === "upload" ? copy.uploadingTake : copy.transcribingTake}
          hint={copy.keepWaiting}
          segments={delivering === "upload" ? ["running", "waiting"] : ["done", "running"]}
        />
      ) : (
        <>
          {held ? (
            <div className="flex flex-col gap-[10px]">
              <Button onClick={() => onTranscribe?.()} className="self-start">
                {copy.transcribeTake}
              </Button>
              <p className={caption}>{copy.transcribeTakeCaption}</p>
            </div>
          ) : null}
          <div className="flex items-center gap-[22px]">
            <Button variant="outline" onClick={() => void recorder.start()} disabled={uploading !== null} className="gap-[12px]">
              <span className="size-[11px] rounded-full bg-attention-mark" aria-hidden />
              {held ? copy.recordAgain : copy.startRecording}
            </Button>
            {held ? <span className={caption}>{copy.recordAgainCaption}</span> : null}
            {timed ? <span className="font-mono text-[12px] text-ink-label">{copy.cap(capSeconds)}</span> : null}
          </div>
          {uploading !== null && !error ? (
            <p className={caption} role="status">
              {uploading}
            </p>
          ) : (
            <div className="flex flex-col gap-[9px] text-[12px] leading-[1.75] text-ink-6">
              <span>{timed ? copy.oneTake : copy.retakeUntilTranscribed}</span>
              <span>{copy.correctAfter}</span>
            </div>
          )}
          {failed ? (
            <div data-testid="recording-failed">
              <CalloutRail tone="attention">
                {failed === "denied" ? copy.micDenied : failed === "unavailable" ? copy.micUnavailable : copy.recordingFailed}
              </CalloutRail>
            </div>
          ) : null}
          <ErrorLine error={error} retryLabel={copy.tryAgain} />
          {onBack ? (
            <button type="button" onClick={onBack} className="self-start text-[13px] text-link hover:text-link-hover hover:underline">
              {copy.backToScores}
            </button>
          ) : null}
        </>
      )}

      <div className="flex-grow" />
      <RoundFooter sentence={timed ? copy.withheld : copy.practiceShown} stamp={stamp} />
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
  mode,
  question,
  transcript,
  busy,
  error,
  stamp,
  onSubmit,
}: {
  copy: RoundCopy;
  language: RoundLanguage;
  mode: RoundMode;
  question: Question;
  transcript: Transcript;
  busy: boolean;
  error: Failure | null;
  stamp: string;
  onSubmit: (corrected: string) => void;
}) {
  // A bank question's answer gets one follow-up, made from this text; a follow-up's own answer gets
  // none, and neither does an answer given again (07 §5.9).
  const followUpNext = question.followUpVersion === null && question.again === null;
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
                  : mode === "practice"
                    ? copy.sendCaptionShown
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
  roundId,
  busy,
  error,
  stamp,
  onPick,
}: {
  copy: RoundCopy;
  language: RoundLanguage;
  roundId: string;
  busy: boolean;
  error: Failure | null;
  stamp: string;
  onPick: (value: number) => void;
}) {
  const [picked, setPicked] = useState<number | null>(null);
  const sectionLabel = roundSectionLabel(language);
  // 10 §7, while the round closes: what `complete` is waiting for, read from the round beside it.
  const closing = closingWait(copy, useScoringProgress(roundId, busy));
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
          {busy ? (
            <WaitLine testId="closing-wait" sentence={closing.sentence} hint={copy.keepWaiting} segments={closing.segments} />
          ) : (
            <p className={caption} role="status">
              {picked === null ? copy.pickOne : copy.willRecord(picked)}
            </p>
          )}
          <p className="border-t border-rule-section pt-[12px] font-mono text-[10px] leading-[1.9] text-ink-8" data-testid="round-stamp">
            {stamp}
          </p>
        </div>
      </div>
    </div>
  );
}
