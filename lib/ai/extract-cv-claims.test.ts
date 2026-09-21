import { describe, expect, it } from "vitest";
import { renderDocuments } from "./extract-cv-claims";

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
