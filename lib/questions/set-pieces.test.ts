import { describe, expect, it } from "vitest";
import { SET_PIECES } from "./set-pieces";

// 04 `questions`, 12 §3 step 9: the same four set pieces in each language — self-introduction,
// self-PR and reason for leaving to `hr`, motivation to `ceo` — each set under its content version.
describe.each(SET_PIECES.map((set) => [set.language, set] as const))("the %s set pieces", (language, set) => {
  it("carries its content version, which is stamp 3", () => {
    expect(set.contentVersion).toBe(`set-piece-${language}-1.0`);
  });

  it("gives hr three and ceo one, and the other round types none", () => {
    expect(set.pieces.map((piece) => piece.roundType)).toEqual(["hr", "hr", "hr", "ceo"]);
  });

  it("asks each question once, in its own language", () => {
    const bodies = set.pieces.map((piece) => piece.body);
    expect(new Set(bodies).size).toBe(bodies.length);
    for (const body of bodies) expect(/[぀-ヿ一-龯]/u.test(body)).toBe(language === "ja");
  });
});

it("has one set per language", () => {
  expect(SET_PIECES.map((set) => set.language).sort()).toEqual(["en", "ja"]);
});

// 06, 2026-09-27: the candidate asking does not fit answer-then-score.
it("has no reverse question", () => {
  const bodies = SET_PIECES.flatMap((set) => set.pieces.map((piece) => piece.body)).join("\n");
  expect(bodies).not.toMatch(/逆質問|何か質問はありますか|any questions for (us|me)/i);
});

// 05 §6: a Japanese question ends in 。, as a person writes it.
it("ends every Japanese set piece in 。", () => {
  const japanese = SET_PIECES.find((set) => set.language === "ja")!;
  for (const piece of japanese.pieces) expect(piece.body.endsWith("。")).toBe(true);
});
