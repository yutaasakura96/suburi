import { describe, expect, it } from "vitest";
import { underlineSegments } from "./segments";

describe("underlineSegments", () => {
  const body = "𠮷田商事\n\nLed a team of 5. Cut invoicing time by 40%.";
  const cv = { start: 6, end: 49 };

  it("splits a document's text at its claim spans, sliced from the body by character", () => {
    expect(underlineSegments(body, cv, [{ start: 23, end: 49 }, { start: 6, end: 22 }])).toEqual([
      { text: "Led a team of 5.", claim: true, used: false },
      { text: " ", claim: false, used: false },
      { text: "Cut invoicing time by 40%.", claim: true, used: false },
    ]);
  });

  it("reproduces the document's text exactly when joined", () => {
    const segments = underlineSegments(body, { start: 0, end: 4 }, [{ start: 1, end: 3 }]);
    expect(segments).toEqual([
      { text: "𠮷", claim: false, used: false },
      { text: "田商", claim: true, used: false },
      { text: "事", claim: false, used: false },
    ]);
  });

  it("marks a cited claim's run as used, and breaks the run where coverage changes", () => {
    expect(
      underlineSegments(body, cv, [
        { start: 6, end: 22, used: true },
        { start: 22, end: 49, used: false },
      ]),
    ).toEqual([
      { text: "Led a team of 5.", claim: true, used: true },
      { text: " Cut invoicing time by 40%.", claim: true, used: false },
    ]);
  });

  it("reads overlapping claims as used where either is", () => {
    expect(
      underlineSegments(body, cv, [
        { start: 6, end: 16, used: false },
        { start: 12, end: 22, used: true },
      ]),
    ).toEqual([
      { text: "Led a ", claim: true, used: false },
      { text: "team of 5.", claim: true, used: true },
      { text: " Cut invoicing time by 40%.", claim: false, used: false },
    ]);
  });

  it("ignores spans outside the document and merges overlapping ones", () => {
    expect(
      underlineSegments(body, cv, [{ start: 0, end: 4 }, { start: 6, end: 12 }, { start: 10, end: 22 }]),
    ).toEqual([
      { text: "Led a team of 5.", claim: true, used: false },
      { text: " Cut invoicing time by 40%.", claim: false, used: false },
    ]);
  });
});
