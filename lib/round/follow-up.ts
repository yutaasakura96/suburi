import type { FollowUpGenerator } from "../ai/follow-up";
import { ModelCallFailed, retryableErrorClass } from "../ai/upstream";
import { log } from "./http";
import type { AnswerRow, RoundRow } from "./state";

/**
 * Generates the one follow-up to an answer (07 §5.9), **outside any transaction** — the caller
 * stores what this returns, as `generated` or as `missing`.
 *
 * **The user is waiting for this inside a round**, so it is bounded on its own, well inside the
 * invocation: one call of at most `FOLLOW_UP_TIMEOUT_MS`, and one retry when the failure is one a
 * second call could get past. The timeout is three times the slowest call seen: 14.6 s for a Japanese
 * follow-up under `follow-up-ja-1.1` (03 §4, 2026-10-15), where `follow-up-en-1.0`'s 4.7 s had set it
 * at 15 s (06, 2026-10-16, L1). With the retry the longest wait is about 91 s. When the second call
 * fails too the follow-up is **missing**: a missing follow-up costs one prompt, and holding the round
 * for a third try costs the sitting its rhythm.
 */
export const FOLLOW_UP_TIMEOUT_MS = 45_000;
export const FOLLOW_UP_RETRIES = 1;
export const FOLLOW_UP_BACKOFF_MS = 1_000;

export interface FollowUpDeps {
  readonly followUpGenerator: FollowUpGenerator;
  readonly sleep?: (ms: number) => Promise<void>;
}

export type FollowUpOutcome =
  | {
      readonly status: "generated";
      readonly text: string;
      /** Its English, or null: an English round's, or one dropped by the port's check (Q106-4). */
      readonly english: string | null;
      readonly tokensIn: number | null;
      readonly tokensOut: number | null;
    }
  | { readonly status: "missing"; readonly errorClass: string };

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function generateFollowUp(deps: FollowUpDeps, round: RoundRow, parent: AnswerRow): Promise<FollowUpOutcome> {
  const sleep = deps.sleep ?? wait;
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);

  let errorClass = "unexpected";
  for (let attempt = 0; attempt <= FOLLOW_UP_RETRIES; attempt += 1) {
    if (attempt > 0) await sleep(FOLLOW_UP_BACKOFF_MS);
    try {
      const result = await deps.followUpGenerator.generate(
        {
          language: round.language,
          roundType: round.roundType,
          prompt: parent.promptText,
          // The corrected text, never the raw one (10 §6).
          answer: parent.transcriptCorrected ?? "",
        },
        { timeoutMs: FOLLOW_UP_TIMEOUT_MS },
      );
      log("info", {
        event: "follow_up_generated",
        answer_id: parent.id,
        retries: attempt,
        tokens_in: result.tokensIn,
        tokens_out: result.tokensOut,
        duration_ms: elapsed(),
      });
      // A dropped English is asked without, never made missing (06, 2026-10-14, Q106-4): a count
      // and a class, never the text (12 §7).
      if (result.englishDropped) {
        log("error", { event: "follow_up_english_dropped", answer_id: parent.id, error_class: result.englishDropped, count: 1 });
      }
      return { status: "generated", text: result.text, english: result.english, tokensIn: result.tokensIn, tokensOut: result.tokensOut };
    } catch (error) {
      errorClass = error instanceof ModelCallFailed ? error.errorClass : "unexpected";
      log("error", { event: "follow_up_call_failed", answer_id: parent.id, retry: attempt, error_class: errorClass });
      if (!retryableErrorClass(errorClass)) break;
    }
  }
  log("error", {
    event: "follow_up_generation_failed",
    answer_id: parent.id,
    model_id: deps.followUpGenerator.modelId,
    error_class: errorClass,
    duration_ms: elapsed(),
  });
  return { status: "missing", errorClass };
}
