import OpenAI from "openai";

// Shared by the round loop's ports. An error class is safe to log and to put in an envelope's
// `detail`; nothing here ever carries a prompt, an answer or a model response (03 §8).

export const OPENAI_BASE_URL = "https://api.openai.com/v1";

/** A port's only failure: the class of what went wrong, never its content. */
export class ModelCallFailed extends Error {
  readonly errorClass: string;

  constructor(job: string, errorClass: string) {
    super(`${job} failed: ${errorClass}`);
    this.name = "ModelCallFailed";
    this.errorClass = errorClass;
  }
}

/**
 * A spent budget (12 §6): OpenAI answers `429` with one of these codes once a hard monthly limit is
 * reached (its spend-limits guide). **It is a 429 that no wait clears**, so it keeps its own class —
 * the code itself — and is never read as a rate limit (06, 2026-09-27, confirm 5).
 */
export const SPEND_LIMIT_CLASSES = ["project_spend_limit_exceeded", "organization_spend_limit_exceeded"] as const;

function spendLimitClass(error: InstanceType<typeof OpenAI.APIError>) {
  if (error.status !== 429) return undefined;
  return SPEND_LIMIT_CLASSES.find((code) => code === error.code);
}

export function upstreamErrorClass(error: unknown): string {
  if (error instanceof ModelCallFailed) return error.errorClass;
  if (error instanceof OpenAI.APIUserAbortError) return "aborted";
  if (error instanceof OpenAI.APIConnectionTimeoutError) return "upstream_timeout";
  if (error instanceof OpenAI.APIConnectionError) return "upstream_unreachable";
  if (error instanceof OpenAI.APIError) return spendLimitClass(error) ?? `upstream_${error.status ?? "error"}`;
  return "malformed_output";
}

/**
 * A refusal the same request would get again is not retried: a 4xx other than a timeout, a conflict
 * or a rate limit, a spent budget, or a call its caller aborted. Everything else — a 5xx, a timeout,
 * an unreachable upstream, an output that failed its check — may come back differently the second time.
 */
export function retryableErrorClass(errorClass: string) {
  if (errorClass === "aborted") return false;
  if ((SPEND_LIMIT_CLASSES as readonly string[]).includes(errorClass)) return false;
  const status = /^upstream_(4\d\d)$/u.exec(errorClass)?.[1];
  return status === undefined || ["408", "409", "429"].includes(status);
}

/**
 * No SDK retries: every caller shares Vercel Hobby's 300 s with whatever else its invocation does, so
 * the retrying is the caller's, which knows how much of that budget is left. `baseURL` is set only by
 * Playwright, at its mock (`lib/config.ts` refuses anything but a local host).
 */
export function openAiClient({ apiKey, baseURL = OPENAI_BASE_URL }: { apiKey: string; baseURL?: string }) {
  return new OpenAI({ apiKey, baseURL, maxRetries: 0, timeout: 120_000 });
}
