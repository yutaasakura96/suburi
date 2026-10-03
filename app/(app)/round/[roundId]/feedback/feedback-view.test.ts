import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { FeedbackScreen } from "../../load";
import { FeedbackView } from "./feedback-view";

const screen: FeedbackScreen = {
  round: { id: "round-1", roundType: "hr", language: "ja", length: 1, date: "2026-10-03" },
  feltPressure: null,
  stamps: { rubricLabel: "v1.0", generatorVersions: [], cvLabel: "応募書類 v1" },
  answers: [],
  findings: { toFix: [{ title: "結論", body: "先に述べる" }], whatWorked: "具体例" },
  translated: null,
  grounding: null,
  findingsUnavailable: false,
};

describe("feedback reading language", () => {
  it("offers English only when stored findings have a translation", () => {
    const untranslated = renderToStaticMarkup(createElement(FeedbackView, { screen }));
    expect(untranslated).not.toContain('data-testid="feedback-language"');
    expect(untranslated).toContain("先に述べる");

    const translated = renderToStaticMarkup(
      createElement(FeedbackView, {
        screen: {
          ...screen,
          translated: { toFix: [{ title: "Conclusion", body: "State it first" }], whatWorked: "Example" },
        },
      }),
    );
    expect(translated).toContain('data-testid="feedback-language"');
    expect(translated).toContain("English");
  });
});
