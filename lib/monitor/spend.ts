import { MODEL_PRICES } from "../ai/models";

// Relative imports: the integration tests load this file outside Next's path aliases.

/** One model's stored token pairs, summed over a window. */
export interface TokenTotals {
  /** Null only on a row with tokens but no model stamp, which should not exist; priced as unknown. */
  readonly modelId: string | null;
  readonly tokensIn: number;
  readonly tokensOut: number;
}

type Price = { readonly inputPerMillion: number; readonly outputPerMillion: number };

/**
 * A model with no price is priced at the dearest known rates rather than skipped, so a new model
 * string can only make spend read high, never hide it (06, #55).
 */
function dearest(prices: Readonly<Record<string, Price>>): Price {
  const all = Object.values(prices);
  return {
    inputPerMillion: Math.max(...all.map((price) => price.inputPerMillion)),
    outputPerMillion: Math.max(...all.map((price) => price.outputPerMillion)),
  };
}

/** US dollars, to the micro-dollar. */
export function spendUsd(totals: readonly TokenTotals[], prices: Readonly<Record<string, Price>> = MODEL_PRICES): number {
  const unknown = dearest(prices);
  const usd = totals.reduce((sum, { modelId, tokensIn, tokensOut }) => {
    const price = (modelId !== null && prices[modelId]) || unknown;
    return sum + (tokensIn * price.inputPerMillion + tokensOut * price.outputPerMillion) / 1_000_000;
  }, 0);
  return Math.round(usd * 1_000_000) / 1_000_000;
}
