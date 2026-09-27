import { characterLength } from "./spans";

/**
 * Where a set's documents are cut into **windows** for extraction (#29). Every extraction call reads
 * the whole set and returns claims from one window only, so a window is a unit of *output*, not of
 * input: it bounds how much one call has to write, which is what the late sections of a long CV were
 * losing to (06, 2026-09-27).
 *
 * A window is one contiguous `[start, end)` of one document, in code points from the start of that
 * document's text — the unit of `start_hint` and of every span (`spans.ts`). **A window never crosses
 * a document**, and one document's windows cover it exactly, end to end, so no character belongs to
 * no call and none to two.
 *
 * **Cut at blank lines, falling back to line breaks.** A blank line is the paragraph boundary — the
 * `.docx` importer ends every paragraph with one (`import/text.ts`) — and across every measured reading
 * no claim crossed one. Pasted and PDF text often has no blank lines, so a paragraph longer than the
 * target is cut at its line breaks instead. A single line is never cut: a sentence would straddle it.
 *
 * Pure, and deterministic in its input, so the same set always gets the same windows.
 */

export interface ExtractionWindow {
  /** The document's index in the set, as the model is sent it. */
  readonly document: number;
  readonly start: number;
  readonly end: number;
}

/**
 * The size a window is packed up to, in code points. The measured windows that read at sentence level
 * were 1,010–5,907 (#29, synthetic sets). One number for both languages: a window is sized by the
 * text around the claims, and the densest measured one — a whole 3,014-character 職務経歴書 — read
 * cleanly. Like `limits.ts`, it is a measurement to redo, not a number to edit.
 */
export const WINDOW_TARGET_CHARS = 4_000;

/** A last window shorter than this share of the target joins the one before it. */
const SHORT_TAIL_SHARE = 0.25;

const BLANK = /^\s*$/u;

/**
 * The offsets at which a new unit may start, strictly inside the text: after every line break
 * (`lines`), and at the first non-blank line after a run of blank ones (`paragraphs`).
 */
function boundaries(text: string) {
  const lines: number[] = [];
  const paragraphs: number[] = [];
  let offset = 0;
  text.split("\n").forEach((line, index, all) => {
    if (index > 0) {
      lines.push(offset);
      if (BLANK.test(all[index - 1]) && !BLANK.test(line)) paragraphs.push(offset);
    }
    offset += characterLength(line) + 1;
  });
  return { lines, paragraphs };
}

/** `[start, end)` cut at each boundary strictly inside it. */
function cut(start: number, end: number, at: readonly number[]) {
  const inside = at.filter((offset) => start < offset && offset < end);
  return [start, ...inside].map((from, index) => ({ start: from, end: inside[index] ?? end }));
}

/** One document's windows, as `[start, end)` pairs covering `[0, length)`. */
function planDocument(text: string, target: number) {
  const length = characterLength(text);
  if (length <= target) return [{ start: 0, end: length }];

  const { lines, paragraphs } = boundaries(text);
  const units = cut(0, length, paragraphs).flatMap((paragraph) =>
    paragraph.end - paragraph.start > target ? cut(paragraph.start, paragraph.end, lines) : [paragraph],
  );

  const windows: { start: number; end: number }[] = [];
  for (const unit of units) {
    const open = windows.at(-1);
    if (open && unit.end - open.start <= target) open.end = unit.end;
    else windows.push({ ...unit });
  }

  const tail = windows.at(-1)!;
  if (windows.length > 1 && tail.end - tail.start < target * SHORT_TAIL_SHARE) {
    windows.pop();
    windows[windows.length - 1].end = tail.end;
  }
  return windows;
}

/** Every document's windows, in document order and then text order. */
export function planWindows(texts: readonly string[], target = WINDOW_TARGET_CHARS): ExtractionWindow[] {
  return texts.flatMap((text, document) => planDocument(text, target).map((window) => ({ document, ...window })));
}
