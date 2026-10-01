import { describe, expect, it } from "vitest";
import { roundStatus, tokyoDay } from "./status";

// 11 §3.15, the parts that are the rule itself. The day is Asia/Tokyo's, whatever the server's zone.
describe("roundStatus", () => {
  const today = { newerRoundExists: false, now: new Date("2026-09-30T05:00:00Z") };

  it("is complete once completed_at is set, even with a newer round", () => {
    const round = { startedAt: new Date("2026-09-30T01:00:00Z"), completedAt: new Date("2026-09-30T01:40:00Z") };
    expect(roundStatus(round, { ...today, newerRoundExists: true })).toBe("complete");
  });

  it("is in progress for the newest open round started today", () => {
    expect(roundStatus({ startedAt: new Date("2026-09-30T01:00:00Z"), completedAt: null }, today)).toBe("in_progress");
  });

  it("is abandoned once a newer round has started", () => {
    const round = { startedAt: new Date("2026-09-30T01:00:00Z"), completedAt: null };
    expect(roundStatus(round, { ...today, newerRoundExists: true })).toBe("abandoned");
  });

  it("is abandoned at 00:10 JST for a round started at 23:50 JST the day before", () => {
    const round = { startedAt: new Date("2026-09-29T14:50:00Z"), completedAt: null };
    expect(roundStatus(round, { newerRoundExists: false, now: new Date("2026-09-29T14:59:00Z") })).toBe("in_progress");
    expect(roundStatus(round, { newerRoundExists: false, now: new Date("2026-09-29T15:10:00Z") })).toBe("abandoned");
  });

  it("uses Tokyo's day, not UTC's: 15:00 UTC is midnight in Tokyo", () => {
    expect(tokyoDay(new Date("2026-09-29T15:00:00Z"))).toBe("2026-09-30");
    expect(tokyoDay(new Date("2026-09-29T14:59:59Z"))).toBe("2026-09-29");
  });
});
