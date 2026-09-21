/**
 * The shared error envelope (07 §2) and the closed error-code catalogue (07 §3).
 *
 * Every non-2xx response from every endpoint is built here, without exception. Three rules this
 * file exists to keep:
 *
 * - **`message` is never rendered.** It is English, one sentence, for the developer and the log
 *   line. The user-visible sentence is looked up from `lib/copy/errors.ts` by `code`. That is what
 *   keeps the still-open bilingual chrome rule (`CONTEXT.md`) out of the API layer — this file
 *   holds no user-visible string, so it cannot decide the rule by accident.
 * - **`detail` obeys 03 §8's never-log list.** Ids, counts, durations and error classes. No
 *   transcript, corrected text, CV or claim text, company notes, prompt bodies, model response
 *   bodies or salary expectations. A validation failure names *which field* failed, never its
 *   value. `ErrorDetailValue` is deliberately flat: a nested object is how a whole CV row gets
 *   dropped into an envelope by accident.
 * - **403 is used nowhere** (07 §2). Another user's row is a 404, and a request refused by an
 *   invariant is a 422 whose code names which invariant.
 */

export const ERROR_STATUS = {
  unauthenticated: 401,
  invalid_request: 400,
  not_found: 404,
  rate_limited: 429,
  model_unavailable: 503,
  question_generation_failed: 502,
  presign_failed: 502,
  upload_too_large: 422,
  unsupported_content_type: 422,
  audio_missing: 404,
  transcription_failed: 502,
  transcript_already_final: 422,
  answer_already_submitted: 422,
  followup_generation_failed: 502,
  scoring_failed: 502,
  scoring_not_retryable: 422,
  pressure_not_applicable: 422,
  pressure_required: 422,
  round_already_complete: 409,
  round_not_complete: 409,
  cv_unchanged: 422,
  cv_extraction_failed: 502,
  upstream_s3: 502,
  upstream_openai: 502,
} as const satisfies Record<string, number>;

export type ErrorCode = keyof typeof ERROR_STATUS;

export type ErrorDetailValue = string | number | boolean | readonly string[];
export type ErrorDetail = Readonly<Record<string, ErrorDetailValue>>;

export interface ErrorEnvelope {
  readonly error: {
    readonly code: ErrorCode;
    readonly message: string;
    readonly detail: ErrorDetail;
  };
}

function envelope(
  code: ErrorCode,
  message: string,
  detail: ErrorDetail,
  headers?: HeadersInit,
): Response {
  const body: ErrorEnvelope = { error: { code, message, detail } };
  return Response.json(body, { status: ERROR_STATUS[code], headers });
}

/** The one builder. `message` is for the log; the user's sentence comes from `lib/copy/errors.ts`. */
export function apiError(code: ErrorCode, message: string, detail: ErrorDetail = {}): Response {
  return envelope(code, message, detail);
}

/**
 * 07 §2: a 429 always carries `Retry-After`, so the screen can say how long rather than guess.
 * Rounded up — a wait reported as 0 reads as "try again now", which is the one thing it is not.
 */
export function rateLimited(
  message: string,
  retryAfterSeconds: number,
  detail: ErrorDetail = {},
): Response {
  return envelope("rate_limited", message, detail, {
    "Retry-After": String(Math.max(1, Math.ceil(retryAfterSeconds))),
  });
}

/**
 * 08 §5: `/api/*` answers 401 with the envelope and **no redirect**. Called from `proxy.ts`,
 * which decides only where an unauthenticated request lands, and from `lib/auth/session.ts`, which
 * is the actual re-check.
 */
export function unauthenticated(): Response {
  return apiError("unauthenticated", "No session, or the session has expired.");
}
