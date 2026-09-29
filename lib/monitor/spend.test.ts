import { describe, expect, it } from "vitest";
import { CV_EXTRACTION_MODEL, MODEL_PRICES } from "../ai/models";
import { spendUsd } from "./spend";

describe("spendUsd", () => {
  it("prices the pinned model at its verified rates: $4.00 in, $20.00 out per million", () => {
    expect(MODEL_PRICES[CV_EXTRACTION_MODEL]).toEqual({ inputPerMillion: 4, outputPerMillion: 20 });
    expect(spendUsd([{ modelId: CV_EXTRACTION_MODEL, tokensIn: 1_000_000, tokensOut: 0 }])).toEqual({ usd: 4, unpricedModelIds: [] });
    expect(spendUsd([{ modelId: CV_EXTRACTION_MODEL, tokensIn: 0, tokensOut: 1_000_000 }])).toEqual({ usd: 20, unpricedModelIds: [] });
  });

  it("sums every model's rows", () => {
    expect(
      spendUsd([
        { modelId: CV_EXTRACTION_MODEL, tokensIn: 3_120, tokensOut: 604 },
        { modelId: CV_EXTRACTION_MODEL, tokensIn: 10_000, tokensOut: 1_000 },
      ]),
    ).toEqual({ usd: 0.08456, unpricedModelIds: [] });
  });

  it("is zero with no token rows", () => {
    expect(spendUsd([])).toEqual({ usd: 0, unpricedModelIds: [] });
  });

  it("names unpriced and missing model ids while retaining priced spend", () => {
    const prices = {
      cheap: { inputPerMillion: 1, outputPerMillion: 30 },
      dear: { inputPerMillion: 5, outputPerMillion: 10 },
    };
    expect(spendUsd([
      { modelId: "cheap", tokensIn: 1_000_000, tokensOut: 0 },
      { modelId: "unpriced-model", tokensIn: 1_000_000, tokensOut: 1_000_000 },
      { modelId: "__proto__", tokensIn: 1_000_000, tokensOut: 0 },
      { modelId: null, tokensIn: 1_000_000, tokensOut: 0 },
    ], prices)).toEqual({ usd: 1, unpricedModelIds: [null, "__proto__", "unpriced-model"] });
  });
});
