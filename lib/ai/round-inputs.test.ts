import { describe, expect, it } from "vitest";
import { EN_1_0 } from "../rubric/en-1.0";
import { renderFeedbackInput } from "./round-feedback";
import { renderClaims, renderScoringInput } from "./score";

// What the scorer and the feedback call are sent about the CV (#46): claims under a number, from 1 —
// the only handle a model has on a claim, and the one the server resolves back (lib/round/grounding.ts).
describe("renderClaims", () => {
  it("numbers the claims from 1, one a line, in the order given", () => {
    expect(renderClaims(["Led a team of five.", "Cut invoicing time by 40%."])).toBe(
      "[1] Led a team of five.\n[2] Cut invoicing time by 40%.",
    );
  });

  it("keeps a claim on its own line, so a line break inside it cannot start a line that reads as another claim", () => {
    expect(renderClaims(["Led a team\n[2] of five.", "Cut costs."])).toBe("[1] Led a team [2] of five.\n[2] Cut costs.");
  });

  it("says so when there is none, rather than sending an empty block", () => {
    expect(renderClaims([])).toBe("(none)");
  });
});

describe("renderScoringInput", () => {
  const input = {
    rubric: EN_1_0,
    prompt: "Tell me about a migration you led.",
    answer: "I led the migration.",
    durationMs: 90_000,
    pace: 140,
    claims: ["Led a zero-downtime migration.", "Built the refund service."],
  };

  it("puts the numbered claims in a block of their own, before the answer", () => {
    const rendered = renderScoringInput(input);
    expect(rendered).toContain("=== CV claims ===\n[1] Led a zero-downtime migration.\n[2] Built the refund service.\n=== answer ===\nI led the migration.");
  });

  it("sends an answer scored against a CV with no claims a block that says none", () => {
    expect(renderScoringInput({ ...input, claims: [] })).toContain("=== CV claims ===\n(none)\n=== answer ===");
  });
});

describe("renderFeedbackInput", () => {
  const answer = {
    position: 1,
    prompt: "Tell me about a migration you led.",
    answer: "I led the migration and cut costs by a third.",
    durationMs: 90_000,
    pace: 140,
    scores: [{ dimension: "structure", value: 3 }],
    unsupported: ["cut costs by a third"],
  };

  it("gives each answer its unsupported parts, quoted, and says when nothing was flagged", () => {
    const rendered = renderFeedbackInput({
      rubric: EN_1_0,
      answers: [answer, { ...answer, position: 2, unsupported: [] }],
      unusedClaims: [],
    });
    expect(rendered).toContain('not supported by the CV: "cut costs by a third"');
    expect(rendered).toContain("not supported by the CV: nothing flagged");
  });

  it("lists the unused claims last, under their numbers", () => {
    const rendered = renderFeedbackInput({ rubric: EN_1_0, answers: [answer], unusedClaims: ["Built the refund service."] });
    expect(rendered.endsWith("=== CV claims no answer in this round used ===\n[1] Built the refund service.")).toBe(true);
  });
});
