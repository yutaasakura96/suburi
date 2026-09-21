// The CV screen's chrome, both languages (10 §13). A plain module, not the client panel's, so the
// Server Component can use `documentHeading` too.

import type { CvLanguage } from "@/lib/ai/extract-cv-claims";

export type { CvLanguage };
export type Kind = "rirekisho" | "shokumu_keirekisho" | "cv" | "additional";

export interface SaveResult {
  readonly total: number;
  readonly carriedForward: number;
  readonly fresh: number;
  readonly rejected: number;
}

/** Each language's required kind, first in its set (04). */
export const REQUIRED_KIND = { ja: "rirekisho", en: "cv" } as const satisfies Record<CvLanguage, Kind>;

// Only the kinds a language's set may hold, so no language's copy carries another's kind names.
type Kinds = Partial<Record<Kind, string>>;

/**
 * Each panel's chrome in its own language (10 §13) — and that settles the bilingual chrome rule for
 * this screen only (CONTEXT.md). **Every Japanese string here is proposed until its native read
 * (#20).** 10 §13's own strings are applied with #13's rules (05 §6): `バージョン`, never `版`, and
 * `記載事項` for Claim, never `主張`. The ones 10 §13 does not give — `外す`, `資料名`, `本文`, the
 * saving caption and the dropped count in the result line — are listed in #15's PR for that read.
 */
export const COPY = {
  ja: {
    heading: "応募書類",
    start: "応募書類を追加する",
    requires: "履歴書が1通必要です。職務経歴書と、補足資料を5つまで追加できます。",
    kinds: { rirekisho: "履歴書", shokumu_keirekisho: "職務経歴書", additional: "補足資料" } as Kinds,
    particulars: "生年月日・住所・電話番号・顔写真・家族の情報は省いてかまいません。評価には使いません。",
    addShokumu: "職務経歴書を追加",
    addAdditional: "補足資料を追加",
    title: "資料名",
    text: "本文",
    remove: "外す",
    save: "このバージョンを保存する",
    commits: "保存すると、この内容でバージョンが確定します。あとから直すことはできません。",
    saving: "記載事項を抽出しています。しばらくかかることがあります。",
    claims: (n: number) => `記載事項 ${n}件`,
    result: (r: SaveResult) =>
      `${r.total}件を抽出。${r.carriedForward}件は前のバージョンから引き継ぎ、${r.fresh}件が新規。${r.rejected}件を除外。`,
    dropped: (n: number) => `${n}件は本文と一致しなかったため除きました。`,
  },
  en: {
    heading: "CV",
    start: "Add your CV",
    requires: "One CV document is required. You can add up to five supporting documents.",
    kinds: { cv: "CV", additional: "Supporting document" } as Kinds,
    particulars: null,
    addShokumu: null,
    addAdditional: "Add a supporting document",
    title: "Title",
    text: "Text",
    remove: "Remove",
    save: "Save this version",
    commits: "Saving fixes this version as it is. It cannot be edited afterwards.",
    saving: "Extracting claims from your CV. This can take a while.",
    claims: (n: number) => `${n} ${n === 1 ? "claim" : "claims"}`,
    result: (r: SaveResult) =>
      `${r.total} ${r.total === 1 ? "claim" : "claims"} extracted — ${r.carriedForward} carried forward, ${r.fresh} new. ${r.rejected} dropped.`,
    dropped: (n: number) =>
      `${n} ${n === 1 ? "claim was" : "claims were"} dropped — their quotes did not match your text.`,
  },
} as const;

export type Copy = (typeof COPY)[CvLanguage];

/** The documents' own heading: the kind, or the user's title for an additional document (10 §13). */
export function documentHeading(language: CvLanguage, kind: Kind, title: string | null) {
  return kind === "additional" ? (title ?? "") : (COPY[language].kinds[kind] ?? "");
}
