"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Realistic mode's spoken question (10 §3): the speech route's stream, played once as the question is
// asked. The text is already on screen, so nothing here ever stands between the user and the round —
// a failed synthesis is a notice, and the answer is recorded as usual (06, 2026-09-28).

/**
 * - `asked`: the audio was requested and is playing, or has played.
 * - `blocked`: the browser refused to play sound the user did not ask for — a reload lands here,
 *   since the tab has had no gesture yet. `play` is then the gesture.
 * - `failed`: the route answered with an error, or the audio could not be played.
 */
export type SpokenStatus = "asked" | "blocked" | "failed";

/** `src` is the speech route's URL for the prompt on screen, or null where nothing is spoken. */
export function useSpokenQuestion(src: string | null) {
  const element = useRef<HTMLAudioElement | null>(null);
  // Kept with the prompt it is about, so the next question starts as `asked`, not as the last one's.
  const [outcome, setOutcome] = useState<{ src: string; status: SpokenStatus } | null>(null);

  useEffect(() => {
    if (src === null) return;
    const audio = new Audio(src);
    element.current = audio;
    let current = true;
    const settle = (status: SpokenStatus) => {
      if (current) setOutcome({ src, status });
    };
    audio.addEventListener("error", () => settle("failed"));
    // A load failure also rejects, but the `error` event has already said so; only a refusal is news.
    audio.play().catch((error: unknown) => {
      if ((error as { name?: string }).name === "NotAllowedError") settle("blocked");
    });
    return () => {
      current = false;
      audio.pause();
      // Dropping the source ends the request: the audio is not kept past the question (03 §4).
      audio.removeAttribute("src");
      audio.load();
      element.current = null;
    };
  }, [src]);

  /** After `blocked`: the click is the gesture the browser wanted. */
  const play = useCallback(() => {
    const audio = element.current;
    if (!audio || src === null) return;
    setOutcome({ src, status: "asked" });
    audio.play().catch((error: unknown) => {
      if ((error as { name?: string }).name === "NotAllowedError") setOutcome({ src, status: "blocked" });
    });
  }, [src]);

  /** Recording starts: the microphone must not hear the question. */
  const silence = useCallback(() => element.current?.pause(), []);

  const status: SpokenStatus | null = src === null ? null : outcome?.src === src ? outcome.status : "asked";
  return { status, play, silence };
}
