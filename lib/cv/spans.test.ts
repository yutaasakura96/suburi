import { describe, expect, it } from "vitest";
import { characterLength, createSpanChecker, normaliseClaimText, sliceQuote } from "./spans";

// docs/11-testing-plan.md §3.3 — the anti-hallucination mechanism. Spans are code-point indices,
// because the rendered quote is Postgres `substring(body, …)`, which counts code points.

const whole = (body: string) => [{ start: 0, end: characterLength(body) }];

describe("characters, not bytes and not UTF-16 units", () => {
  it("counts 請求処理を40%短縮 as 10 characters, though it is 24 UTF-8 bytes", () => {
    const text = "請求処理を40%短縮";
    expect(Buffer.byteLength(text)).toBe(24);
    expect(characterLength(text)).toBe(10);
  });

  it("counts a surrogate pair as one character", () => {
    expect("𠮷野家".length).toBe(4);
    expect(characterLength("𠮷野家")).toBe(3);
  });

  it("slices by characters, as Postgres substring does", () => {
    expect(sliceQuote("𠮷野家で請求処理を40%短縮", { start: 5, end: 14 })).toBe("求処理を40%短縮");
  });
});

describe("validate", () => {
  const body = "経理システムの刷新を主導し、請求処理を40%短縮。チーム5名を統括。";
  const check = createSpanChecker(body, whole(body));

  it("accepts a span whose slice is exactly the claimed text, round-tripping it byte-identically", () => {
    const verdict = check.validate({ start: 14, end: 24 }, "請求処理を40%短縮");
    expect(verdict).toEqual({ ok: true, quote: "請求処理を40%短縮" });
    if (!verdict.ok) return;
    expect(Buffer.from(verdict.quote)).toEqual(Buffer.from("請求処理を40%短縮"));
  });

  it.each([
    ["past the end", { start: 30, end: 36 }, "out_of_range"],
    ["before the start", { start: -1, end: 3 }, "out_of_range"],
    ["off by one at the end", { start: 25, end: characterLength(body) + 1 }, "out_of_range"],
    ["inverted", { start: 24, end: 14 }, "inverted"],
    ["zero-width", { start: 14, end: 14 }, "empty"],
    ["not an integer", { start: 14.5, end: 24 }, "out_of_range"],
  ])("drops a span %s, never clamps it", (_, span, reason) => {
    expect(check.validate(span, "請求処理を40%短縮")).toEqual({ ok: false, reason });
  });

  it("drops a span whose slice differs from the claimed text", () => {
    expect(check.validate({ start: 14, end: 24 }, "請求処理を50%短縮")).toEqual({
      ok: false,
      reason: "mismatch",
    });
  });

  it("drops a span shifted by one, even when the claimed text would fit elsewhere", () => {
    expect(check.validate({ start: 15, end: 25 }, "請求処理を40%短縮")).toEqual({
      ok: false,
      reason: "mismatch",
    });
  });

  it("drops a span that would land mid-grapheme", () => {
    // が as か + combining dakuten: two characters, one grapheme.
    const decomposed = "しがく";
    const checker = createSpanChecker(decomposed, whole(decomposed));
    expect(checker.validate({ start: 0, end: 2 }, "しか")).toEqual({
      ok: false,
      reason: "splits_grapheme",
    });
    expect(checker.validate({ start: 0, end: 3 }, "しが")).toEqual({
      ok: true,
      quote: "しが",
    });
  });

  it("drops a span inside a joined emoji sequence", () => {
    const text = "チーム👩‍💻5名";
    const checker = createSpanChecker(text, whole(text));
    expect(checker.validate({ start: 3, end: 4 }, "👩")).toEqual({
      ok: false,
      reason: "splits_grapheme",
    });
  });

  it("drops a span that crosses a document boundary", () => {
    const joined = "履歴書の本文\n\nポートフォリオ";
    const documents = [
      { start: 0, end: 6 },
      { start: 8, end: 15 },
    ];
    const checker = createSpanChecker(joined, documents);
    expect(checker.validate({ start: 4, end: 10 }, "本文\n\nポー")).toEqual({
      ok: false,
      reason: "crosses_document",
    });
    expect(checker.validate({ start: 8, end: 15 }, "ポートフォリオ")).toEqual({
      ok: true,
      quote: "ポートフォリオ",
    });
  });
});

describe("locate", () => {
  const body = "Led a team of 5. Cut invoicing time by 40%. Led a team of 5.";
  const check = createSpanChecker(body, whole(body));

  it("finds a verbatim quote and returns its span", () => {
    expect(check.locate(0, "Cut invoicing time by 40%.", 17)).toEqual({ start: 17, end: 43 });
  });

  it("picks the occurrence nearest the hint when the quote repeats", () => {
    expect(check.locate(0, "Led a team of 5.", 0)).toEqual({ start: 0, end: 16 });
    expect(check.locate(0, "Led a team of 5.", 40)).toEqual({ start: 44, end: 60 });
  });

  it("uses the hint only to choose, never to shift", () => {
    expect(check.locate(0, "Cut invoicing time by 40%.", 900)).toEqual({ start: 17, end: 43 });
  });

  it("returns nothing for a quote that is not in the text verbatim", () => {
    expect(check.locate(0, "Cut invoicing time by 50%.", 17)).toBeNull();
    expect(check.locate(0, "", 0)).toBeNull();
  });

  it("returns nothing for a document that does not exist", () => {
    expect(check.locate(3, "Led a team of 5.", 0)).toBeNull();
  });

  it("indexes Japanese with surrogate pairs by characters", () => {
    const text = "𠮷田商事で請求処理を40%短縮。";
    const checker = createSpanChecker(text, whole(text));
    const span = checker.locate(0, "請求処理を40%短縮", 5);
    expect(span).toEqual({ start: 5, end: 15 });
    expect(sliceQuote(text, span!)).toBe("請求処理を40%短縮");
  });

  it("searches only inside the named document, with the hint relative to it", () => {
    const joined = "Python.\n\nPython.";
    const checker = createSpanChecker(joined, [
      { start: 0, end: 7 },
      { start: 9, end: 16 },
    ]);
    expect(checker.locate(1, "Python.", 0)).toEqual({ start: 9, end: 16 });
  });
});

describe("normaliseClaimText", () => {
  it("collapses every run of whitespace, including full-width spaces and newlines", () => {
    expect(normaliseClaimText("  請求処理を　40%\n\n短縮 ")).toBe("請求処理を 40% 短縮");
  });

  // #28: a Japanese CV mixes full-width and half-width forms of one assertion.
  it("reads full-width and half-width forms as one claim", () => {
    expect(normaliseClaimText("請求処理を４０％短縮")).toBe(normaliseClaimText("請求処理を40%短縮"));
    expect(normaliseClaimText("普通自動車第一種運転免許（AT限定）")).toBe(normaliseClaimText("普通自動車第一種運転免許(AT限定)"));
    expect(normaliseClaimText("ＡＷＳ認定")).toBe("AWS認定");
    expect(normaliseClaimText("ｼｽﾃﾑ開発")).toBe("システム開発");
  });

  it("applies NFKC before the collapse, so a space it produces is collapsed too", () => {
    // U+00A8 decomposes to a space and a combining diaeresis.
    expect(normaliseClaimText("A \u00a8")).toBe("A \u0308");
  });

  it("keeps case: AWS and aws are not folded into one claim", () => {
    expect(normaliseClaimText("Led AWS migration.")).not.toBe(normaliseClaimText("Led aws migration."));
  });

  it("is forgiving where validate is not: validate still refuses a quote one full-width character off", () => {
    const body = "請求処理を40%短縮";
    const check = createSpanChecker(body, whole(body));
    const span = { start: 0, end: characterLength(body) };
    expect(normaliseClaimText("請求処理を40％短縮")).toBe(normaliseClaimText(body));
    expect(check.validate(span, "請求処理を40％短縮")).toEqual({ ok: false, reason: "mismatch" });
    expect(check.validate(span, body)).toEqual({ ok: true, quote: body });
  });
});
