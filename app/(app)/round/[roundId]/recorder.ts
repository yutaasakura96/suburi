"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// One take (10 §4): the microphone through MediaRecorder, a clock, and a waveform sampled from the
// input level. **At the cap the take ends by itself and what was captured is kept** — no countdown,
// no grace period, no prompt.

/** The two content types `POST …/answers` accepts (07 §5.6). */
export type TakeContentType = "audio/webm;codecs=opus" | "audio/webm";

export interface Take {
  readonly blob: Blob;
  readonly contentType: TakeContentType;
}

/** 10 §4: bars 2px wide at a 3px gap across the question's 880px measure. */
export const WAVEFORM_BARS = 176;
const MIN_BAR = 5;
const MAX_BAR = 28;

type State =
  | { readonly kind: "idle" }
  | { readonly kind: "recording"; readonly elapsedMs: number; readonly bars: readonly number[] }
  | { readonly kind: "failed"; readonly reason: "denied" | "unavailable" | "recording" };

function preferredType(): TakeContentType {
  return typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
    ? "audio/webm;codecs=opus"
    : "audio/webm";
}

/**
 * A practice take has no timer (10 §15): its waveform scrolls at a fixed pace instead of filling the
 * measure over the cap, because a fill would draw the runaway guard as the timer it is not (03 §7).
 */
const SCROLLING_BAR_MS = 1_000;

export function useRecorder(capSeconds: number, onTake: (take: Take) => void, { timed = true }: { timed?: boolean } = {}) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const session = useRef<{
    recorder: MediaRecorder;
    stream: MediaStream;
    audio: AudioContext;
    timer: number;
    stopAt: number;
  } | null>(null);
  const mounted = useRef(true);
  const onTakeRef = useRef(onTake);
  useEffect(() => {
    onTakeRef.current = onTake;
  }, [onTake]);

  const release = useCallback(() => {
    const current = session.current;
    if (!current) return;
    window.clearInterval(current.timer);
    window.clearTimeout(current.stopAt);
    current.stream.getTracks().forEach((track) => track.stop());
    void current.audio.close().catch(() => {});
    session.current = null;
  }, []);

  const stop = useCallback(() => {
    const recorder = session.current?.recorder;
    if (recorder && recorder.state !== "inactive") recorder.stop();
  }, []);

  const start = useCallback(async () => {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      if (!mounted.current) return;
      // Denied or absent: nothing is written, and the question stays unseen (10 §4). A refusal is the
      // one the user can lift in the browser, so it is told apart (03 §8).
      const denied = error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError");
      setState({ kind: "failed", reason: denied ? "denied" : "unavailable" });
      return;
    }
    if (!mounted.current) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    const contentType = preferredType();
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, { mimeType: contentType });
    } catch {
      stream.getTracks().forEach((track) => track.stop());
      setState({ kind: "failed", reason: "recording" });
      return;
    }

    const audio = new AudioContext();
    const analyser = audio.createAnalyser();
    analyser.fftSize = 1024;
    audio.createMediaStreamSource(stream).connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);
    const startedAt = performance.now();
    const barEveryMs = timed ? (capSeconds * 1000) / WAVEFORM_BARS : SCROLLING_BAR_MS;
    let bars: number[] = [];
    let drawn = 0;
    let peak = 0;

    // The level between bars is the peak since the last one, so a short word still draws.
    const timer = window.setInterval(() => {
      analyser.getByteTimeDomainData(samples);
      for (const sample of samples) peak = Math.max(peak, Math.abs(sample - 128) / 128);
      const elapsedMs = performance.now() - startedAt;
      if (drawn < Math.floor(elapsedMs / barEveryMs) + 1 && (!timed || drawn < WAVEFORM_BARS)) {
        bars = [...bars, MIN_BAR + Math.round(Math.min(1, peak * 2.5) * (MAX_BAR - MIN_BAR))].slice(-WAVEFORM_BARS);
        drawn += 1;
        peak = 0;
      }
      setState({ kind: "recording", elapsedMs: Math.min(elapsedMs, capSeconds * 1000), bars });
    }, 100);

    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onstop = () => {
      release();
      if (!mounted.current) return;
      const blob = new Blob(chunks, { type: contentType });
      if (blob.size === 0) {
        setState({ kind: "failed", reason: "recording" });
        return;
      }
      setState({ kind: "idle" });
      onTakeRef.current({ blob, contentType });
    };
    recorder.onerror = () => {
      release();
      if (!mounted.current) return;
      setState({ kind: "failed", reason: "recording" });
    };

    session.current = {
      recorder,
      stream,
      audio,
      timer,
      stopAt: window.setTimeout(() => {
        if (recorder.state !== "inactive") recorder.stop();
      }, capSeconds * 1000),
    };
    recorder.start(1000);
    setState({ kind: "recording", elapsedMs: 0, bars: [] });
  }, [capSeconds, timed, release]);

  // Leaving the page mid-take releases the microphone; the take is discarded, as a failed one is.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      release();
    };
  }, [release]);

  return { state, start, stop };
}
