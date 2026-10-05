import type { Span } from "../cv/spans";

const DIGIT = "[0-9０-９]";
const GROUPED = `${DIGIT}+(?:[,，]${DIGIT}{3}(?!${DIGIT}))*`;
const NUMBER = new RegExp(`${GROUPED}(?:[.．]${DIGIT}+)?`, "gu");
const NEXT_GROUP = new RegExp(`^(${GROUPED})(千)?(億|万)?`, "u");
const SLASH_BEFORE = new RegExp(`${DIGIT}[/／]$`, "u");
const SLASH_AFTER = new RegExp(`^[/／]${DIGIT}`, "u");
const RANGE = /^ ?(?:[〜~–-]|to) ?$/u;
const IDENTIFIER_AFTER = new RegExp(`^[a-zA-Z]+${DIGIT}`, "u");
const MAGNITUDES: Record<string, number> = {
  k: 1000, thousand: 1000, million: 1_000_000, billion: 1_000_000_000,
  千: 1000, 万: 10_000, 億: 100_000_000,
};

interface Figure {
  start: number;
  end: number;
  key: string;
  ranged: string;
  lead: number;
  factor: number;
  kind: string;
  bare: boolean;
  components: string[];
  slashed: boolean;
}

function value(digits: string): number {
  return Number(digits.normalize("NFKC").replaceAll(",", ""));
}

function scale(thousand?: string, unit?: string): number {
  return (thousand ? MAGNITUDES[thousand] : 1) * (unit ? MAGNITUDES[unit] : 1);
}

function key(number: number, kind: string): string {
  return `${Number(number.toPrecision(12))}:${kind}`;
}

function figures(text: string): Figure[] {
  const found: Figure[] = [];
  const pattern = new RegExp(NUMBER);
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    const start = match.index;
    const digitsEnd = start + match[0].length;
    const before = text.slice(Math.max(0, start - 2), start);
    const after = text.slice(digitsEnd);
    if (/[a-zA-Z]$/u.test(before) || IDENTIFIER_AFTER.test(after)) continue;

    let end = digitsEnd;
    const lead = value(match[0]);
    let number = lead;
    let factor = 1;
    const japanese = after.match(/^(千)?(億|万)?/u);
    if (japanese?.[0]) {
      factor = scale(japanese[1], japanese[2]);
      number *= factor;
      end += japanese[0].length;
      while (true) {
        const group = text.slice(end).match(NEXT_GROUP);
        if (!group) break;
        number += value(group[1]) * scale(group[2], group[3]);
        end += group[0].length;
        if (!group[2] && !group[3]) break;
      }
    } else {
      const english = after.match(/^(?:k(?![a-zA-Z])| ?(thousand|million|billion)\b)/iu);
      if (english) {
        factor = MAGNITUDES[(english[1] ?? "k").toLowerCase()];
        number *= factor;
        end += english[0].length;
      }
    }

    let kind = "plain";
    const suffix = text.slice(end).match(/^(?:%|％|パーセント| ?percent\b|x\b|×|倍)/iu);
    if (suffix) {
      kind = /percent|パーセント|%|％/iu.test(suffix[0]) ? "percent" : "multiple";
      end += suffix[0].length;
    }
    pattern.lastIndex = end;

    const bare = end === digitsEnd;
    const parts = match[0].normalize("NFKC").split(".");
    found.push({
      start,
      end,
      key: key(number, kind),
      ranged: key(number, kind),
      lead,
      factor,
      kind,
      bare,
      components: bare && parts.length > 1 ? parts.map((part) => `${value(part)}:plain`) : [],
      slashed: SLASH_BEFORE.test(before) || SLASH_AFTER.test(after),
    });
  }
  found.forEach((first, index) => {
    const last = found[index + 1];
    if (!last || !first.bare) return;
    if (!RANGE.test(text.slice(first.end, last.start).normalize("NFKC"))) return;
    first.ranged = key(first.lead * last.factor, last.kind);
  });
  return found;
}

export function unsupportedFigureSpans(answer: string, cv: string, own: string): Span[] {
  const supported = new Set(
    figures(`${cv}\n${own}`).flatMap((figure) => [figure.key, figure.ranged, ...figure.components]),
  );
  return figures(answer)
    .filter((figure) => !figure.slashed && !supported.has(figure.ranged))
    .map(({ start, end }) => ({
      start: Array.from(answer.slice(0, start)).length,
      end: Array.from(answer.slice(0, end)).length,
    }));
}
