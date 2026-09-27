import { describe, expect, it } from "vitest";
import type { ExtractedClaim } from "../ai/extract-cv-claims";
import { assembleBody } from "./body";
import { sliceQuote } from "./spans";
import { survivingClaims } from "./surviving-claims";
import type { ExtractionWindow } from "./windows";

// #29: a windowed call may quote only inside its window. Anything else it returns is dropped and
// counted in quotes_outside_window — never stored, never moved to the window that holds it.

const CV = "Led a team of 5.\n\nCut invoicing time by 40%.\n\nLed a team of 5.";
const PORTFOLIO = "Built an interview simulator.";
const { body, ranges } = assembleBody([CV, PORTFOLIO]);

const FIRST: ExtractionWindow = { document: 0, start: 0, end: 18 };
const REST: ExtractionWindow = { document: 0, start: 18, end: 62 };
const SECOND_DOCUMENT: ExtractionWindow = { document: 1, start: 0, end: 29 };

const claim = (document: number, quote: string, start_hint: number): ExtractedClaim => ({ document, quote, start_hint });

describe("survivingClaims", () => {
  it("keeps a claim inside its window", () => {
    const result = survivingClaims(body, ranges, [{ window: FIRST, claims: [claim(0, "Led a team of 5.", 0)] }]);
    expect(result.claims.map(({ span }) => sliceQuote(body, span))).toEqual(["Led a team of 5."]);
    expect(result.quotesOutsideWindow).toBe(0);
    expect(result.spansRejected).toBe(0);
  });

  it("drops and counts a claim from another document, or from another window of the same one", () => {
    const result = survivingClaims(body, ranges, [
      {
        window: FIRST,
        claims: [claim(0, "Cut invoicing time by 40%.", 18), claim(1, PORTFOLIO, 0)],
      },
      { window: SECOND_DOCUMENT, claims: [claim(0, "Led a team of 5.", 0)] },
    ]);
    expect(result.claims).toEqual([]);
    expect(result.quotesOutsideWindow).toBe(3);
    // Outside its window is not a hallucination: the quote is real, so the guard stays at 0.
    expect(result.spansRejected).toBe(0);
    expect(result.spansChecked).toBe(0);
  });

  it("drops a claim straddling the window's edge", () => {
    const result = survivingClaims(body, ranges, [
      { window: FIRST, claims: [claim(0, "Led a team of 5.\n\nCut invoicing", 0)] },
    ]);
    expect(result.quotesOutsideWindow).toBe(1);
  });

  it("takes the occurrence inside the window when the quote is also written elsewhere", () => {
    // The hint points at the first occurrence, which is FIRST's; REST holds the second.
    const result = survivingClaims(body, ranges, [{ window: REST, claims: [claim(0, "Led a team of 5.", 0)] }]);
    expect(result.claims.map(({ span }) => span)).toEqual([{ start: 46, end: 62 }]);
    expect(result.quotesOutsideWindow).toBe(0);
  });

  it("still counts a quote that is not in the text as spans_rejected, whichever window returned it", () => {
    const result = survivingClaims(body, ranges, [
      { window: FIRST, claims: [claim(0, "Cut invoicing time by 50%.", 18), claim(1, "Invented.", 0)] },
    ]);
    expect(result.spansRejected).toBe(2);
    expect(result.rejected).toEqual({ not_found: 2 });
    expect(result.quotesOutsideWindow).toBe(0);
  });

  it("keeps the earlier window's claim when two windows return the same assertion", () => {
    const result = survivingClaims(body, ranges, [
      { window: FIRST, claims: [claim(0, "Led a team of 5.", 0)] },
      { window: REST, claims: [claim(0, "Led a team of 5.", 46), claim(0, "Cut invoicing time by 40%.", 18)] },
    ]);
    expect(result.claims.map(({ span }) => span.start)).toEqual([0, 18]);
    expect(result.claimsDuplicated).toBe(1);
  });

  it("accounts for every returned claim: spans_checked plus quotes_outside_window", () => {
    const results = [
      { window: FIRST, claims: [claim(0, "Led a team of 5.", 0), claim(0, "Cut invoicing time by 40%.", 18)] },
      {
        window: REST,
        claims: [claim(0, "Cut invoicing time by 40%.", 18), claim(0, "Led a team of 5.", 46), claim(0, "Nope.", 0)],
      },
      { window: SECOND_DOCUMENT, claims: [claim(1, PORTFOLIO, 0)] },
    ];
    const returned = results.reduce((sum, { claims }) => sum + claims.length, 0);
    const result = survivingClaims(body, ranges, results);
    expect(result.spansChecked + result.quotesOutsideWindow).toBe(returned);
    expect(result.spansChecked).toBe(result.claims.length + result.spansRejected + result.claimsDuplicated);
  });
});
