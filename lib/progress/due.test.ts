import { describe, expect, it } from "vitest";
import { dueDefaults, dueList, nothingPractised, type LastPractised } from "./due";

// 10 §1's sample: 行動面接・日本語 18 days ago, HR・English 11, 技術面接・日本語 6.
const NOW = new Date("2026-09-30T03:00:00.000Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000);
const SAMPLE: LastPractised = [
  { roundType: "technical", language: "ja", startedAt: daysAgo(6) },
  { roundType: "behavioural", language: "ja", startedAt: daysAgo(18) },
  { roundType: "hr", language: "en", startedAt: daysAgo(11) },
];

describe("dueList (10 §1)", () => {
  it("lists every round type in both languages", () => {
    expect(dueList(SAMPLE, NOW)).toHaveLength(8);
  });

  it("puts never-practised pairs first, with no interval and no bar", () => {
    const rows = dueList(SAMPLE, NOW);
    const never = rows.slice(0, 5);
    expect(never.map((row) => `${row.roundType}/${row.language}`)).toEqual([
      "behavioural/en",
      "technical/en",
      "hr/ja",
      "ceo/ja",
      "ceo/en",
    ]);
    expect(never.every((row) => row.days === null && row.share === null && row.urgency === "never")).toBe(true);
  });

  it("then lists the rest most overdue first, each bar a share of the longest interval", () => {
    const practised = dueList(SAMPLE, NOW).slice(5);
    expect(practised.map((row) => [row.roundType, row.language, row.days, row.urgency])).toEqual([
      ["behavioural", "ja", 18, "most"],
      ["hr", "en", 11, "mid"],
      ["technical", "ja", 6, "least"],
    ]);
    expect(practised.map((row) => Math.round(row.share! * 100))).toEqual([100, 61, 33]);
  });

  it("counts days as the Asia/Tokyo calendar counts them", () => {
    // 23:30 on the 29th in Tokyo, read at 00:30 on the 30th: one day, an hour apart.
    const last = [{ roundType: "hr", language: "en", startedAt: new Date("2026-09-29T14:30:00.000Z") }] as const;
    const [row] = dueList(last, new Date("2026-09-29T15:30:00.000Z")).slice(-1);
    expect(row.days).toBe(1);
  });

  it("reads a pair practised today as zero days, with an empty bar", () => {
    const [row] = dueList([{ roundType: "hr", language: "en", startedAt: NOW }], NOW).slice(-1);
    expect(row).toMatchObject({ days: 0, share: 0, urgency: "least" });
  });

  it("never reads a round started after `now` as a negative interval", () => {
    const [row] = dueList([{ roundType: "hr", language: "en", startedAt: daysAgo(-2) }], NOW).slice(-1);
    expect(row.days).toBe(0);
  });

  it("keeps the listed order between equal intervals", () => {
    const last = [
      { roundType: "ceo", language: "en", startedAt: daysAgo(4) },
      { roundType: "behavioural", language: "ja", startedAt: daysAgo(4) },
    ] as const;
    expect(dueList(last, NOW).slice(-2).map((row) => row.roundType)).toEqual(["behavioural", "ceo"]);
  });
});

describe("nothingPractised", () => {
  it("is true only with no realistic round completed", () => {
    expect(nothingPractised(dueList([], NOW))).toBe(true);
    expect(nothingPractised(dueList(SAMPLE, NOW))).toBe(false);
  });
});

describe("dueDefaults (10 §2)", () => {
  it("starts from 10 §2's defaults when nothing has been practised", () => {
    expect(dueDefaults(dueList([], NOW))).toEqual({
      roundType: "behavioural",
      language: "ja",
      length: 5,
      mode: "realistic",
      reason: { kind: "nothing" },
    });
  });

  it("takes the first never-practised pair once something has been", () => {
    expect(dueDefaults(dueList(SAMPLE, NOW))).toMatchObject({ roundType: "behavioural", language: "en", reason: { kind: "never" } });
  });

  it("takes the most overdue pair once every pair has been practised", () => {
    const all = dueList([], NOW).map((row, index) => ({ roundType: row.roundType, language: row.language, startedAt: daysAgo(index + 1) }));
    expect(dueDefaults(dueList(all, NOW))).toMatchObject({ roundType: "ceo", language: "en", reason: { kind: "interval", days: 8 } });
  });
});
