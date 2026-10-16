import { ModelCallFailed } from "./upstream.ts";

// The English a Japanese generating call writes beside its Japanese (06, 2026-10-14, Q106-4): a
// question's, by `generate-{round type}-ja-1.1`, and a follow-up's, by `follow-up-ja-1.1`. **A missing
// or malformed English drops the English, never the question or the follow-up**: what it cost is a
// reading aid, so it adds no failure path to the round. A drop is logged as a count and one of these
// classes, never the text (12 §7).

/** Why an English was dropped: none came back, or what came back failed its check. */
export type EnglishDrop = "english_missing" | "english_malformed";

export type CheckedEnglish =
  | { readonly english: string; readonly englishDropped: null }
  | { readonly english: null; readonly englishDropped: EnglishDrop };

/**
 * The English trimmed, or dropped with its class: null or blank is missing, and anything `accept`
 * refuses with `ModelCallFailed` is malformed.
 */
export function checkEnglish(raw: string | null | undefined, accept: (english: string) => string): CheckedEnglish {
  const trimmed = raw?.trim() ?? "";
  if (trimmed === "") return { english: null, englishDropped: "english_missing" };
  try {
    return { english: accept(trimmed), englishDropped: null };
  } catch (error) {
    if (!(error instanceof ModelCallFailed)) throw error;
    return { english: null, englishDropped: "english_malformed" };
  }
}

/** How many of each class were dropped: what the drop's log line carries. */
export function countDrops(checked: readonly { readonly englishDropped: EnglishDrop | null }[]) {
  const drops: Record<EnglishDrop, number> = { english_missing: 0, english_malformed: 0 };
  for (const { englishDropped } of checked) if (englishDropped) drops[englishDropped] += 1;
  return drops;
}
