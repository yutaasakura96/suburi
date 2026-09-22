import { sliceQuote, type Span } from "./spans.ts";

export interface RequestedDocument {
  readonly kind: string;
  readonly title: string | null;
  readonly text: string;
}

export interface StoredDocument extends Span {
  readonly kind: string;
  readonly title: string | null;
}

/**
 * `cv_unchanged` (07 §5.2): every requested document matches the stored version's on kind, title and
 * text, index by index. Order is refused rather than sorted at the boundary (06, #15), so a plain
 * positional comparison is the whole rule. Text is compared exactly — a whitespace edit is an edit.
 * `stored` must be in `position` order.
 */
export function isUnchanged(body: string, stored: readonly StoredDocument[], requested: readonly RequestedDocument[]) {
  if (stored.length !== requested.length) return false;
  return requested.every((document, index) => {
    const previous = stored[index];
    return (
      document.kind === previous.kind &&
      document.title === previous.title &&
      document.text === sliceQuote(body, previous)
    );
  });
}
