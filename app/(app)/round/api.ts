import type { ErrorCode } from "@/lib/api/errors";
import { ERROR_COPY } from "@/lib/copy/errors";
import { ROUND_COPY, type RoundLanguage } from "./copy";

// The round screens' one way to call a round route: JSON in, the envelope's code out on failure.
// "unreachable" is the one failure with no envelope — the request or its response never arrived.

export type FailureCode = ErrorCode | "unreachable";

export type Result<T> =
  | { readonly ok: true; readonly status: number; readonly json: T }
  | { readonly ok: false; readonly status: number; readonly code: FailureCode };

export async function postJson<T>(path: string, body: object = {}): Promise<Result<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, status: 0, code: "unreachable" };
  }
  const json = await response.json().catch(() => null);
  if (response.ok && json !== null) return { ok: true, status: response.status, json: json as T };
  const code = json?.error?.code;
  return { ok: false, status: response.status, code: typeof code === "string" && code in ERROR_COPY ? (code as ErrorCode) : "unreachable" };
}

/** The sentence for a failure, in the screen's language (10 §0). */
export function failureText(code: FailureCode, language: RoundLanguage) {
  return code === "unreachable" ? ROUND_COPY[language].unreachable : ERROR_COPY[code][language];
}
