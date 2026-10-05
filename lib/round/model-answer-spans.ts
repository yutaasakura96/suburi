import type { ModelAnswerText } from "../ai/model-answer";
import type { Span } from "../cv/spans";
import { locateUnsupported } from "./grounding";
import { unsupportedFigureSpans } from "./model-answer-figures";

export function locatedModelAnswer(text: ModelAnswerText, cv: string, own: string) {
  const { spans, dropped } = locateUnsupported(text.answer, text.unsupported);
  const merged: Span[] = [];
  for (const span of [...spans, ...unsupportedFigureSpans(text.answer, cv, own)].sort((a, b) => a.start - b.start)) {
    const last = merged.at(-1);
    if (last && span.start <= last.end) merged[merged.length - 1] = { start: last.start, end: Math.max(last.end, span.end) };
    else merged.push(span);
  }
  return { body: text.answer, spans: merged, dropped };
}
