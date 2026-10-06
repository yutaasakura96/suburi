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
 * The counts in a round's read (07 §5.5): its questions with a submitted answer, follow-ups
 * included, and those with no attempt still `pending`. **Each question counts once** (10 §15): an
 * answer given again stands beside its original with the same `retry_of_answer_id`, so the rows are
 * collapsed to the original's id. A question is done by the answers `complete` waits for (07 §5.12):
 * its original, with the answers given again ignored — and those instead only when no original has a
 * score in or still to land. A failed score counts as done — `complete` does not wait for it. Only
 * the status is read; a score is never looked at here. `null` when the read holds no submitted answer
 * to count.
 */
export function scoringProgress(read: unknown): ScoringProgress | null {
  const answers = (read as { answers?: unknown } | null)?.answers;
  if (!Array.isArray(answers)) return null;
  const questions = new Map<string, { original: boolean; retries: boolean }>();
  let originalsDecide = false;
  for (const answer of answers) {
    if (typeof answer !== "object" || answer === null) continue;
    const { id, state, retry_of_answer_id: retryOf, scoring } = answer as {
      id?: unknown;
      state?: unknown;
      retry_of_answer_id?: unknown;
      scoring?: { status?: unknown };
    };
    if (state !== "submitted") continue;
    const retry = typeof retryOf === "string";
    const key = retry ? retryOf : typeof id === "string" ? id : `row ${questions.size}`;
    const settled = scoring?.status === "ok" || scoring?.status === "failed";
    const question = questions.get(key) ?? { original: true, retries: true };
    if (retry) question.retries &&= settled;
    else question.original = settled;
    if (!retry && scoring?.status !== "failed") originalsDecide = true;
    questions.set(key, question);
  }
  if (questions.size === 0) return null;
  const done = [...questions.values()].filter((question) => (originalsDecide ? question.original : question.retries));
  return { done: done.length, total: questions.size };
}

/**
 * The wait line for a closing round: a segment per answer and one for the feedback, each filled only
 * once its own thing has finished (05 §5.10). With nothing read, one running segment — which says
 * nothing of a rating when none is asked, as in a practice round (10 §15).
 */
export function closingWait(
  copy: RoundCopy,
  progress: ScoringProgress | null,
  rated = true,
): { sentence: string; segments: WaitSegment[] } {
  if (progress === null) return { sentence: rated ? copy.completing : copy.retryingFindings, segments: ["running"] };
  const { done, total } = progress;
  const scored = Array.from({ length: total }, (_, index): WaitSegment => (index < done ? "done" : "running"));
  return done < total
    ? { sentence: copy.scoringAnswers(done, total), segments: [...scored, "waiting"] }
    : { sentence: copy.scoringFinished, segments: [...scored, "running"] };
}

/**
 * Re-reads the round every two seconds while it closes. A read that fails changes nothing — the line
 * keeps what it last showed.
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
      const counts = result.ok ? scoringProgress(result.json) : null;
      if (counts) setProgress(counts);
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
