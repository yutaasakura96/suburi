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
  | { readonly kind: "failed"; readonly reason: "unavailable" | "recording" };

function preferredType(): TakeContentType {
  return typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
    ? "audio/webm;codecs=opus"
    : "audio/webm";
}

export function useRecorder(capSeconds: number, onTake: (take: Take) => void) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const session = useRef<{
    recorder: MediaRecorder;
    stream: MediaStream;
    audio: AudioContext;
    timer: number;
    stopAt: number;
  } | null>(null);
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
    } catch {
      // Denied or absent: nothing is written, and the question stays unseen (10 §4).
      setState({ kind: "failed", reason: "unavailable" });
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
    const barEveryMs = (capSeconds * 1000) / WAVEFORM_BARS;
    let bars: number[] = [];
    let peak = 0;

    // The level between bars is the peak since the last one, so a short word still draws.
    const timer = window.setInterval(() => {
      analyser.getByteTimeDomainData(samples);
      for (const sample of samples) peak = Math.max(peak, Math.abs(sample - 128) / 128);
      const elapsedMs = performance.now() - startedAt;
      if (bars.length < Math.min(WAVEFORM_BARS, Math.floor(elapsedMs / barEveryMs) + 1)) {
        bars = [...bars, MIN_BAR + Math.round(Math.min(1, peak * 2.5) * (MAX_BAR - MIN_BAR))];
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
  }, [capSeconds, release]);

  // Leaving the page mid-take releases the microphone; the take is discarded, as a failed one is.
  useEffect(() => release, [release]);

  return { state, start, stop };
}
