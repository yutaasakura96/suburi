import OpenAI from "openai";
import { describe, expect, it } from "vitest";
import { retryableErrorClass, upstreamErrorClass } from "./upstream";

function apiError(status: number, code: string | null) {
  return OpenAI.APIError.generate(status, { error: { message: "refused", type: "insufficient_quota", code } }, undefined, new Headers());
}

describe("a spent OpenAI budget (12 §6, 06 2026-09-27 confirm 5)", () => {
  it("classes a 429 project spend limit as itself, not as a rate limit", () => {
    const code = "project_spend_limit_exceeded";
    const errorClass = upstreamErrorClass(apiError(429, code));
    expect(errorClass).toBe(code);
    expect(retryableErrorClass(errorClass)).toBe(false);
  });

  it("still classes an ordinary 429 as a rate limit, which is retried", () => {
    const errorClass = upstreamErrorClass(apiError(429, "rate_limit_exceeded"));
    expect(errorClass).toBe("upstream_429");
    expect(retryableErrorClass(errorClass)).toBe(true);
  });

  it("does not read the code off another status", () => {
    expect(upstreamErrorClass(apiError(400, "project_spend_limit_exceeded"))).toBe("upstream_400");
  });
});
