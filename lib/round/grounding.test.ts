import { describe, expect, it } from "vitest";
import { sliceQuote } from "../cv/spans";
import { answerSpanChecker, citableClaims, locateUnsupported, pickUntouched, resolveCitations } from "./grounding";

// 11 §3.12: the answer-side span validator, and the two id checks beside it. Synthetic text only.

describe("the answer-side span validator (11 §3.12)", () => {
  // 𠮷 is one code point and two UTF-16 units; が is か + a combining mark, one grapheme of two code points.
  const corrected = "𠮷田です。I cut the failure rate by half, um, and led a team of four. がんばりました。";

  it("renders a quote sliced from the corrected text by span, never the model's text", () => {
    const { spans, dropped } = locateUnsupported(corrected, [{ quote: "cut the failure rate by half", startHint: 0 }]);
    expect(dropped).toBe(0);
    expect(spans).toEqual([{ start: 7, end: 35 }]);
    expect(sliceQuote(corrected, spans[0])).toBe("cut the failure rate by half");
  });

  it("counts code points, so a surrogate pair before the quote shifts nothing", () => {
    const { spans } = locateUnsupported(corrected, [{ quote: "田です", startHint: 0 }]);
    expect(spans).toEqual([{ start: 1, end: 4 }]);
  });

  it("drops and counts a quote that is not in the corrected text", () => {
    expect(locateUnsupported(corrected, [{ quote: "cut the failure rate by 80%", startHint: 7 }])).toEqual({ spans: [], dropped: 1 });
  });

  it("drops a quote that differs by one character of whitespace or case: no fuzzy match", () => {
    expect(locateUnsupported(corrected, [{ quote: "Cut the failure rate by half", startHint: 7 }]).dropped).toBe(1);
    expect(locateUnsupported(corrected, [{ quote: "cut the  failure rate by half", startHint: 7 }]).dropped).toBe(1);
  });

  it("drops a zero-width quote", () => {
    expect(locateUnsupported(corrected, [{ quote: "", startHint: 3 }])).toEqual({ spans: [], dropped: 1 });
  });

  it("drops a quote that splits a grapheme", () => {
    // か is in the text, but only as the base of が.
    expect(locateUnsupported(corrected, [{ quote: "か", startHint: 60 }])).toEqual({ spans: [], dropped: 1 });
  });

  it("never clamps: a hint outside the text chooses an occurrence, it does not move one", () => {
    const twice = "We shipped it. Later, we shipped it.";
    expect(locateUnsupported(twice, [{ quote: "shipped it", startHint: 9_999 }]).spans).toEqual([{ start: 25, end: 35 }]);
    expect(locateUnsupported(twice, [{ quote: "shipped it", startHint: -40 }]).spans).toEqual([{ start: 3, end: 13 }]);
  });

  it("keeps the survivors when one quote of several is dropped, and stores a repeated span once", () => {
    const { spans, dropped } = locateUnsupported(corrected, [
      { quote: "led a team of four", startHint: 45 },
      { quote: "led a team of forty", startHint: 45 },
      { quote: "led a team of four", startHint: 44 },
    ]);
    expect(spans).toEqual([{ start: 45, end: 63 }]);
    expect(dropped).toBe(1);
  });

  it.each([
    ["outside the text", { start: 60, end: 400 }],
    ["before it", { start: -1, end: 4 }],
    ["inverted", { start: 12, end: 7 }],
    ["zero-width", { start: 7, end: 7 }],
    ["splitting a grapheme", { start: 66, end: 67 }],
  ])("refuses a span %s", (_, span) => {
    expect(answerSpanChecker(corrected).validate(span, sliceQuote(corrected, span)).ok).toBe(false);
  });
});

describe("citations, written only after span validation (07 §5.10)", () => {
  const body = "Led a team of four.\n\nBuilt the refund service.";
  const documents = [{ start: 0, end: 19 }, { start: 21, end: 46 }];
  const stored = [
    { id: "a", start: 0, end: 19, textNormalised: "Led a team of four." },
    { id: "b", start: 21, end: 46, textNormalised: "Built the refund service." },
  ];

  it("sends the scorer each claim sliced from the stored body, in order", () => {
    expect(citableClaims(body, documents, stored)).toEqual({
      claims: [
        { id: "a", text: "Led a team of four." },
        { id: "b", text: "Built the refund service." },
      ],
      rejected: 0,
    });
  });

  it.each([
    ["a span outside the body", { id: "c", start: 30, end: 90, textNormalised: "x" }],
    ["a span whose slice is not the claim", { id: "c", start: 0, end: 18, textNormalised: "Led a team of four." }],
    ["a span across two documents", { id: "c", start: 10, end: 30, textNormalised: "f four. Built the re" }],
    ["an inverted span", { id: "c", start: 19, end: 0, textNormalised: "Led a team of four." }],
  ])("leaves out a claim with %s, so nothing can cite it", (_, claim) => {
    const { claims, rejected } = citableClaims(body, documents, [...stored, claim]);
    expect(claims.map((row) => row.id)).toEqual(["a", "b"]);
    expect(rejected).toBe(1);
  });

  it("resolves a citation by the number the scorer was shown", () => {
    const { claims } = citableClaims(body, documents, stored);
    expect(
      resolveCitations(claims, [
        { claim: 2, relation: "supported_by" },
        { claim: 1, relation: "contradicted_by" },
      ]),
    ).toEqual({
      citations: [
        { cvClaimId: "b", relation: "supported_by" },
        { cvClaimId: "a", relation: "contradicted_by" },
      ],
      dropped: 0,
    });
  });

  it("drops and counts a citation of a claim that was never shown", () => {
    const { claims } = citableClaims(body, documents, stored);
    expect(
      resolveCitations(claims, [
        { claim: 0, relation: "supported_by" },
        { claim: 3, relation: "supported_by" },
        { claim: 1.5, relation: "supported_by" },
        { claim: 1, relation: "supported_by" },
      ]),
    ).toEqual({ citations: [{ cvClaimId: "a", relation: "supported_by" }], dropped: 3 });
  });

  it("stores one row for a claim cited twice with one relation", () => {
    const { claims } = citableClaims(body, documents, stored);
    const { citations, dropped } = resolveCitations(claims, [
      { claim: 1, relation: "supported_by" },
      { claim: 1, relation: "supported_by" },
    ]);
    expect(citations).toHaveLength(1);
    expect(dropped).toBe(0);
  });
});

describe("untouched material, validated against the never-cited set (11 §3.12)", () => {
  const neverCited = ["a", "b", "c", "d"].map((id) => ({ id, text: `claim ${id}` }));

  it("stores the ids of the claims picked, in the order picked", () => {
    expect(pickUntouched(neverCited, [3, 1])).toEqual({ ids: ["c", "a"], dropped: 0 });
  });

  it("drops and counts a pick that names no never-cited claim", () => {
    expect(pickUntouched(neverCited, [5, 0, 2, -1])).toEqual({ ids: ["b"], dropped: 3 });
  });

  it("never stores more than three, and counts the rest", () => {
    expect(pickUntouched(neverCited, [1, 2, 3, 4])).toEqual({ ids: ["a", "b", "c"], dropped: 1 });
  });

  it("stores a claim picked twice once", () => {
    expect(pickUntouched(neverCited, [2, 2, 4])).toEqual({ ids: ["b", "d"], dropped: 0 });
  });

  it("stores nothing when every claim was cited", () => {
    expect(pickUntouched([], [1, 2])).toEqual({ ids: [], dropped: 2 });
  });
});
