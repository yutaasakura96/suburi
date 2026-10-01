import { describe, expect, it } from "vitest";
import { chooseQuestions, type Candidate } from "./select-questions";

// 11 §3.13, the decision rule without a database; the integration test runs it through the route.
const piece = (id: string, seen = false): Candidate => ({ id, origin: "set_piece", seen });
const generated = (id: string, seen = false): Candidate => ({ id, origin: "generated", seen });

describe("chooseQuestions, realistic", () => {
  it("takes at most one set piece, and only an unseen one, then unseen generated questions", () => {
    const candidates = [piece("s1"), piece("s2"), generated("g1"), generated("g2"), generated("g3")];
    expect(chooseQuestions(candidates, "realistic", 3)).toEqual(["s1", "g1", "g2"]);
  });

  it("skips a seen set piece", () => {
    const candidates = [piece("s1", true), piece("s2"), generated("g1"), generated("g2")];
    expect(chooseQuestions(candidates, "realistic", 3)).toEqual(["s2", "g1", "g2"]);
  });

  it("takes no set piece when every one is seen", () => {
    const candidates = [piece("s1", true), generated("g1"), generated("g2"), generated("g3")];
    expect(chooseQuestions(candidates, "realistic", 3)).toEqual(["g1", "g2", "g3"]);
  });

  it("puts unseen generated questions before seen ones", () => {
    const candidates = [generated("g1", true), generated("g2"), generated("g3", true), generated("g4")];
    expect(chooseQuestions(candidates, "realistic", 3)).toEqual(["g2", "g4", "g1"]);
  });

  it("is null when the bank cannot fill the round", () => {
    expect(chooseQuestions([piece("s1"), piece("s2"), generated("g1")], "realistic", 3)).toBeNull();
  });
});

describe("chooseQuestions, practice", () => {
  it("prefers seen questions, falls back to unseen ones, and takes no set piece", () => {
    const candidates = [piece("s1"), generated("g1"), generated("g2", true), generated("g3")];
    expect(chooseQuestions(candidates, "practice", 3)).toEqual(["g2", "g1", "g3"]);
  });
});
