import { describe, expect, it } from "vitest";
import { ROUND_TYPES } from "../../db/schema";
import { checkEmbeddings } from "./embed";
import { GENERATOR_PROMPT_VERSIONS, checkQuestions, renderGenerationInput, tidyQuestion } from "./generate-questions";
import { EMBEDDING_DIMENSIONS } from "./models";
import { MAX_QUESTION_ENGLISH_CODE_POINTS } from "./translate-question";
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
  const written = (...questions: string[]) => questions.map((question) => ({ question, english: null }));
  const texts = (questions: readonly { text: string }[]) => questions.map((question) => question.text);

  it("tidies each question: whitespace runs collapsed, ends trimmed", () => {
    expect(tidyQuestion("  Tell me\n about\ta time…  ")).toBe("Tell me about a time…");
    expect(texts(checkQuestions("en", 2, written(" One?\n", "Two  ?")))).toEqual(["One?", "Two ?"]);
  });

  it("drops blanks and repeats, and cuts to the count asked for", () => {
    expect(texts(checkQuestions("en", 2, written("One?", "", "  ", "One?", "Two?", "Three?")))).toEqual(["One?", "Two?"]);
  });

  it("returns fewer than asked rather than failing: the caller decides what a short list means", () => {
    expect(texts(checkQuestions("en", 5, written("One?")))).toEqual(["One?"]);
  });

  it("is malformed_output when nothing usable came back", () => {
    expect(malformed(() => checkQuestions("en", 3, []))).toBe("malformed_output");
    expect(malformed(() => checkQuestions("en", 3, written("", "  ")))).toBe("malformed_output");
  });

  it("gives an English round's questions no English and no drop", () => {
    expect(checkQuestions("en", 1, [{ question: "One?", english: "ignored" }])).toEqual([{ text: "One?", english: null, englishDropped: null }]);
  });

  // 11 §3.25: a missing or malformed English drops the English, never the question (Q106-4).
  it("keeps a Japanese question whose English is missing or malformed, and names the drop", () => {
    const checked = checkQuestions("ja", 4, [
      { question: "一つ目の質問を教えてください。", english: "  Please tell us\n about the first.  " },
      { question: "二つ目の質問を教えてください。", english: null },
      { question: "三つ目の質問を教えてください。", english: "   " },
      { question: "四つ目の質問を教えてください。", english: "x".repeat(MAX_QUESTION_ENGLISH_CODE_POINTS + 1) },
    ]);
    expect(checked).toEqual([
      { text: "一つ目の質問を教えてください。", english: "Please tell us about the first.", englishDropped: null },
      { text: "二つ目の質問を教えてください。", english: null, englishDropped: "english_missing" },
      { text: "三つ目の質問を教えてください。", english: null, englishDropped: "english_missing" },
      { text: "四つ目の質問を教えてください。", english: null, englishDropped: "english_malformed" },
    ]);
  });

  it("keeps a repeat's first English, with its question", () => {
    expect(
      checkQuestions("ja", 2, [
        { question: "同じ質問ですか。", english: "The first English?" },
        { question: "同じ質問ですか。", english: "The second English?" },
      ]),
    ).toEqual([{ text: "同じ質問ですか。", english: "The first English?", englishDropped: null }]);
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
