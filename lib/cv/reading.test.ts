import { describe, expect, it } from "vitest";
import { readClaims, type ValidatedClaim } from "./reading";
import { normaliseClaimText, type Span } from "./spans";

// Spans are code-point indices (04), so every fixture locates its quotes rather than typing offsets.
function claimsIn(body: string, ...quotes: readonly string[]): ValidatedClaim[] {
  return quotes.map((quote) => {
    const start = Array.from(body.slice(0, body.indexOf(quote))).length;
    const span: Span = { start, end: start + Array.from(quote).length };
    return { span, textNormalised: normaliseClaimText(quote) };
  });
}

const whole = (body: string): Span[] => [{ start: 0, end: Array.from(body).length }];

describe("claimsSplit", () => {
  // #27's defect 1, in the words it was measured in: one 職務経歴書 sentence became five claims,
  // three of them ending at a 連用形 that cannot be quoted back as evidence.
  it("counts both halves of a sentence cut at a 連用形 hinge", () => {
    const body = "開発用成果物の混入を特定し、プール設定とタイムアウトを見直し、再試行可能な503応答へ変換しました。";
    const reading = readClaims(body, whole(body), claimsIn(body, "開発用成果物の混入を特定し", "プール設定とタイムアウトを見直し"));
    expect(reading.claimsSplit).toBe(2);
  });

  // The refinement that keeps the counter usable: a 学歴・職歴 table is whole claims one per line,
  // and the run is unbroken only because a newline separates them.
  it("does not count claims on consecutive lines", () => {
    const body = "2016年4月\t架空大学 入学\n2020年3月\t架空大学 卒業";
    const reading = readClaims(body, whole(body), claimsIn(body, "2016年4月\t架空大学 入学", "2020年3月\t架空大学 卒業"));
    expect(reading.claimsSplit).toBe(0);
  });

  it("does not count claims with words between them", () => {
    const body = "経理システムを刷新しました。その後、請求処理を40%短縮しました。";
    const reading = readClaims(body, whole(body), claimsIn(body, "経理システムを刷新しました", "請求処理を40%短縮しました"));
    expect(reading.claimsSplit).toBe(0);
  });

  it("counts overlapping claims, which are one assertion read twice", () => {
    const body = "led the migration including rollback strategies";
    const reading = readClaims(body, whole(body), claimsIn(body, "led the migration including rollback strategies", "including rollback strategies"));
    expect(reading.claimsSplit).toBe(2);
  });

  it("never pairs claims across a document boundary", () => {
    const body = "履歴書の最後の一文。職務経歴書の最初の一文。";
    const documents: Span[] = [{ start: 0, end: 10 }, { start: 10, end: Array.from(body).length }];
    const reading = readClaims(body, documents, claimsIn(body, "履歴書の最後の一文", "職務経歴書の最初の一文"));
    expect(reading.claimsSplit).toBe(0);
  });
});

describe("claimsDuplicated", () => {
  // #27's defect 2: the same 17 certification lines came back from the 履歴書's 免許・資格 table and
  // again from the 職務経歴書's list — 34 of 181 Japanese claims for 17 qualifications.
  it("keeps one claim per normalised text and counts the rest", () => {
    const body = "基本情報技術者試験 合格\n応用情報技術者試験 合格\n基本情報技術者試験 合格";
    const [first, second, repeat] = claimsIn(body, "応用情報技術者試験 合格", "基本情報技術者試験 合格", "基本情報技術者試験 合格");
    const reading = readClaims(body, whole(body), [first, second, repeat]);
    expect(reading.claimsDuplicated).toBe(1);
    expect(reading.claims.map((claim) => claim.textNormalised)).toEqual(["基本情報技術者試験 合格", "応用情報技術者試験 合格"]);
  });

  it("counts a claim the model returned twice on the same span", () => {
    const body = "チーム5名を統括しました。";
    const [claim] = claimsIn(body, "チーム5名を統括しました");
    expect(readClaims(body, whole(body), [claim, claim]).claimsDuplicated).toBe(1);
  });
});

describe("unclaimedRunMax", () => {
  // #27's defect 3: the English CV's PROJECTS block, 3,875 code points, produced no claims at all.
  it("is the longest stretch no claim covers", () => {
    const body = `${"あ".repeat(10)}claimed${"い".repeat(40)}`;
    expect(readClaims(body, whole(body), claimsIn(body, "claimed")).unclaimedRunMax).toBe(40);
  });

  it("measures each document separately, never across the join", () => {
    const body = `${"あ".repeat(20)}${"い".repeat(20)}`;
    const documents: Span[] = [{ start: 0, end: 20 }, { start: 20, end: 40 }];
    expect(readClaims(body, documents, []).unclaimedRunMax).toBe(20);
  });

  it("counts surrogate pairs as one code point, as every span does", () => {
    const body = `${"𠮷".repeat(12)}claimed`;
    expect(readClaims(body, whole(body), claimsIn(body, "claimed")).unclaimedRunMax).toBe(12);
  });
});

describe("claimsSplit, on prose that shares a line", () => {
  // A .docx paragraph is one line. Two finished sentences of a 職務要約 therefore sit on the same
  // line with 「。」 between them — whole claims, not halves, and the counter must not say otherwise.
  it("does not count two finished sentences in one paragraph", () => {
    const body = "経理システムの刷新を主導しました。請求処理を40%短縮しました。";
    const reading = readClaims(body, whole(body), claimsIn(body, "経理システムの刷新を主導しました", "請求処理を40%短縮しました"));
    expect(reading.claimsSplit).toBe(0);
  });

  it("does not count them when the quote carries its own 。", () => {
    const body = "経理システムの刷新を主導しました。請求処理を40%短縮しました。";
    const reading = readClaims(body, whole(body), claimsIn(body, "経理システムの刷新を主導しました。", "請求処理を40%短縮しました。"));
    expect(reading.claimsSplit).toBe(0);
  });

  it("counts an English sentence cut at a participial hinge, on a line it shares", () => {
    const body = "Migrated 40 services, ensuring safety and quality compliance. Led the team.";
    const reading = readClaims(body, whole(body), claimsIn(body, "Migrated 40 services", "ensuring safety and quality compliance"));
    expect(reading.claimsSplit).toBe(2);
  });
});
