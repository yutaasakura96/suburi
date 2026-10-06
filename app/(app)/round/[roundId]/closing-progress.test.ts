import { describe, expect, it } from "vitest";
import { ROUND_COPY } from "../copy";
import { closingWait, scoringProgress } from "./closing-progress";

// 10 §7, while the round closes: the counts come from the round's read (07 §5.5) and from nothing
// else, and the wait line draws one segment per thing that is really being waited for.

const submitted = (status?: string) => ({ state: "submitted", ...(status ? { scoring: { attempt_id: "a", status } } : {}) });

describe("scoringProgress", () => {
  it("counts the submitted answers and those no longer pending", () => {
    const read = { answers: [submitted("ok"), submitted("pending"), submitted("ok"), submitted("pending")] };
    expect(scoringProgress(read)).toEqual({ done: 2, total: 4 });
  });

  // 07 §5.12: a failed score is not waited for, so it is not left to wait on here either.
  it("counts a failed score as done", () => {
    expect(scoringProgress({ answers: [submitted("ok"), submitted("failed")] })).toEqual({ done: 2, total: 2 });
  });

  it("waits on a submitted answer whose attempt is not in the read yet", () => {
    expect(scoringProgress({ answers: [submitted("ok"), submitted()] })).toEqual({ done: 1, total: 2 });
  });

  it("leaves out an answer that was never submitted", () => {
    const read = { answers: [submitted("ok"), { state: "transcribed" }, { state: "uploaded" }, { state: "open" }] };
    expect(scoringProgress(read)).toEqual({ done: 1, total: 1 });
  });

  // 10 §15: an answer given again stands beside its original, so it is one question, not two.
  describe("a question given again", () => {
    const row = (id: string, status: string, retryOf: string | null = null) => ({
      id,
      state: "submitted",
      retry_of_answer_id: retryOf,
      scoring: { attempt_id: `t-${id}`, status },
    });

    it("counts once, however many times it was given again", () => {
      const read = { answers: [row("a", "ok"), row("b", "ok"), row("a2", "ok", "a"), row("a3", "ok", "a"), row("c", "pending")] };
      expect(scoringProgress(read)).toEqual({ done: 2, total: 3 });
    });

    it("is done only when the original and every retry have left pending", () => {
      const read = { answers: [row("a", "ok"), row("a2", "pending", "a"), row("b", "ok")] };
      expect(scoringProgress(read)).toEqual({ done: 1, total: 2 });
    });

    it("counts a failed original with a scored retry as done", () => {
      expect(scoringProgress({ answers: [row("a", "failed"), row("a2", "ok", "a")] })).toEqual({ done: 1, total: 1 });
    });

    it("leaves out a retry that was never submitted", () => {
      const read = { answers: [row("a", "ok"), { id: "a2", state: "transcribed", retry_of_answer_id: "a" }] };
      expect(scoringProgress(read)).toEqual({ done: 1, total: 1 });
    });
  });

  it.each([null, undefined, "", 4, {}, { answers: null }, { answers: {} }, { answers: [] }, { answers: [null, 3, { state: "open" }] }])(
    "reads nothing from %j",
    (read) => {
      expect(scoringProgress(read)).toBeNull();
    },
  );
});

describe("closingWait", () => {
  const copy = ROUND_COPY.en;

  it("is one running segment before anything is read", () => {
    expect(closingWait(copy, null)).toEqual({ sentence: copy.completing, segments: ["running"] });
  });

  it("says no rating is recorded when none is asked, before anything is read", () => {
    expect(closingWait(copy, null, false)).toEqual({ sentence: copy.retryingFindings, segments: ["running"] });
  });

  it("draws a segment per answer and one for the feedback while a score is pending", () => {
    expect(closingWait(copy, { done: 2, total: 4 })).toEqual({
      sentence: "Scoring your answers: 2 of 4 done.",
      segments: ["done", "done", "running", "running", "waiting"],
    });
  });

  it("runs the feedback's segment once no score is pending", () => {
    expect(closingWait(copy, { done: 3, total: 3 })).toEqual({
      sentence: copy.scoringFinished,
      segments: ["done", "done", "done", "running"],
    });
  });

  it("says the same in a Japanese round", () => {
    expect(closingWait(ROUND_COPY.ja, { done: 4, total: 6 }).sentence).toBe("回答を採点しています。6件中4件が終わりました。");
  });
});
