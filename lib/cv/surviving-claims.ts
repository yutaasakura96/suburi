import { readClaims, type ValidatedClaim } from "./reading";
import { createSpanChecker, normaliseClaimText, type RejectionReason, type Span } from "./spans";
import type { WindowResult } from "./windowed-extraction";

/**
 * Every extracted claim is located in its document and then validated. A claim that fails either is
 * dropped and counted, never clamped — that is the anti-hallucination guard, and it answers only
 * whether the quote is really in the stored text.
 *
 * **A claim must also lie inside the window its call was given** (#29). One that is in the document
 * but outside its window — another document, or another window of the same one — is dropped and
 * counted in `quotesOutsideWindow`. Never kept: the window that holds that text returns its own claims
 * from it, so keeping a stray one could store the same assertion from two places, which is the
 * duplication the window's ownership rule exists to prevent. It is checked after the verbatim check,
 * so a quote that is not in the text at all is still a `spans_rejected`, whichever window returned it.
 *
 * What survives goes to `readClaims`, which drops the repeats and measures **how the model read**
 * (`reading.ts`, #27). Both sets of numbers are reported, and
 * `spans_checked === claims.total + spans_rejected + claims_duplicated`; a quote outside its window is
 * not checked, so every returned claim is `spans_checked + quotes_outside_window`.
 */
export function survivingClaims(body: string, ranges: readonly Span[], results: readonly WindowResult[]) {
  const checker = createSpanChecker(body, ranges);
  const validated: ValidatedClaim[] = [];
  const rejected: Partial<Record<RejectionReason | "not_found", number>> = {};
  let quotesOutsideWindow = 0;

  const reject = (reason: RejectionReason | "not_found") => {
    rejected[reason] = (rejected[reason] ?? 0) + 1;
  };

  for (const { window, claims } of results) {
    for (const claim of claims) {
      if (!checker.locate(claim.document, claim.quote, claim.start_hint)) {
        reject("not_found");
        continue;
      }
      const span =
        claim.document === window.document ? checker.locate(claim.document, claim.quote, claim.start_hint, window) : null;
      if (!span) {
        quotesOutsideWindow += 1;
        continue;
      }
      const verdict = checker.validate(span, claim.quote);
      if (!verdict.ok) {
        reject(verdict.reason);
        continue;
      }
      validated.push({ span, textNormalised: normaliseClaimText(verdict.quote) });
    }
  }

  const spansRejected = Object.values(rejected).reduce((sum, n) => sum + n, 0);
  const reading = readClaims(body, ranges, validated);
  return {
    ...reading,
    spansChecked: validated.length + spansRejected,
    spansRejected,
    rejected,
    quotesOutsideWindow,
  };
}
