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

export function upstreamErrorClass(error: unknown): string {
  if (error instanceof ModelCallFailed) return error.errorClass;
  if (error instanceof OpenAI.APIUserAbortError) return "aborted";
  if (error instanceof OpenAI.APIConnectionTimeoutError) return "upstream_timeout";
  if (error instanceof OpenAI.APIConnectionError) return "upstream_unreachable";
  if (error instanceof OpenAI.APIError) return `upstream_${error.status ?? "error"}`;
  return "malformed_output";
}

/**
 * No SDK retries: every caller shares Vercel Hobby's 300 s with whatever else its invocation does, so
 * the retrying is the caller's, which knows how much of that budget is left. `baseURL` is set only by
 * Playwright, at its mock (`lib/config.ts` refuses anything but a local host).
 */
export function openAiClient({ apiKey, baseURL = OPENAI_BASE_URL }: { apiKey: string; baseURL?: string }) {
  return new OpenAI({ apiKey, baseURL, maxRetries: 0, timeout: 120_000 });
}
