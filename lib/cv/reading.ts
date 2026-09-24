import type { Span } from "./spans";

/**
 * How well the model **read** the CV, as three counters over the claims that survived span
 * validation (#27).
 *
 * `spans_rejected` cannot answer this. It is the anti-hallucination guard — it fires when a quote is
 * not in the stored text — and the real 応募書類 and CV reported **0** while a quarter of the English
 * CV went unread, one sentence was cut into five uncitable fragments, and seventeen certification
 * lines were extracted twice. Every defect measured on 2026-09-23 slices back verbatim, so every one
 * of them is invisible to a guard that only asks whether the quote is real.
 *
 * These three are geometry over the surviving spans, so they cost nothing and cannot themselves
 * hallucinate. **None of them refuses a save** (07 §5.2): a bad reading is the model's judgement,
 * not a violated invariant, and there is no edit the user could make that would clear it. They are
 * logged, returned, and alerted on (12 §6).
 */

export interface ValidatedClaim {
  readonly span: Span;
  readonly textNormalised: string;
}

export interface Reading {
  /** The claims to store: one per distinct normalised text, in the order they appear in the body. */
  readonly claims: readonly ValidatedClaim[];
  /** Claims that abut another claim on the same line — the fragmentation signal. */
  readonly claimsSplit: number;
  /** Claims dropped for repeating a claim this version already carries. */
  readonly claimsDuplicated: number;
  /** The longest stretch of one document, in code points, that no claim covers. */
  readonly unclaimedRunMax: number;
}

/**
 * Two claims are one sentence cut in half when three things hold at once: nothing but punctuation
 * and spaces separates them, no line break does, and **no sentence ends between them**.
 *
 * Each condition rules out a reading that is fine. The line break keeps a 学歴・職歴 table and a
 * bullet list — rows of whole claims, one per line — from firing the signal the whole counter exists
 * to make trustworthy. The sentence boundary does the same for prose: a .docx paragraph is one line,
 * so two finished sentences of a 職務要約 sit on the same line with 「。」 between them, and without
 * this condition the counter called every one of them a fragment. A 連用形 or participial hinge
 * carries neither a newline nor a 。 — which is exactly what is left.
 */
const NOTHING_BUT_PUNCTUATION = /^[^\p{L}\p{N}\n]*$/u;
const SENTENCE_END = /[。．.！!？?]/u;

export function readClaims(
  body: string,
  documents: readonly Span[],
  validated: readonly ValidatedClaim[],
): Reading {
  const characters = Array.from(body);

  // The model returning the same assertion twice — from a 履歴書's 免許・資格 table and again from
  // the 職務経歴書's list of the same qualifications — is one claim, counted once. Carry-forward and
  // coverage both key on the normalised text, so a second row would double-count the same material.
  const kept = new Map<string, ValidatedClaim>();
  let claimsDuplicated = 0;
  for (const claim of validated) {
    if (kept.has(claim.textNormalised)) {
      claimsDuplicated += 1;
      continue;
    }
    kept.set(claim.textNormalised, claim);
  }
  const claims = [...kept.values()].sort((a, b) => a.span.start - b.span.start);

  const documentOf = (span: Span) =>
    documents.findIndex((document) => document.start <= span.start && span.end <= document.end);

  const split = new Set<number>();
  for (let index = 1; index < claims.length; index += 1) {
    const before = claims[index - 1].span;
    const after = claims[index].span;
    const document = documentOf(before);
    if (document === -1 || document !== documentOf(after)) continue;
    // Overlapping spans are one assertion read twice, whatever punctuation surrounds them.
    if (after.start < before.end) {
      split.add(index - 1).add(index);
      continue;
    }
    const gap = characters.slice(before.end, after.start).join("");
    if (!NOTHING_BUT_PUNCTUATION.test(gap)) continue;
    // The earlier claim finished its sentence, so the later one starts a new assertion rather than
    // continuing a cut one.
    if (SENTENCE_END.test(gap) || SENTENCE_END.test(characters[before.end - 1] ?? "")) continue;
    split.add(index - 1).add(index);
  }

  let unclaimedRunMax = 0;
  for (const document of documents) {
    let cursor = document.start;
    for (const { span } of claims) {
      if (span.start < document.start || span.end > document.end) continue;
      unclaimedRunMax = Math.max(unclaimedRunMax, span.start - cursor);
      cursor = Math.max(cursor, span.end);
    }
    unclaimedRunMax = Math.max(unclaimedRunMax, document.end - cursor);
  }

  return { claims, claimsSplit: split.size, claimsDuplicated, unclaimedRunMax };
}
