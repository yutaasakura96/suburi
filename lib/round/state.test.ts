import { describe, expect, it } from "vitest";
import { questionsSubmitted, roundStep, type AnswerRow, type FollowUpRow } from "./state";

// Where a round is, from its rows alone (07 §5.5, §5.9): a position is its bank question and then
// that answer's one follow-up. The same derivation serves the handlers and the page.

const realistic = { length: 2, mode: "realistic", completedAt: null } as const;
const practice = { ...realistic, mode: "practice" } as const;

function answer(id: string, position: number, fields: Partial<AnswerRow> = {}) {
  return { id, position, questionId: `q${position}`, parentAnswerId: null, retryOfAnswerId: null, transcriptCorrected: "said", ...fields } as AnswerRow;
}

/** A follow-up's own answer: no question, the parent's position. */
function followUpAnswer(id: string, parent: AnswerRow, fields: Partial<AnswerRow> = {}) {
  return answer(id, parent.position, { questionId: null, parentAnswerId: parent.id, ...fields });
}

function followUp(parent: AnswerRow, status: "generated" | "missing" = "generated") {
  return { id: `f-${parent.id}`, parentAnswerId: parent.id, status, promptText: status === "generated" ? "And then?" : null } as FollowUpRow;
}

describe("roundStep", () => {
  const first = answer("a1", 1);
  const second = answer("a2", 2);

  it("starts on the first question, with no slot open", () => {
    expect(roundStep(realistic, [], [])).toEqual({ kind: "answer", position: 1, answer: null, followUp: null });
  });

  it("stays on a question whose slot is open and not submitted", () => {
    const open = answer("a1", 1, { transcriptCorrected: null });
    expect(roundStep(realistic, [open], [])).toEqual({ kind: "answer", position: 1, answer: open, followUp: null });
  });

  it("owes a follow-up once the question is submitted and no row is stored", () => {
    expect(roundStep(realistic, [first], [])).toEqual({ kind: "follow_up_due", position: 1, parent: first });
  });

  it("asks the stored follow-up at its parent's position", () => {
    const row = followUp(first);
    expect(roundStep(realistic, [first], [row])).toEqual({ kind: "answer", position: 1, answer: null, followUp: { row, parent: first } });
    const open = followUpAnswer("a1f", first, { transcriptCorrected: null });
    expect(roundStep(realistic, [first, open], [row])).toMatchObject({ kind: "answer", position: 1, answer: open });
  });

  it("moves to the next question once the follow-up is answered", () => {
    const step = roundStep(realistic, [first, followUpAnswer("a1f", first)], [followUp(first)]);
    expect(step).toEqual({ kind: "answer", position: 2, answer: null, followUp: null });
  });

  it("moves past a missing follow-up: the hole is a row, and nothing is asked for it", () => {
    expect(roundStep(realistic, [first], [followUp(first, "missing")])).toEqual({ kind: "answer", position: 2, answer: null, followUp: null });
  });

  it("owes no follow-up to a follow-up's own answer", () => {
    // The follow-up's answer is submitted and has no row of its own; the round moves on regardless.
    const answers = [first, followUpAnswer("a1f", first), second, followUpAnswer("a2f", second)];
    expect(roundStep(realistic, answers, [followUp(first), followUp(second)])).toEqual({ kind: "pressure" });
  });

  it("owes no follow-up to a practice answer-again, submitted or not", () => {
    const rows = [followUp(first), followUp(second, "missing")];
    const answers = [first, followUpAnswer("a1f", first), second];
    for (const transcriptCorrected of ["said again", null]) {
      const retry = answer("a1r", 1, { retryOfAnswerId: first.id, transcriptCorrected });
      expect(roundStep(practice, [...answers, retry], rows)).toEqual({ kind: "finish" });
    }
  });

  it("ends a realistic round on the rating and a practice round on finish", () => {
    const answers = [first, second];
    const rows = [followUp(first, "missing"), followUp(second, "missing")];
    expect(roundStep(realistic, answers, rows)).toEqual({ kind: "pressure" });
    expect(roundStep(practice, answers, rows)).toEqual({ kind: "finish" });
  });

  it("is complete once completed_at is set, whatever its rows say", () => {
    expect(roundStep({ ...realistic, completedAt: new Date() }, [], [])).toEqual({ kind: "complete" });
  });
});

describe("questionsSubmitted", () => {
  const first = answer("a1", 1);

  it.each([
    ["on a question", roundStep(realistic, [], []), 0],
    ["with its follow-up due", roundStep(realistic, [first], []), 1],
    ["on its follow-up", roundStep(realistic, [first], [followUp(first)]), 1],
    ["on the next question", roundStep(realistic, [first], [followUp(first, "missing")]), 1],
    ["at the rating", { kind: "pressure" } as const, 2],
  ])("counts the bank questions answered %s", (_, step, submitted) => {
    expect(questionsSubmitted(realistic, step)).toBe(submitted);
  });
});
