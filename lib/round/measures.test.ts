import { describe, expect, it } from "vitest";
import { pace, rewriteMagnitude, rewritePercent } from "./measures";

// 11 §3.9: the expected values are the specification.
describe("rewriteMagnitude", () => {
  it("is 0 for identical text", () => {
    expect(rewriteMagnitude("I led the migration.", "I led the migration.")).toBe(0);
  });

  it("is 1 for a total rewrite", () => {
    expect(rewriteMagnitude("aaaa", "bbbb")).toBe(1);
  });

  it("is 0 when both are empty", () => {
    expect(rewriteMagnitude("", "")).toBe(0);
  });

  it("is stable under pure whitespace changes", () => {
    expect(rewriteMagnitude("I led  the\nmigration. ", "I led the migration.")).toBe(0);
  });

  it("grows with the edit", () => {
    const raw = "we moved the payments platform in six months";
    const one = rewriteMagnitude(raw, "we moved the payment platform in six months");
    const two = rewriteMagnitude(raw, "we moved the payment system in six months");
    const three = rewriteMagnitude(raw, "I moved the payment system in four weeks");
    expect(0).toBeLessThan(one);
    expect(one).toBeLessThan(two);
    expect(two).toBeLessThan(three);
  });

  it("is 1 − LCS / max by code point, as 10 §6 computes it", () => {
    // LCS("決済期版", "決済基盤") = 2, max = 4 → 0.5.
    expect(rewriteMagnitude("決済期版", "決済基盤")).toBe(0.5);
    // Deleting 2 of 10 characters: LCS 8, max 10.
    expect(rewriteMagnitude("abcdefghij", "abcdefgh")).toBeCloseTo(0.2);
  });

  it("counts a character outside the BMP once", () => {
    expect(rewriteMagnitude("𠮷田", "吉田")).toBe(0.5);
  });

  it("rounds to screen 6's whole percentage", () => {
    expect(rewritePercent(0.124)).toBe(12);
    expect(rewritePercent(0.125)).toBe(13);
    expect(rewritePercent(1.2)).toBe(100);
  });
});

describe("pace", () => {
  // 10 §5's consistent sample: 3:12 at about 250 字/分 is 800 characters.
  it("is characters per minute for ja", () => {
    expect(pace("ja", "あ".repeat(800), 192_000)).toBe(250);
  });

  it("ignores whitespace when counting ja characters", () => {
    expect(pace("ja", "あい うえ\nお", 60_000)).toBe(5);
  });

  it("is words per minute for en", () => {
    expect(pace("en", Array.from({ length: 300 }, () => "word").join(" "), 120_000)).toBe(150);
  });

  it("is null without a duration", () => {
    expect(pace("en", "some words", null)).toBeNull();
    expect(pace("en", "some words", 0)).toBeNull();
  });
});
