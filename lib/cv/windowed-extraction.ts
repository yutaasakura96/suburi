import {
  ExtractionFailed,
  type CvClaimExtractor,
  type CvLanguage,
  type ExtractedClaim,
  type ExtractionDocument,
} from "../ai/extract-cv-claims";
import { planWindows, type ExtractionWindow } from "./windows";

/**
 * One synchronous extraction as **N parallel windowed calls** (07 §5.2, #29). Every call is sent the
 * whole set and returns the claims of one window (`windows.ts`), so the cross-document rule — one
 * claim for an assertion written in two documents — still sees both documents, while no single call
 * has to write out a whole long CV's claims.
 *
 * **All or nothing, before anything is written.** The calls run with `Promise.all` and all of them
 * finish before the caller opens its transaction. If any window fails for good, the rest are aborted
 * and the whole extraction fails with that window's error class, which the caller turns into
 * `502 cv_extraction_failed` exactly as it did for one call. Never a partial set of windows: a
 * version holding half its claims is worse than a save the user repeats (03 §4).
 *
 * **One retry per window, only when it fits.** The invocation shares Vercel Hobby's 300 s with
 * everything around the calls. A window that failed with a transient error is retried once, if
 * `MIN_RETRY_MS` of the deadline is left, with a timeout of whatever is left. A window that timed out
 * at the client's 240 s is past that point, so it fails the save rather than outliving the route.
 */

/** The route's 300 s `maxDuration`, less 30 s for the session, the reads and the transaction. */
export const EXTRACTION_DEADLINE_MS = 270_000;

/** The client's timeout for a first attempt (`lib/ai/extract-cv-claims.ts`). */
const FIRST_ATTEMPT_TIMEOUT_MS = 240_000;

/** A retry needs this much of the deadline left: above the slowest measured window call, 52.7 s. */
export const MIN_RETRY_MS = 60_000;

/**
 * A refusal the same request would get again is not retried: a 4xx other than a timeout, a conflict
 * or a rate limit, or a call aborted because another window already failed.
 */
function retryable(errorClass: string) {
  if (errorClass === "aborted") return false;
  const status = /^upstream_(4\d\d)$/u.exec(errorClass)?.[1];
  return status === undefined || ["408", "409", "429"].includes(status);
}

export interface WindowResult {
  readonly window: ExtractionWindow;
  readonly claims: readonly ExtractedClaim[];
}

export interface WindowedExtraction {
  readonly results: readonly WindowResult[];
  readonly windows: number;
  /** Windows that failed once and were sent again. */
  readonly retries: number;
}

/** Thrown in place of the port's own error, so the caller can log the fan-out's shape too. */
export class WindowedExtractionFailed extends ExtractionFailed {
  readonly windows: number;
  readonly retries: number;

  constructor(errorClass: string, windows: number, retries: number) {
    super(errorClass);
    this.name = "WindowedExtractionFailed";
    this.windows = windows;
    this.retries = retries;
  }
}

export async function extractByWindow(
  extractor: CvClaimExtractor,
  language: CvLanguage,
  documents: readonly ExtractionDocument[],
  { now = () => performance.now() }: { now?: () => number } = {},
): Promise<WindowedExtraction> {
  const windows = planWindows(documents.map((document) => document.text));
  const started = now();
  const abort = new AbortController();
  let retries = 0;
  let failed: string | null = null;

  const classOf = (error: unknown) => (error instanceof ExtractionFailed ? error.errorClass : "unexpected");

  async function read(window: ExtractionWindow): Promise<WindowResult> {
    try {
      const claims = await extractor.extract(language, documents, window, {
        signal: abort.signal,
        timeoutMs: FIRST_ATTEMPT_TIMEOUT_MS,
      });
      return { window, claims };
    } catch (first) {
      const left = EXTRACTION_DEADLINE_MS - (now() - started);
      if (abort.signal.aborted || !retryable(classOf(first)) || left < MIN_RETRY_MS) throw first;
      retries += 1;
      const claims = await extractor.extract(language, documents, window, {
        signal: abort.signal,
        timeoutMs: Math.min(FIRST_ATTEMPT_TIMEOUT_MS, left),
      });
      return { window, claims };
    }
  }

  try {
    const results = await Promise.all(
      windows.map((window) =>
        read(window).catch((error: unknown) => {
          // The first window to fail for good names the failure; the others are stopped, not waited on.
          failed ??= classOf(error);
          abort.abort();
          throw error;
        }),
      ),
    );
    return { results, windows: windows.length, retries };
  } catch {
    throw new WindowedExtractionFailed(failed ?? "unexpected", windows.length, retries);
  }
}
