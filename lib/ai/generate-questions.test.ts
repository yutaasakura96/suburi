import { describe, expect, it } from "vitest";
import { ROUND_TYPES } from "../../db/schema";
import { checkEmbeddings } from "./embed";
import { GENERATOR_PROMPT_VERSIONS, checkQuestions, renderGenerationInput, tidyQuestion } from "./generate-questions";
import { EMBEDDING_DIMENSIONS } from "./models";
import { ModelCallFailed } from "./upstream";

const malformed = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return error instanceof ModelCallFailed ? error.errorClass : "another error";
  }
  return "no error";
};

describe("the generator's prompts", () => {
  it("has one per round type and language, each named for its slice", () => {
    for (const language of ["en", "ja"] as const) {
      expect(Object.keys(GENERATOR_PROMPT_VERSIONS[language]).sort()).toEqual([...ROUND_TYPES].sort());
      for (const roundType of ROUND_TYPES) {
        expect(GENERATOR_PROMPT_VERSIONS[language][roundType]).toMatch(new RegExp(`^generate-${roundType}-${language}-\\d+\\.\\d+$`));
      }
    }
  });
});

describe("checkQuestions", () => {
  it("tidies each question: whitespace runs collapsed, ends trimmed", () => {
    expect(tidyQuestion("  Tell me\n about\ta time…  ")).toBe("Tell me about a time…");
    expect(checkQuestions(2, [" One?\n", "Two  ?"])).toEqual(["One?", "Two ?"]);
  });

  it("drops blanks and repeats, and cuts to the count asked for", () => {
    expect(checkQuestions(2, ["One?", "", "  ", "One?", "Two?", "Three?"])).toEqual(["One?", "Two?"]);
  });

  it("returns fewer than asked rather than failing: the caller decides what a short list means", () => {
    expect(checkQuestions(5, ["One?"])).toEqual(["One?"]);
  });

  it("is malformed_output when nothing usable came back", () => {
    expect(malformed(() => checkQuestions(3, []))).toBe("malformed_output");
    expect(malformed(() => checkQuestions(3, ["", "  "]))).toBe("malformed_output");
  });
});

describe("renderGenerationInput", () => {
  const input = {
    language: "en",
    roundType: "behavioural",
    count: 4,
    claims: ["Cut invoice processing by 40%", "Led a team of five"],
    existing: ["Tell me about a conflict."],
  } as const;

  it("lays out the count, a posting with its company and role, the claims and the bank", () => {
    expect(
      renderGenerationInput({ ...input, roleContext: { kind: "posting", companyName: "Invented Freight", roleTitle: "Backend Engineer", body: "We route freight." } }),
    ).toBe(
      [
        "=== questions needed ===",
        "4",
        "=== role context ===",
        "company: Invented Freight",
        "role: Backend Engineer",
        "posting:",
        "We route freight.",
        "=== cv claims ===",
        "- Cut invoice processing by 40%",
        "- Led a team of five",
        "=== questions already in the bank ===",
        "- Tell me about a conflict.",
      ].join("\n"),
    );
  });

  it("says General practice in so many words, and marks an empty list as none", () => {
    const rendered = renderGenerationInput({ ...input, roleContext: { kind: "general" }, claims: [], existing: [] });
    expect(rendered).toContain("=== role context ===\ngeneral practice\n");
    expect(rendered).toContain("=== cv claims ===\n(none)\n");
    expect(rendered.endsWith("=== questions already in the bank ===\n(none)")).toBe(true);
  });
});

describe("checkEmbeddings", () => {
  const vector = (fill = 0.1) => Array.from({ length: EMBEDDING_DIMENSIONS }, () => fill);

  it("passes one vector per text, each of the pinned dimension", () => {
    const vectors = [vector(), vector(0.2)];
    expect(checkEmbeddings(2, vectors)).toBe(vectors);
  });

  it("is malformed_output for a missing vector, a wrong dimension or a component that is not a number", () => {
    expect(malformed(() => checkEmbeddings(2, [vector()]))).toBe("malformed_output");
    expect(malformed(() => checkEmbeddings(1, [vector().slice(1)]))).toBe("malformed_output");
    expect(malformed(() => checkEmbeddings(1, [[...vector().slice(1), Number.NaN]]))).toBe("malformed_output");
  });
});
