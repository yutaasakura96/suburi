import { describe, expect, it } from "vitest";
import { RUBRICS } from "../rubric/index";
import { checkScores, renderScoringInput } from "./score";
import { ModelCallFailed } from "./upstream";

const ja = RUBRICS.find((rubric) => rubric.language === "ja")!;
const en = RUBRICS.find((rubric) => rubric.language === "en")!;

// 03 §4: what the scorer is sent — the rubric with its anchors, the question, the delivery, the answer.
describe("renderScoringInput", () => {
  const input = { prompt: "自己PRをお願いします。", answer: "えー、私の強みは粘り強さです。", durationMs: 192_000, pace: 250 };

  it("sends a Japanese rubric by its Japanese names, all seven dimensions, pace in characters", () => {
    const rendered = renderScoringInput({ rubric: ja, ...input });
    expect(rendered).toContain("=== rubric ja v1.0 ===");
    for (const dimension of ja.dimensions) {
      expect(rendered).toContain(`- ${dimension.key} (${dimension.label_ja}): ${dimension.definition.summary}`);
      dimension.definition.anchors.forEach((anchor, index) => expect(rendered).toContain(`  ${index + 1}: ${anchor}`));
    }
    expect(rendered).toContain("- keigo (敬語): ");
    expect(rendered).toContain("duration: 3:12");
    expect(rendered).toContain("pace: 250 characters per minute");
  });

  it("sends an English rubric by its English names, with no keigo, pace in words", () => {
    const rendered = renderScoringInput({ rubric: en, ...input, pace: 150 });
    expect(rendered).toContain("- length_pacing (Length and pacing): ");
    expect(rendered).not.toContain("keigo");
    expect(rendered).toContain("pace: 150 words per minute");
  });
});

// 11 §6: a missing dimension, an extra one, a value of 6 — rejected before any row is written.
describe("checkScores, against the Japanese rubric", () => {
  const scores = ja.dimensions.map((dimension) => ({ dimension: dimension.key, value: 3, justification: "根拠" }));

  it("accepts exactly the seven, and returns them in the rubric's order", () => {
    const checked = checkScores(ja, [...scores].reverse());
    expect(checked.map((score) => score.dimension)).toEqual(ja.dimensions.map((dimension) => dimension.key));
  });

  it("refuses a result with no keigo", () => {
    expect(() => checkScores(ja, scores.filter((score) => score.dimension !== "keigo"))).toThrow(ModelCallFailed);
  });

  it("refuses keigo against the English rubric", () => {
    expect(() => checkScores(en, scores)).toThrow(ModelCallFailed);
  });
});
