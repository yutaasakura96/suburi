export interface PreviousClaim {
  readonly id: string;
  readonly textNormalised: string;
  readonly spanStart: number;
}

/**
 * 04's carry-forward rule and nothing more: each new claim's `supersedes_claim_id` is the claim in the
 * immediately previous version whose `text_normalised` is byte-identical, from any document; `null`
 * otherwise. No fuzzy match. A tie goes to the lowest `span_start`, and several new claims may point
 * at one previous claim (06, #16).
 */
export function carryForward(previous: readonly PreviousClaim[], fresh: readonly string[]) {
  const byText = new Map<string, PreviousClaim>();
  for (const claim of previous) {
    const held = byText.get(claim.textNormalised);
    if (!held || claim.spanStart < held.spanStart) byText.set(claim.textNormalised, claim);
  }
  return fresh.map((text) => byText.get(text)?.id ?? null);
}
