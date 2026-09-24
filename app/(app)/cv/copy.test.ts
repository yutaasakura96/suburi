import { describe, expect, it } from "vitest";
import { COPY, retryClock } from "./copy";

// 05 §6's mechanical rules over the 応募書類 panel's chrome, as lib/copy/errors.test.ts holds them
// over the catalogue. Whether a person would write the sentence is #20's native read, not a test.

const SAMPLE = { total: 34, carriedForward: 27, fresh: 7, rejected: 2 };

const ja = Object.entries(COPY.ja).flatMap(([key, value]): [string, string][] => {
  if (typeof value === "string") return [[key, value]];
  if (typeof value === "function") return [[key, String((value as (n: never) => string)(SAMPLE as never))]];
  if (value && typeof value === "object") return Object.entries(value).map(([kind, text]) => [`${key}.${kind}`, text]);
  return [];
});

describe("the 応募書類 panel's Japanese chrome", () => {
  it.each(ja)("%s is written in Japanese", (_, text) => {
    expect(text).toMatch(/[぀-ヿ一-龯]/u);
  });

  // #13's native read: a version is バージョン, and 主張 reads as argument; the Claim word is 記載事項.
  it.each(ja)("%s writes バージョン, never 版, and never 主張", (_, text) => {
    expect(text).not.toMatch(/版/u);
    expect(text).not.toMatch(/主張/u);
  });

  it.each(ja)("%s uses no 点 counter and an unspaced nakaguro", (_, text) => {
    expect(text).not.toMatch(/[0-9０-９]\s*点/u);
    expect(text).not.toMatch(/[·・]\s|\s[·・]|·/u);
  });

  it("counts claims in 件 and names them 記載事項", () => {
    expect(COPY.ja.claims(34)).toBe("記載事項 34件");
  });

  // #20's reviewed draft (05 §6), applied ahead of the native read and testable without an ear.
  it.each(ja)("%s sets a Japanese particle tight against a Latin numeral", (_, text) => {
    expect(text).not.toMatch(/[0-9][ 　]+[ぁ-んァ-ヿ一-龯]/u);
  });

  it.each(ja)("%s calls a document's body 本文, never a bare 文", (_, text) => {
    expect(text).not.toMatch(/(?<!本)文(?!字)/u);
  });
});

describe("the time a rate-limited save can be retried (10 §13)", () => {
  const at = (hms: string) => new Date(`2026-09-22T${hms}`);

  it("is local HH:MM, 24-hour", () => {
    expect(retryClock(600, at("14:22:00"))).toBe("14:32");
    expect(retryClock(60, at("09:05:00"))).toBe("09:06");
  });

  it("rounds up to the next minute, so it never names a time that is still too early", () => {
    expect(retryClock(1, at("14:31:30"))).toBe("14:32");
    expect(retryClock(590, at("14:22:10"))).toBe("14:32");
  });

  it("wraps past midnight", () => {
    expect(retryClock(120, at("23:59:30"))).toBe("00:02");
  });

  it("is written into the sentence in both languages", () => {
    expect(COPY.ja.savableAt("14:32")).toBe("14:32から保存できます。");
    expect(COPY.en.savableAt("14:32")).toBe("You can save again at 14:32.");
  });
});
