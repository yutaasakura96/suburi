import { describe, expect, it } from "vitest";
import { bankSupply } from "./bank-supply";
import { countCandidates, planQuestions, shortfallOf, type Candidate } from "./select-questions";

// 11 §3.13, the decision rule without a database; the integration test runs it through the route.
const piece = (id: string, seen = false): Candidate => ({ id, origin: "set_piece", seen });
const generated = (id: string, seen = false): Candidate => ({ id, origin: "generated", seen });

describe("planQuestions, realistic", () => {
  it("takes at most one set piece, and only an unseen one, then unseen generated questions", () => {
    const candidates = [piece("s1"), piece("s2"), generated("g1"), generated("g2"), generated("g3")];
    expect(planQuestions(candidates, "realistic", 3)).toEqual({ chosen: ["s1", "g1", "g2"], shortfall: 0, reserve: [] });
  });

  it("skips a seen set piece", () => {
    const candidates = [piece("s1", true), piece("s2"), generated("g1"), generated("g2")];
    expect(planQuestions(candidates, "realistic", 3).chosen).toEqual(["s2", "g1", "g2"]);
  });

  it("takes no set piece when every one is seen", () => {
    const candidates = [piece("s1", true), generated("g1"), generated("g2"), generated("g3")];
    expect(planQuestions(candidates, "realistic", 3).chosen).toEqual(["g1", "g2", "g3"]);
  });

  it("generates when the unseen pool cannot fill the round, and keeps seen questions in reserve", () => {
    const candidates = [generated("g1", true), generated("g2"), generated("g3", true), generated("g4")];
    expect(planQuestions(candidates, "realistic", 3)).toEqual({ chosen: ["g2", "g4"], shortfall: 1, reserve: ["g1", "g3"] });
  });

  it("generates nothing when the unseen pool fills the round", () => {
    const candidates = [generated("g1", true), generated("g2"), generated("g3"), generated("g4")];
    expect(planQuestions(candidates, "realistic", 3)).toEqual({ chosen: ["g2", "g3", "g4"], shortfall: 0, reserve: ["g1"] });
  });

  it("never counts a second set piece toward the round", () => {
    expect(planQuestions([piece("s1"), piece("s2"), generated("g1")], "realistic", 3)).toEqual({
      chosen: ["s1", "g1"],
      shortfall: 1,
      reserve: [],
    });
  });

  it("generates the whole round from an empty bank", () => {
    expect(planQuestions([], "realistic", 5)).toEqual({ chosen: [], shortfall: 5, reserve: [] });
  });
});

describe("planQuestions, practice", () => {
  it("prefers seen questions, falls back to unseen ones, and takes no set piece", () => {
    const candidates = [piece("s1"), generated("g1"), generated("g2", true), generated("g3")];
    expect(planQuestions(candidates, "practice", 3)).toEqual({ chosen: ["g2", "g1", "g3"], shortfall: 0, reserve: [] });
  });

  it("leaves the unseen pool alone when seen questions fill the round", () => {
    const candidates = [generated("g1"), generated("g2", true), generated("g3", true), generated("g4", true)];
    expect(planQuestions(candidates, "practice", 3).chosen).toEqual(["g2", "g3", "g4"]);
  });

  it("generates what the bank cannot give, and has no reserve", () => {
    expect(planQuestions([piece("s1"), generated("g1", true)], "practice", 3)).toEqual({ chosen: ["g1"], shortfall: 2, reserve: [] });
  });
});

describe("Setup's warning reads the same rule", () => {
  const banks: Candidate[][] = [
    [],
    [piece("s1"), piece("s2"), generated("g1")],
    [piece("s1", true), generated("g1", true), generated("g2"), generated("g3", true)],
    [generated("g1"), generated("g2"), generated("g3"), generated("g4"), generated("g5", true)],
  ];

  it.each(["realistic", "practice"] as const)("shortfallOf agrees with planQuestions in %s", (mode) => {
    for (const candidates of banks) {
      for (const length of [3, 5, 7]) {
        expect(shortfallOf(countCandidates(candidates), mode, length)).toBe(planQuestions(candidates, mode, length).shortfall);
      }
    }
  });

  it("counts one set piece at most, and no seen question, as realistic supply", () => {
    expect(bankSupply({ unseenSetPieces: 3, unseenGenerated: 2, seenGenerated: 9 }, "realistic")).toBe(3);
    expect(bankSupply({ unseenSetPieces: 3, unseenGenerated: 2, seenGenerated: 9 }, "practice")).toBe(11);
  });
});
