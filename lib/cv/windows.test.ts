import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { characterLength } from "./spans";
import { planWindows, type ExtractionWindow } from "./windows";

// The synthetic sets #29 was measured on: an invented applicant and invented companies, never a real
// CV. The English one is shaped like the CV that lost its PROJECTS block (#27).
const fixture = (name: string) =>
  readFileSync(join(import.meta.dirname, "test", name), "utf8").replace(/\n$/u, "");
const EN = [fixture("synthetic-en-cv.txt")];
const JA = [fixture("synthetic-ja-rirekisho.txt"), fixture("synthetic-ja-shokumu.txt")];

const slice = (texts: readonly string[], window: ExtractionWindow) =>
  Array.from(texts[window.document]).slice(window.start, window.end).join("");

// Each document's windows, joined, are the document: nothing unread, nothing read twice, no window
// reaching into the next document.
function expectExactCover(texts: readonly string[], windows: readonly ExtractionWindow[]) {
  texts.forEach((text, document) => {
    const own = windows.filter((window) => window.document === document);
    expect(own.length).toBeGreaterThan(0);
    expect(own[0].start).toBe(0);
    own.slice(1).forEach((window, index) => expect(window.start).toBe(own[index].end));
    expect(own.at(-1)!.end).toBe(characterLength(text));
    expect(own.map((window) => slice(texts, window)).join("")).toBe(text);
  });
}

describe("planWindows", () => {
  it("gives a document at or under the target one window covering it whole", () => {
    expect(planWindows(["Led a team of 5.", "学歴\n\n職歴"], 100)).toEqual([
      { document: 0, start: 0, end: 16 },
      { document: 1, start: 0, end: 6 },
    ]);
  });

  it("cuts at blank lines, each later window starting on the paragraph's first line", () => {
    const text = ["AAAA", "", "BBBB", "", "", "CCCC"].join("\n");
    const windows = planWindows([text], 8);
    expect(windows.map((window) => slice([text], window))).toEqual(["AAAA\n\n", "BBBB\n\n\n", "CCCC"]);
    expectExactCover([text], windows);
  });

  it("packs paragraphs into a window up to the target and never past it", () => {
    const text = ["AA", "", "BB", "", "CCCCCC", "", "DD"].join("\n");
    const windows = planWindows([text], 10);
    expect(windows.map((window) => slice([text], window))).toEqual(["AA\n\nBB\n\n", "CCCCCC\n\nDD"]);
    for (const window of windows) expect(window.end - window.start).toBeLessThanOrEqual(10);
  });

  it("never cuts inside a paragraph: one longer than the target, line-wrapped as PDF text is, is one window", () => {
    const line = "Led the migration of the billing platform to a new ledger service, ";
    const text = Array.from({ length: 70 }, () => line).join("\n");
    expect(characterLength(text)).toBeGreaterThan(4_000);
    const windows = planWindows([text]);
    expect(windows).toEqual([{ document: 0, start: 0, end: characterLength(text) }]);
  });

  it("gives an over-long paragraph a window of its own and keeps packing whole paragraphs around it", () => {
    const long = ["x".repeat(15), "y".repeat(15)].join("\n");
    const text = ["AA", "", long, "", "BBBB", "", "CCCC"].join("\n");
    const windows = planWindows([text], 12);
    expect(windows.map((window) => slice([text], window))).toEqual(["AA\n\n", `${long}\n\n`, "BBBB\n\nCCCC"]);
    expectExactCover([text], windows);
  });

  it("joins a short last window to the one before it", () => {
    const text = ["A".repeat(10), "", "B".repeat(10), "", "C"].join("\n");
    const windows = planWindows([text], 12);
    expect(windows.map((window) => slice([text], window))).toEqual([`${"A".repeat(10)}\n\n`, `${"B".repeat(10)}\n\nC`]);
  });

  it("never crosses a document, and counts in code points", () => {
    const texts = ["𠮷".repeat(6), "𠮷𠮷\n\n𠮷𠮷\n\n𠮷𠮷"];
    const windows = planWindows(texts, 4);
    expect(windows).toEqual([
      { document: 0, start: 0, end: 6 },
      { document: 1, start: 0, end: 4 },
      { document: 1, start: 4, end: 8 },
      { document: 1, start: 8, end: 10 },
    ]);
    expectExactCover(texts, windows);
  });

  it("is deterministic: the same set always gets the same windows", () => {
    expect(planWindows(EN)).toEqual(planWindows(EN));
  });

  // The measured shape (#29): the late, dense PROJECTS block is a window of its own, which is what
  // made the windowed reading return it at sentence level instead of as seven lumps.
  it("gives the synthetic English CV's PROJECTS block a window of its own", () => {
    const windows = planWindows(EN);
    expectExactCover(EN, windows);
    const projects = windows.find((window) => slice(EN, window).startsWith("PROJECTS\n"));
    expect(projects).toBeDefined();
    expect(slice(EN, projects!)).not.toContain("EDUCATION\n");
    expect(windows.length).toBeGreaterThan(1);
  });

  it("gives each document of the synthetic 応募書類 its own window", () => {
    const windows = planWindows(JA);
    expect(windows.map((window) => window.document)).toEqual([0, 1]);
    expectExactCover(JA, windows);
  });
});
