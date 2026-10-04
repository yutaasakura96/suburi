import type { Span } from "./spans";

export interface Segment {
  readonly text: string;
  readonly claim: boolean;
  /** Coverage (10 §13): inside a claim that has been cited. Never true outside a claim. */
  readonly used: boolean;
}

/** A claim's span, and whether the claim has ever been cited (`lib/cv/coverage.ts`). */
export interface ClaimSpan extends Span {
  readonly used?: boolean;
}

/**
 * One document's text as plain and underlined runs, for the CV screen (10 §13). Every run is sliced
 * from the stored body by character, never taken from model output. Spans outside the document are
 * ignored — at save time none can cross a boundary — and overlapping spans underline as one run. A
 * run changes where coverage does, and where a used claim overlaps an unused one the text reads as
 * used.
 */
export function underlineSegments(body: string, document: Span, spans: readonly ClaimSpan[]): Segment[] {
  const characters = Array.from(body).slice(document.start, document.end);
  const underlined = new Array<boolean>(characters.length).fill(false);
  const used = new Array<boolean>(characters.length).fill(false);
  for (const span of spans) {
    if (span.start < document.start || span.end > document.end) continue;
    underlined.fill(true, span.start - document.start, span.end - document.start);
    if (span.used) used.fill(true, span.start - document.start, span.end - document.start);
  }

  const segments: Segment[] = [];
  characters.forEach((character, index) => {
    const last = segments.at(-1);
    if (last && last.claim === underlined[index] && last.used === used[index]) {
      segments[segments.length - 1] = { ...last, text: last.text + character };
    } else {
      segments.push({ text: character, claim: underlined[index], used: used[index] });
    }
  });
  return segments;
}
