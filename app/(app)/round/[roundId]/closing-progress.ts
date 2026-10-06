import { useEffect, useState } from "react";
import { getJson } from "../api";
import type { RoundCopy } from "../copy";
import type { WaitSegment } from "./wait-line";

// 10 §7, while the round closes: `complete` is one call that waits for the last scores and then
// writes the feedback (07 §5.12), so what it is waiting for is read beside it, from the round.

/** How many of the round's submitted answers are no longer waited for, of how many. */
export interface ScoringProgress {
  readonly done: number;
  readonly total: number;
}

const POLL_MS = 2_000;

/**
 * The counts in a round's read (07 §5.5): its submitted answers, follow-ups included, and those
 * whose latest attempt is no longer `pending`. A failed score counts as done — `complete` does not
 * wait for it. Only the status is read; a score is never looked at here. `null` when the read holds
 * no submitted answer to count.
 */
export function scoringProgress(read: unknown): ScoringProgress | null {
  const answers = (read as { answers?: unknown } | null)?.answers;
  if (!Array.isArray(answers)) return null;
  const submitted = answers.filter(
    (answer): answer is { state: "submitted"; scoring?: { status?: unknown } } =>
      typeof answer === "object" && answer !== null && (answer as { state?: unknown }).state === "submitted",
  );
  if (submitted.length === 0) return null;
  const done = submitted.filter((answer) => answer.scoring?.status === "ok" || answer.scoring?.status === "failed").length;
  return { done, total: submitted.length };
}

/**
 * The wait line for a closing round: a segment per answer and one for the feedback, each filled only
 * once its own thing has finished (05 §5.10). With nothing read, one running segment.
 */
export function closingWait(copy: RoundCopy, progress: ScoringProgress | null): { sentence: string; segments: WaitSegment[] } {
  if (progress === null) return { sentence: copy.completing, segments: ["running"] };
  const { done, total } = progress;
  const scored = Array.from({ length: total }, (_, index): WaitSegment => (index < done ? "done" : "running"));
  return done < total
    ? { sentence: copy.scoringAnswers(done, total), segments: [...scored, "waiting"] }
    : { sentence: copy.scoringFinished, segments: [...scored, "running"] };
}

/**
 * Re-reads the round every two seconds while it closes. A read that fails changes nothing — the line
 * keeps what it last showed — and a round that cannot be read at all is not asked again.
 */
export function useScoringProgress(roundId: string, active: boolean): ScoringProgress | null {
  const [progress, setProgress] = useState<ScoringProgress | null>(null);
  useEffect(() => {
    if (!active) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function read() {
      const result = await getJson<unknown>(`/api/rounds/${roundId}`);
      if (stopped) return;
      if (result.ok) {
        const counts = scoringProgress(result.json);
        if (counts) setProgress(counts);
      } else if (result.status === 404) return;
      timer = setTimeout(() => void read(), POLL_MS);
    }
    void read();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [roundId, active]);
  return active ? progress : null;
}
