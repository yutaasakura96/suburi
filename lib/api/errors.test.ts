import { describe, expect, it } from "vitest";
import { apiError, ERROR_STATUS, type ErrorCode, rateLimited, unauthenticated } from "./errors";

const codes = Object.keys(ERROR_STATUS) as ErrorCode[];

// 07 §2's status table. A code mapped to anything outside this set is a code the table does not
// define a body for.
const STATUSES_DEFINED_BY_07 = [400, 401, 404, 409, 422, 429, 502, 503];

async function envelopeOf(response: Response) {
  return (await response.json()) as { error: { code: string; message: string; detail: unknown } };
}

describe("the error code table", () => {
  it("covers every 07 §3 code and nothing else", () => {
    expect(codes).toEqual([
      "unauthenticated",
      "invalid_request",
      "not_found",
      "rate_limited",
      "model_unavailable",
      "question_generation_failed",
      "presign_failed",
      "upload_too_large",
      "unsupported_content_type",
      "audio_missing",
      "transcription_failed",
      "transcript_already_final",
      "answer_already_submitted",
      "followup_generation_failed",
      "scoring_failed",
      "scoring_not_retryable",
      "pressure_not_applicable",
      "pressure_required",
      "round_already_complete",
      "round_not_complete",
      "cv_unchanged",
      "cv_extraction_failed",
      "upstream_s3",
      "upstream_openai",
    ]);
  });

  it.each(codes)("maps %s to a status 07 §2 defines a body for", (code) => {
    expect(STATUSES_DEFINED_BY_07).toContain(ERROR_STATUS[code]);
  });

  // 07 §2: 422 is "an invariant refused this", and its code names which. 403 is used nowhere.
  it("never uses 403", () => {
    expect(Object.values(ERROR_STATUS)).not.toContain(403);
  });
});

describe("apiError", () => {
  it.each(codes)("answers %s with the status the table gives it", async (code) => {
    const response = apiError(code, "A developer sentence.");
    expect(response.status).toBe(ERROR_STATUS[code]);
    expect(response.headers.get("content-type")).toContain("application/json");
  });

  it("builds the 07 §2 envelope and nothing beside it", async () => {
    const body = await envelopeOf(apiError("cv_unchanged", "No document differs from v3.", {
      language: "ja",
    }));
    expect(body).toEqual({
      error: {
        code: "cv_unchanged",
        message: "No document differs from v3.",
        detail: { language: "ja" },
      },
    });
    expect(Object.keys(body)).toEqual(["error"]);
    expect(Object.keys(body.error)).toEqual(["code", "message", "detail"]);
  });

  it("defaults detail to an empty object rather than omitting it", async () => {
    const body = await envelopeOf(apiError("not_found", "No round with that id for this user."));
    expect(body.error.detail).toEqual({});
  });

  // 03 §8: detail carries ids, counts, durations and error classes. Nothing the caller did not
  // put there — the builder never reaches for request or session state of its own accord.
  it("carries only what the caller passed", async () => {
    const detail = { answer_id: "c001e8a2", audio_duration_ms: 94000, attempt: 2 };
    const body = await envelopeOf(apiError("transcription_failed", "No text returned.", detail));
    expect(body.error.detail).toEqual(detail);
  });
});

describe("rateLimited", () => {
  it("answers 429 with Retry-After in whole seconds", async () => {
    const response = rateLimited("Six model calls in the last minute.", 42, { limit: 5 });
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("42");
    const body = await envelopeOf(response);
    expect(body.error.code).toBe("rate_limited");
    expect(body.error.detail).toEqual({ limit: 5 });
  });

  it("rounds a fractional wait up, never down to zero", () => {
    expect(rateLimited("m", 0.2).headers.get("Retry-After")).toBe("1");
    expect(rateLimited("m", 41.1).headers.get("Retry-After")).toBe("42");
  });
});

// #6 put this behind proxy.ts. Moving it onto the builder must not change a byte of the response.
describe("unauthenticated", () => {
  it("still answers exactly as it did before the envelope builder existed", async () => {
    const response = unauthenticated();
    expect(response.status).toBe(401);
    expect(await envelopeOf(response)).toEqual({
      error: {
        code: "unauthenticated",
        message: "No session, or the session has expired.",
        detail: {},
      },
    });
  });

  it("does not redirect (08 §5)", () => {
    expect(unauthenticated().headers.get("location")).toBeNull();
  });
});
