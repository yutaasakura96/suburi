import { describe, expect, it } from "vitest";
import { COPY } from "./copy";

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
});
