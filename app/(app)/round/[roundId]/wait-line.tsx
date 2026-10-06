"use client";

import { useEffect, useState } from "react";
import { clock } from "../copy";
import { caption } from "../parts";

/** One thing a wait is for: finished, in flight, or not started (05 §5.10). */
export type WaitSegment = "done" | "running" | "waiting";

/** Whole seconds since this was mounted — the wait's own clock, which a remount starts again. */
function useElapsedSeconds() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const started = performance.now();
    const timer = setInterval(() => setSeconds(Math.floor((performance.now() - started) / 1000)), 250);
    return () => clearInterval(timer);
  }, []);
  return seconds;
}

/**
 * 05 §5.10: what is happening, a track with one segment per thing waited for beside the time since
 * the wait began, and what to do. **A segment fills only for something that happened**; a running one
 * carries a travelling sliver, which says a call is in flight and nothing about how far along it is.
 * The sentence is the live region — the clock ticks every second and is not announced.
 */
export function WaitLine({
  sentence,
  hint,
  segments,
  testId,
}: {
  sentence: string;
  hint: string;
  segments: readonly WaitSegment[];
  testId: string;
}) {
  const seconds = useElapsedSeconds();
  return (
    <div className="flex flex-col gap-[10px]" data-testid={testId}>
      <p className="text-[13px] leading-[1.75] text-ink-2" role="status">
        {sentence}
      </p>
      <div className="flex items-center gap-[14px]">
        <span className="flex h-[2px] max-w-[240px] flex-1 gap-[4px]" aria-hidden data-testid="wait-track">
          {segments.map((segment, index) => (
            <span
              key={index}
              data-segment={segment}
              className={`relative flex-1 overflow-hidden ${segment === "done" ? "bg-mark" : "bg-rule-section"}`}
            >
              {segment === "running" ? (
                <span className="absolute inset-y-0 left-0 w-1/3 animate-wait-travel bg-mark-mid motion-reduce:w-full motion-reduce:animate-none" />
              ) : null}
            </span>
          ))}
        </span>
        <span className="font-mono text-[12px] text-ink-label" aria-hidden data-testid="wait-elapsed">
          {clock(seconds * 1000)}
        </span>
      </div>
      <p className={caption}>{hint}</p>
    </div>
  );
}
