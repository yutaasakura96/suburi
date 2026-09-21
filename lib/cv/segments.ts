import type { Span } from "./spans";

export interface Segment {
  readonly text: string;
  readonly claim: boolean;
}

/**
 * One document's text as plain and underlined runs, for the CV screen (10 §13). Every run is sliced
 * from the stored body by character, never taken from model output. Spans outside the document are
 * ignored — at save time none can cross a boundary — and overlapping spans underline as one run.
 */
export function underlineSegments(body: string, document: Span, spans: readonly Span[]): Segment[] {
  const characters = Array.from(body).slice(document.start, document.end);
  const underlined = new Array<boolean>(characters.length).fill(false);
  for (const span of spans) {
    if (span.start < document.start || span.end > document.end) continue;
    underlined.fill(true, span.start - document.start, span.end - document.start);
  }

  const segments: Segment[] = [];
  characters.forEach((character, index) => {
    const last = segments.at(-1);
    if (last && last.claim === underlined[index]) {
      segments[segments.length - 1] = { text: last.text + character, claim: last.claim };
    } else {
      segments.push({ text: character, claim: underlined[index] });
    }
  });
  return segments;
}
