import type { CitationRelation, ModelCitation, ModelUnsupported } from "../ai/score";
import { characterLength, createSpanChecker, normaliseClaimText, sliceQuote, type Span } from "../cv/spans";

/**
 * CV grounding (US-11): what the scorer and the feedback call say about the CV and the answer is
 * **checked against stored text before anything is written** (03 §11). A model never supplies a quote
 * or an id that is stored: it is shown numbered claims and returns numbers, and it returns a verbatim
 * quote of the answer that the server then finds.
 *
 * **Dropped, never clamped** — and counted, so a scorer that starts inventing shows up in the logs.
 */

export interface StoredClaim {
  readonly id: string;
  readonly start: number;
  readonly end: number;
  readonly textNormalised: string;
}

/** A claim as a model is shown it: its text sliced from `cv_versions.body` by span. */
export interface CitableClaim {
  readonly id: string;
  readonly text: string;
}

/**
 * The claims of a CV version that may be cited (07 §5.10): each stored span is validated against the
 * body again, and its slice must still be the claim. A claim that fails is not shown to the scorer, so
 * nothing can cite it.
 */
export function citableClaims(body: string, documents: readonly Span[], claims: readonly StoredClaim[]) {
  const checker = createSpanChecker(body, documents);
  const citable: CitableClaim[] = [];
  let rejected = 0;
  for (const claim of claims) {
    const span = { start: claim.start, end: claim.end };
    const verdict = checker.validate(span, sliceQuote(body, span));
    if (verdict.ok && normaliseClaimText(verdict.quote) === claim.textNormalised) citable.push({ id: claim.id, text: verdict.quote });
    else rejected += 1;
  }
  return { claims: citable, rejected };
}

/** The number a model is shown for a claim is its place in the list, from 1. Anything else names nothing. */
function claimAt<T>(claims: readonly T[], number: number): T | undefined {
  return Number.isInteger(number) ? claims[number - 1] : undefined;
}

/** `claim_citations` rows from the scorer's numbered citations; a number that names no shown claim is dropped. */
export function resolveCitations(claims: readonly CitableClaim[], citations: readonly ModelCitation[]) {
  const rows = new Map<string, { cvClaimId: string; relation: CitationRelation }>();
  let dropped = 0;
  for (const citation of citations) {
    const claim = claimAt(claims, citation.claim);
    if (!claim) dropped += 1;
    else rows.set(`${claim.id} ${citation.relation}`, { cvClaimId: claim.id, relation: citation.relation });
  }
  return { citations: [...rows.values()], dropped };
}

/** The span validator bound to one answer's corrected text: one document, the whole of it. */
export function answerSpanChecker(corrected: string) {
  return createSpanChecker(corrected, [{ start: 0, end: characterLength(corrected) }]);
}

/**
 * `answer_flags` spans from the scorer's quotes (04, 11 §3.12). The quote must be in
 * `transcript_corrected` verbatim — the hint only chooses between occurrences — and the span it is
 * found at must pass the same validator a CV span does.
 */
export function locateUnsupported(corrected: string, quotes: readonly ModelUnsupported[]) {
  const checker = answerSpanChecker(corrected);
  const spans = new Map<string, Span>();
  let dropped = 0;
  for (const { quote, startHint } of quotes) {
    const span = checker.locate(0, quote, startHint);
    if (span && checker.validate(span, quote).ok) spans.set(`${span.start} ${span.end}`, span);
    else dropped += 1;
  }
  return { spans: [...spans.values()].sort((a, b) => a.start - b.start), dropped };
}

/** `round_feedback.untouched_claim_ids` holds at most this many (04). */
export const MAX_UNTOUCHED = 3;

/**
 * Untouched material from the feedback call's picks (04 `round_feedback`): each must name a claim of
 * the never-cited set it was shown, and at most three are kept.
 */
export function pickUntouched(neverCited: readonly CitableClaim[], picks: readonly number[]) {
  const ids: string[] = [];
  let dropped = 0;
  for (const pick of picks) {
    const claim = claimAt(neverCited, pick);
    if (!claim) dropped += 1;
    else if (ids.includes(claim.id)) continue;
    else if (ids.length === MAX_UNTOUCHED) dropped += 1;
    else ids.push(claim.id);
  }
  return { ids, dropped };
}
