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
 *
 * Both of those still matter, for opposite reasons. Since #27 a version holds one claim per
 * normalised text, so the many-to-one case cannot arise from a version saved after it — but every
 * version saved before it can hold the same assertion twice, which is exactly when the tie-break
 * decides which previous claim a new one inherits from.
 */
export function carryForward(previous: readonly PreviousClaim[], fresh: readonly string[]) {
  const byText = new Map<string, PreviousClaim>();
  for (const claim of previous) {
    const held = byText.get(claim.textNormalised);
    if (!held || claim.spanStart < held.spanStart) byText.set(claim.textNormalised, claim);
  }
  return fresh.map((text) => byText.get(text)?.id ?? null);
}
