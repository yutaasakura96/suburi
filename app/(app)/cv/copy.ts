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
 * this screen only (CONTEXT.md). 10 §13's own strings are applied with #13's rules (05 §6):
 * `バージョン`, never `版`, and `記載事項` for Claim, never `主張`.
 *
 * **Every Japanese string here had an AI review on 2026-09-27, not a native read** — the user does
 * not read Japanese and delegated it (`docs/checklists/native-read-cv.md`, 06). All were accepted as
 * written, six of them as amended by the 2026-09-24 draft. **`coverage` and `coverageLegend` came
 * later, with #46, and are unread** (`docs/checklists/native-read-round-loop.md`).
 */
export const COPY = {
  ja: {
    heading: "応募書類",
    start: "応募書類を登録する",
    newVersion: "新しいバージョンをつくる",
    requires: "履歴書が1通必要です。ほかに職務経歴書を1通と、補足資料を5つまで追加できます。",
    kinds: { rirekisho: "履歴書", shokumu_keirekisho: "職務経歴書", additional: "補足資料" } as Kinds,
    particulars: "生年月日・住所・電話番号・顔写真・家族の情報は省いてかまいません。評価には使いません。",
    addShokumu: "職務経歴書を追加",
    addAdditional: "補足資料を追加",
    title: "資料名",
    text: "本文",
    remove: "外す",
    importFile: "ファイルから読み込む",
    imported: "読み込んだ本文を確認して、必要なら直してください。保存した本文がそのまま評価に使われます。",
    importNoText:
      "このファイルからは文字を読み取れませんでした。スキャンした画像には文字情報がないため、本文を貼り付けてください。",
    importUnreadable:
      "このファイルは開けませんでした。破損しているか、パスワードで保護されている可能性があります。本文を貼り付けてください。",
    save: "このバージョンを保存する",
    commits: "保存すると、この内容でバージョンが確定します。あとから直すことはできません。",
    saving: "記載事項を抽出しています。しばらくかかることがあります。",
    claims: (n: number) => `記載事項 ${n}件`,
    // Coverage (10 §13): the version's count, and how many of them no answer has ever cited.
    coverage: (n: number, unused: number) => `記載事項 ${n}件・未使用 ${unused}件`,
    coverageLegend: "太い下線は、これまでの回答で使った記載事項です。",
    result: (r: SaveResult) =>
      `${r.total}件を抽出しました。うち${r.carriedForward}件は前のバージョンから引き継ぎ、${r.fresh}件が新規です。除外は${r.rejected}件でした。`,
    dropped: (n: number) => `${n}件は本文と一致しなかったため除きました。`,
    savableAt: (clock: string) => `${clock}から保存できます。`,
  },
  en: {
    heading: "CV",
    start: "Add your CV",
    newVersion: "Create a new version",
    requires: "One CV document is required. You can add up to five supporting documents.",
    kinds: { cv: "CV", additional: "Supporting document" } as Kinds,
    particulars: null,
    addShokumu: null,
    addAdditional: "Add a supporting document",
    title: "Title",
    text: "Text",
    remove: "Remove",
    importFile: "Import from a file",
    imported: "Check the imported text and fix anything wrong. What you save is what gets scored.",
    importNoText: "No text could be read from this file. A scanned file has none — paste the text instead.",
    importUnreadable:
      "This file could not be opened. It may be damaged or password-protected — paste the text instead.",
    save: "Save this version",
    commits: "Saving fixes this version as it is. It cannot be edited afterwards.",
    saving: "Extracting claims from your CV. This can take a while.",
    claims: (n: number) => `${n} ${n === 1 ? "claim" : "claims"}`,
    coverage: (n: number, unused: number) => `${n} ${n === 1 ? "claim" : "claims"} · ${unused} never used`,
    coverageLegend: "A heavier underline marks a claim one of your answers has used.",
    result: (r: SaveResult) =>
      `${r.total} ${r.total === 1 ? "claim" : "claims"} extracted — ${r.carriedForward} carried forward, ${r.fresh} new. ${r.rejected} dropped.`,
    dropped: (n: number) =>
      `${n} ${n === 1 ? "claim was" : "claims were"} dropped — their quotes did not match your text.`,
    savableAt: (clock: string) => `You can save again at ${clock}.`,
  },
} as const;

export type Copy = (typeof COPY)[CvLanguage];

/**
 * When a rate-limited save can be retried, as local `HH:MM` (06, #18). A clock time rather than a
 * countdown: it stays true however long the callout sits on screen. Rounded **up** to the minute, so
 * it never names a time at which the save would still be refused.
 */
export function retryClock(retryAfterSeconds: number, now: Date) {
  const minute = 60_000;
  const at = new Date(Math.ceil((now.getTime() + retryAfterSeconds * 1000) / minute) * minute);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

/** The documents' own heading: the kind, or the user's title for an additional document (10 §13). */
export function documentHeading(language: CvLanguage, kind: Kind, title: string | null) {
  return kind === "additional" ? (title ?? "") : (COPY[language].kinds[kind] ?? "");
}
