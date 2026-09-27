import { describe, expect, it } from "vitest";
import { renderDocuments, renderWindow } from "./extract-cv-claims";

// What the model is sent: each document headed by its index and kind, and an additional document by
// the user's title, so the prompt can treat a 履歴書's personal particulars differently from a
// portfolio's prose.
describe("renderDocuments", () => {
  it("heads each document with its index, its kind and, for an additional document, its title", () => {
    expect(
      renderDocuments([
        { kind: "rirekisho", title: null, text: "学歴" },
        { kind: "shokumu_keirekisho", title: null, text: "職歴" },
        { kind: "additional", title: "Mercari SRE 提出用ポートフォリオ", text: "Portfolio" },
      ]),
    ).toBe(
      [
        "=== document 0: rirekisho ===\n学歴",
        "=== document 1: shokumu_keirekisho ===\n職歴",
        "=== document 2: additional, titled: Mercari SRE 提出用ポートフォリオ ===\nPortfolio",
      ].join("\n\n"),
    );
  });

  it("keeps a title on the header line, so its line breaks cannot start a line of their own", () => {
    expect(renderDocuments([{ kind: "additional", title: "Portfolio\n\n2026", text: "x" }])).toBe(
      "=== document 0: additional, titled: Portfolio 2026 ===\nx",
    );
  });
});

// #29: every call is sent the whole set, then the one window it returns claims from — a header naming
// the document and its code-point range, and that exact passage, so the text quoted is the stored text.
describe("renderWindow", () => {
  const documents = [
    { kind: "rirekisho", title: null, text: "𠮷田商事\n\n学歴" },
    { kind: "shokumu_keirekisho", title: null, text: "職歴" },
  ];

  it("follows the documents with the window's header and its passage, sliced in code points", () => {
    expect(renderWindow(documents, { document: 0, start: 1, end: 4 })).toBe(
      `${renderDocuments(documents)}\n\n=== window: document 0, characters 1 to 4 ===\n田商事`,
    );
  });

  it("names a later document's window by its index", () => {
    expect(renderWindow(documents, { document: 1, start: 0, end: 2 })).toMatch(
      /\n\n=== window: document 1, characters 0 to 2 ===\n職歴$/u,
    );
  });
});
