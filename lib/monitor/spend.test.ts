import { describe, expect, it } from "vitest";
import { CV_EXTRACTION_MODEL, MODEL_PRICES } from "../ai/models";
import { spendUsd } from "./spend";

describe("spendUsd", () => {
  it("prices the pinned model at its verified rates: $4.00 in, $20.00 out per million", () => {
    expect(MODEL_PRICES[CV_EXTRACTION_MODEL]).toEqual({ inputPerMillion: 4, outputPerMillion: 20 });
    expect(spendUsd([{ modelId: CV_EXTRACTION_MODEL, tokensIn: 1_000_000, tokensOut: 0 }])).toBe(4);
    expect(spendUsd([{ modelId: CV_EXTRACTION_MODEL, tokensIn: 0, tokensOut: 1_000_000 }])).toBe(20);
  });

  it("sums every model's rows", () => {
    expect(
      spendUsd([
        { modelId: CV_EXTRACTION_MODEL, tokensIn: 3_120, tokensOut: 604 },
        { modelId: CV_EXTRACTION_MODEL, tokensIn: 10_000, tokensOut: 1_000 },
      ]),
    ).toBe(0.08456);
  });

  it("is zero with no token rows", () => {
    expect(spendUsd([])).toBe(0);
  });

  it("prices an unknown model at the dearest known rates, never skips it", () => {
    const prices = {
      cheap: { inputPerMillion: 1, outputPerMillion: 30 },
      dear: { inputPerMillion: 5, outputPerMillion: 10 },
    };
    expect(spendUsd([{ modelId: "unpriced-model", tokensIn: 1_000_000, tokensOut: 1_000_000 }], prices)).toBe(35);
    expect(spendUsd([{ modelId: null, tokensIn: 1_000_000, tokensOut: 0 }], prices)).toBe(5);
  });
});
