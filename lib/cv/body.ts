import { characterLength, type Span } from "./spans.ts";

/**
 * The fixed separator between documents in `cv_versions.body` (04). Never changed: every stored
 * `cv_documents.start/end` and claim span was computed with it.
 */
export const DOCUMENT_SEPARATOR = "\n\n";

/**
 * Builds a version's immutable body from its documents' texts, in `position` order, and the
 * `[start, end)` range each occupies, in characters (`lib/cv/spans.ts`). Text is kept exactly as
 * the user saved it — no trimming, no line-ending rewrite — so what is quoted is what they wrote.
 */
export function assembleBody(texts: readonly string[]) {
  const ranges: Span[] = [];
  let offset = 0;
  for (const text of texts) {
    const length = characterLength(text);
    ranges.push({ start: offset, end: offset + length });
    offset += length + characterLength(DOCUMENT_SEPARATOR);
  }
  return { body: texts.join(DOCUMENT_SEPARATOR), ranges };
}
