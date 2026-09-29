import { MODEL_PRICES } from "../ai/models";

// Relative imports: the integration tests load this file outside Next's path aliases.

/** One model's stored token pairs, summed over a window. */
export interface TokenTotals {
  /** Null only on a row with tokens but no model stamp, which should not exist. */
  readonly modelId: string | null;
  readonly tokensIn: number;
  readonly tokensOut: number;
}

type Price = { readonly inputPerMillion: number; readonly outputPerMillion: number };

/** US dollars, to the micro-dollar. */
export function spendUsd(totals: readonly TokenTotals[], prices: Readonly<Record<string, Price>> = MODEL_PRICES) {
  const unpricedModelIds = new Set<string | null>();
  const usd = totals.reduce((sum, { modelId, tokensIn, tokensOut }) => {
    const price = modelId !== null && Object.hasOwn(prices, modelId) ? prices[modelId] : undefined;
    if (!price) {
      unpricedModelIds.add(modelId);
      return sum;
    }
    return sum + (tokensIn * price.inputPerMillion + tokensOut * price.outputPerMillion) / 1_000_000;
  }, 0);
  return {
    usd: Math.round(usd * 1_000_000) / 1_000_000,
    unpricedModelIds: [...unpricedModelIds].sort((a, b) => (a ?? "").localeCompare(b ?? "")),
  };
}
