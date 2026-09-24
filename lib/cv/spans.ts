/**
 * Spans, the span validator and quote slicing — the anti-hallucination mechanism (03 §11, 04).
 *
 * **A character is a Unicode code point.** The rendered quote is Postgres
 * `substring(cv_versions.body, span_start, span_end - span_start)`, which counts code points, so every
 * index here does too. JavaScript's own string indices are UTF-16 units and would shift every quote
 * after the first surrogate pair (𠮷, most emoji) by one.
 *
 * **Dropped, never clamped.** A span that fails any rule is reported with its reason and never
 * adjusted to fit. The caller counts it in `spans_rejected` and stores nothing.
 */

export interface Span {
  readonly start: number;
  readonly end: number;
}

export type RejectionReason =
  | "out_of_range"
  | "inverted"
  | "empty"
  | "mismatch"
  | "splits_grapheme"
  | "crosses_document";

export type SpanVerdict =
  | { readonly ok: true; readonly quote: string }
  | { readonly ok: false; readonly reason: RejectionReason };

function codePoints(text: string) {
  return Array.from(text);
}

export function characterLength(text: string) {
  return codePoints(text).length;
}

export function sliceQuote(body: string, span: Span) {
  return codePoints(body).slice(span.start, span.end).join("");
}

/**
 * The same-claim key (04 `cv_claims.text_normalised`), which carry-forward and `claims_duplicated`
 * both compare: NFKC, so `４０％` and `40%` are one claim, then whitespace runs collapsed. Case is kept
 * (06, #28). Deliberately more forgiving than `validate`, which decides whether a quote is real and
 * stays byte-exact. `db/migrations/0004_claim-text-nfkc.sql` is this function in SQL; they change
 * together.
 */
export function normaliseClaimText(text: string) {
  return text.normalize("NFKC").replace(/\s+/gu, " ").trim();
}

// Code-point indices at which a grapheme cluster starts, plus the end of the text.
function graphemeBoundaries(text: string) {
  const boundaries = new Set<number>();
  let index = 0;
  for (const { segment } of new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(
    text,
  )) {
    boundaries.add(index);
    index += characterLength(segment);
  }
  boundaries.add(index);
  return boundaries;
}

/**
 * Bound to one body and its document ranges, so the grapheme boundaries are computed once per CV
 * version rather than once per claim.
 */
export function createSpanChecker(body: string, documents: readonly Span[]) {
  const characters = codePoints(body);
  const boundaries = graphemeBoundaries(body);

  function validate(span: Span, claimedText: string): SpanVerdict {
    const { start, end } = span;
    if (!Number.isInteger(start) || !Number.isInteger(end)) return reject("out_of_range");
    if (start < 0 || end > characters.length) return reject("out_of_range");
    if (start > end) return reject("inverted");
    if (start === end) return reject("empty");
    if (!boundaries.has(start) || !boundaries.has(end)) return reject("splits_grapheme");
    if (!documents.some((document) => document.start <= start && end <= document.end)) {
      return reject("crosses_document");
    }
    const quote = characters.slice(start, end).join("");
    if (quote !== claimedText) return reject("mismatch");
    return { ok: true, quote };
  }

  /**
   * Where a verbatim quote sits in one document. The extractor returns the quote and an approximate
   * start (06, 2026-09-21): models count characters poorly, so the server finds every exact
   * occurrence and takes the one nearest the hint. The hint chooses between occurrences; it never
   * moves one. A quote that is not in the document verbatim has no span.
   */
  function locate(documentIndex: number, quote: string, hint: number): Span | null {
    const document = documents[documentIndex];
    if (!document || quote === "") return null;

    const text = characters.slice(document.start, document.end).join("");
    const length = characterLength(quote);
    let best: number | null = null;
    for (let unit = text.indexOf(quote); unit !== -1; unit = text.indexOf(quote, unit + 1)) {
      const offset = characterLength(text.slice(0, unit));
      if (best === null || Math.abs(offset - hint) < Math.abs(best - hint)) best = offset;
    }
    if (best === null) return null;
    return { start: document.start + best, end: document.start + best + length };
  }

  return { validate, locate };
}

function reject(reason: RejectionReason): SpanVerdict {
  return { ok: false, reason };
}
