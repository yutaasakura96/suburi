import { describe, expect, it } from "vitest";
import { RUBRICS } from "../rubric/index";
import { FIXTURE_MODEL_ANSWER, FIXTURE_MODEL_ANSWER_JA } from "./fake-round-ports";
import {
  MAX_MODEL_ANSWER_CODE_POINTS,
  checkModelAnswer,
  openAiModelAnswerGenerator,
  renderModelAnswerInput,
  type ModelAnswerInput,
} from "./model-answer";
import { MODEL_ANSWER_MODEL } from "./models";
import { ModelCallFailed } from "./upstream";

const ja = RUBRICS.find((rubric) => rubric.language === "ja")!;
const en = RUBRICS.find((rubric) => rubric.language === "en")!;

function refused(check: () => void) {
  try {
    check();
  } catch (error) {
    return error instanceof ModelCallFailed ? error.errorClass : "unexpected";
  }
  return null;
}

// 04 `model_answers`: the model and the prompt that wrote a row are stamped on it.
describe("the model-answer port's stamps", () => {
  it("names the pinned model and a prompt per language", () => {
    const generator = openAiModelAnswerGenerator({ apiKey: "not-a-real-key" });
    expect(generator.modelId).toBe(MODEL_ANSWER_MODEL);
    expect(generator.promptVersions).toEqual({ en: "model-answer-en-1.0", ja: "model-answer-ja-1.0" });
  });
});

// 07 §5.12: a model answer is written whole or not at all.
describe("checkModelAnswer", () => {
  it("accepts an English round's answer without a translation, and trims it", () => {
    const checked = checkModelAnswer({ ...FIXTURE_MODEL_ANSWER, answer: `\n${FIXTURE_MODEL_ANSWER.answer}  ` }, "en");
    expect(checked.answer).toBe(FIXTURE_MODEL_ANSWER.answer);
    expect(checked.translated).toBeNull();
    expect(checked.unsupported).toEqual(FIXTURE_MODEL_ANSWER.unsupported);
  });

  it("drops a translation an English round was not asked for", () => {
    const translated = { answer: "Une réponse.", unsupported: [] };
    expect(checkModelAnswer({ ...FIXTURE_MODEL_ANSWER, translated }, "en").translated).toBeNull();
  });

  it("accepts a Japanese round's answer with its translation, and trims both", () => {
    const translated = { ...FIXTURE_MODEL_ANSWER_JA.translated!, answer: ` ${FIXTURE_MODEL_ANSWER_JA.translated!.answer}\n` };
    const checked = checkModelAnswer({ ...FIXTURE_MODEL_ANSWER_JA, translated }, "ja");
    expect(checked.answer).toBe(FIXTURE_MODEL_ANSWER_JA.answer);
    expect(checked.translated).toEqual(FIXTURE_MODEL_ANSWER_JA.translated);
  });

  it("refuses a Japanese round's answer with no translation", () => {
    expect(refused(() => checkModelAnswer({ ...FIXTURE_MODEL_ANSWER_JA, translated: null }, "ja"))).toBe("malformed_output");
  });

  it("refuses a blank answer and a blank translation", () => {
    expect(refused(() => checkModelAnswer({ ...FIXTURE_MODEL_ANSWER, answer: " \n" }, "en"))).toBe("malformed_output");
    const translated = { answer: "", unsupported: [] };
    expect(refused(() => checkModelAnswer({ ...FIXTURE_MODEL_ANSWER_JA, translated }, "ja"))).toBe("malformed_output");
  });

  it("refuses a runaway, counted in code points, and accepts one at the limit", () => {
    const atLimit = "𠮷".repeat(MAX_MODEL_ANSWER_CODE_POINTS);
    expect(refused(() => checkModelAnswer({ ...FIXTURE_MODEL_ANSWER, answer: atLimit }, "en"))).toBeNull();
    expect(refused(() => checkModelAnswer({ ...FIXTURE_MODEL_ANSWER, answer: `${atLimit}字` }, "en"))).toBe("malformed_output");
    const translated = { answer: `${atLimit}a`, unsupported: [] };
    expect(refused(() => checkModelAnswer({ ...FIXTURE_MODEL_ANSWER_JA, translated }, "ja"))).toBe("malformed_output");
  });
});

describe("renderModelAnswerInput", () => {
  const input: ModelAnswerInput = {
    rubric: en,
    roundType: "hr",
    roleContext: { kind: "general" },
    claims: ["Led the payments migration.", "Cut the nightly batch from four hours to ninety minutes."],
    prompt: "Tell me about a migration you led.",
    answer: "Um, I led the payments migration.",
    parent: null,
  };

  it("puts what a round's calls share first and the question last", () => {
    const rendered = renderModelAnswerInput(input);
    expect(rendered.match(/^=== .* ===$/gm)).toEqual([
      "=== interview ===",
      "=== role context ===",
      "=== rubric en v1.0 ===",
      "=== CV claims ===",
      "=== question ===",
      "=== candidate's answer ===",
    ]);
    expect(rendered).toContain("=== interview ===\nHR\n=== role context ===\ngeneral practice\n");
    expect(rendered).toContain("[1] Led the payments migration.\n[2] Cut the nightly batch");
    expect(rendered.endsWith("=== question ===\nTell me about a migration you led.\n=== candidate's answer ===\nUm, I led the payments migration.")).toBe(true);
  });

  it("gives every dimension's summary and its best anchor, and no score", () => {
    const rendered = renderModelAnswerInput(input);
    for (const dimension of en.dimensions) {
      expect(rendered).toContain(`- ${dimension.key} (${dimension.label_en}): ${dimension.definition.summary}`);
      expect(rendered).toContain(`  best: ${dimension.definition.anchors[4]}`);
    }
    expect(rendered).not.toMatch(/score/i);
  });

  it("names a Japanese rubric's dimensions in Japanese", () => {
    const rendered = renderModelAnswerInput({ ...input, rubric: ja });
    expect(rendered).toContain("=== rubric ja v1.0 ===");
    expect(rendered).toContain("- keigo (敬語): ");
  });

  it("gives a posting its company, role and body", () => {
    const rendered = renderModelAnswerInput({
      ...input,
      roleContext: { kind: "posting", companyName: "Tidewater", roleTitle: "Backend Engineer", body: "Own the routing services." },
    });
    expect(rendered).toContain("=== role context ===\ncompany: Tidewater\nrole: Backend Engineer\nposting:\nOwn the routing services.\n");
  });

  it("gives a follow-up the question it followed and that answer", () => {
    const rendered = renderModelAnswerInput({
      ...input,
      prompt: "How long did it take?",
      answer: "Six months.",
      parent: { prompt: input.prompt, answer: input.answer },
    });
    expect(rendered).toContain(
      "=== earlier in the interview ===\nquestion: Tell me about a migration you led.\nanswer:\nUm, I led the payments migration.\n=== follow-up question ===\nHow long did it take?\n=== candidate's answer ===\nSix months.",
    );
    expect(rendered).not.toContain("=== question ===");
  });
});
