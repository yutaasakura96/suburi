import { describe, expect, it } from "vitest";
import { sliceQuote } from "../lib/cv/spans";
import { SYNTHETIC_CV, syntheticCvVersion } from "./seed-cv";

describe("the synthetic CV fixtures", () => {
  it.each(["ja", "en"] as const)("%s: every claim slices back to its quote from the body", (language) => {
    const version = syntheticCvVersion("user", language, SYNTHETIC_CV[language]);
    const quotes = SYNTHETIC_CV[language].flatMap((document) => document.claims);

    expect(version.claims.map((claim) => sliceQuote(version.body, claim.span))).toEqual(quotes);
    expect(version.extractorModelId).toBeNull();
    expect(version.extractorPromptVersion).toBeNull();
  });

  it("counts in code points: a Japanese span is not the UTF-16 index", () => {
    const version = syntheticCvVersion("user", "ja", SYNTHETIC_CV.ja);
    const [first] = version.claims;
    expect(version.body.indexOf(SYNTHETIC_CV.ja[0].claims[0])).toBe(first.span.start + 1);
  });

  it("follows 04's composition: 履歴書, 職務経歴書, additional / CV, additional", () => {
    expect(SYNTHETIC_CV.ja.map((document) => document.kind)).toEqual(["rirekisho", "shokumu_keirekisho", "additional"]);
    expect(SYNTHETIC_CV.en.map((document) => document.kind)).toEqual(["cv", "additional"]);
  });

  it("throws on a quote that is not in its document", () => {
    const documents = [{ kind: "cv" as const, title: null, text: "Led a team of five.", claims: ["Led a team of six."] }];
    expect(() => syntheticCvVersion("user", "en", documents)).toThrow(/en document 0 claim 0 occurs 0 times/);
  });

  it("throws on a quote that occurs twice, rather than underlining a guess", () => {
    const documents = [{ kind: "cv" as const, title: null, text: "Shipped it. Shipped it.", claims: ["Shipped it."] }];
    expect(() => syntheticCvVersion("user", "en", documents)).toThrow(/occurs 2 times/);
  });

  it("throws on a quote in the wrong document, never borrowing another document's text", () => {
    const documents = [
      { kind: "cv" as const, title: null, text: "Led a team of five.", claims: [] },
      { kind: "additional" as const, title: "Notes", text: "Wrote the runbook.", claims: ["Led a team of five."] },
    ];
    expect(() => syntheticCvVersion("user", "en", documents)).toThrow(/en document 1 claim 0/);
  });

  it("names positions, never fixture text, in its errors", () => {
    const documents = [{ kind: "cv" as const, title: null, text: "Led a team of five.", claims: ["Secret claim text."] }];
    expect(() => syntheticCvVersion("user", "en", documents)).toThrow(expect.objectContaining({ message: expect.not.stringContaining("Secret") }));
  });
});
