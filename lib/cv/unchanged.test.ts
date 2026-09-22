import { describe, expect, it } from "vitest";
import { assembleBody } from "./body";
import { isUnchanged, type RequestedDocument } from "./unchanged";

const SET: RequestedDocument[] = [
  { kind: "rirekisho", title: null, text: "架空大学 卒業\n架空株式会社 入社" },
  { kind: "shokumu_keirekisho", title: null, text: "請求処理を40%短縮。🧑‍💻 チーム5名を統括。" },
  { kind: "additional", title: "ポートフォリオ", text: "架空の作品集。" },
];

function stored(documents: readonly RequestedDocument[]) {
  const { body, ranges } = assembleBody(documents.map((document) => document.text));
  return {
    body,
    documents: documents.map((document, index) => ({ kind: document.kind, title: document.title, ...ranges[index] })),
  };
}

describe("isUnchanged", () => {
  it("is true when every kind, title and text match in order — sliced by character past the emoji", () => {
    const { body, documents } = stored(SET);
    expect(isUnchanged(body, documents, SET)).toBe(true);
  });

  it("is false when one document's text differs, even by whitespace", () => {
    const { body, documents } = stored(SET);
    const edited = SET.map((document, index) => (index === 1 ? { ...document, text: `${document.text} ` } : document));
    expect(isUnchanged(body, documents, edited)).toBe(false);
  });

  it("is false when an additional document's title differs", () => {
    const { body, documents } = stored(SET);
    const retitled = SET.map((document, index) => (index === 2 ? { ...document, title: "作品集" } : document));
    expect(isUnchanged(body, documents, retitled)).toBe(false);
  });

  it("is false when a document is added or removed", () => {
    const { body, documents } = stored(SET);
    expect(isUnchanged(body, documents, SET.slice(0, 2))).toBe(false);
    expect(isUnchanged(body, documents, [...SET, { kind: "additional", title: "追加", text: "追加。" }])).toBe(false);
  });

  it("is false when the same text sits under a different kind", () => {
    const { body, documents } = stored([{ kind: "cv", title: null, text: "Invented CV." }]);
    expect(isUnchanged(body, documents, [{ kind: "additional", title: "CV", text: "Invented CV." }])).toBe(false);
  });

  it("is false when two additional documents swap places", () => {
    const set: RequestedDocument[] = [
      { kind: "cv", title: null, text: "Invented CV." },
      { kind: "additional", title: "A", text: "First." },
      { kind: "additional", title: "B", text: "Second." },
    ];
    const { body, documents } = stored(set);
    expect(isUnchanged(body, documents, [set[0], set[2], set[1]])).toBe(false);
  });
});
