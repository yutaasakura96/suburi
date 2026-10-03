import { describe, expect, it } from "vitest";
import { RUBRICS } from "./index";

// 04 `rubric_versions`, 06 2026-09-27: two rubrics, not one with a flag; six shared dimensions and
// keigo in Japanese only; an anchor for every level of every dimension.
const SHARED = ["structure", "evidence", "relevance", "fluency", "accuracy", "length_pacing"];

describe.each(RUBRICS.map((rubric) => [`${rubric.language} ${rubric.versionLabel}`, rubric] as const))(
  "rubric %s",
  (_, rubric) => {
    it("has the language's dimensions in the scored order", () => {
      const keys = rubric.dimensions.map((dimension) => dimension.key);
      expect(keys).toEqual(rubric.language === "ja" ? [...SHARED, "keigo"] : SHARED);
    });

    it.each(rubric.dimensions.map((dimension) => [dimension.key, dimension] as const))(
      "anchors every level of %s and names it in both languages",
      (_, dimension) => {
        expect(dimension.label_ja).toMatch(/[぀-ヿ一-龯]/u);
        expect(dimension.label_en.trim()).not.toBe("");
        expect(dimension.definition.summary.trim()).not.toBe("");
        expect(dimension.definition.anchors).toHaveLength(5);
        for (const anchor of dimension.definition.anchors) expect(anchor.trim()).not.toBe("");
        expect(new Set(dimension.definition.anchors).size).toBe(5);
      },
    );

    // 04 `rubric_versions`: the definition is in the rubric's language, both the summary and every anchor.
    it("writes every definition in its own language", () => {
      const japanese = /[぀-ヿ一-龯]/u;
      for (const { definition } of rubric.dimensions) {
        for (const text of [definition.summary, ...definition.anchors]) {
          expect(japanese.test(text)).toBe(rubric.language === "ja");
        }
      }
    });

    // Fluency and accuracy are separate dimensions and must never collapse into one language score.
    it("keeps fluency and accuracy apart", () => {
      const fluency = rubric.dimensions.find((dimension) => dimension.key === "fluency");
      const accuracy = rubric.dimensions.find((dimension) => dimension.key === "accuracy");
      expect(fluency?.definition.summary).not.toBe(accuracy?.definition.summary);
    });
  },
);

it("has one row per version label and language", () => {
  const keys = RUBRICS.map((rubric) => `${rubric.language} ${rubric.versionLabel}`);
  expect(new Set(keys).size).toBe(keys.length);
});

// 12 §3 step 9 seeds v1.0 for both languages.
it("has v1.0 in both languages", () => {
  expect(RUBRICS.map((rubric) => `${rubric.language} ${rubric.versionLabel}`).sort()).toEqual(["en v1.0", "ja v1.0"]);
});

// 05 §6: 点 is never a counter — a digit followed by it reads as marks awarded.
it("never counts in 点", () => {
  for (const rubric of RUBRICS) expect(JSON.stringify(rubric)).not.toMatch(/[0-9０-９]点/u);
});
