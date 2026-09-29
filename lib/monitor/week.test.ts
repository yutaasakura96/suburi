import { describe, expect, it } from "vitest";
import { previousWeek, tokyoDate, tokyoDateTime, tokyoWeekStart, weekToDate } from "./week";

// The user's week: Monday 00:00 in Asia/Tokyo, which is Sunday 15:00 UTC (06, #55).

describe("tokyoWeekStart", () => {
  it("is Monday 00:00 in Tokyo for a Wednesday", () => {
    // Wednesday 2026-09-30 13:00 in Tokyo.
    expect(tokyoWeekStart(new Date("2026-09-30T04:00:00Z")).toISOString()).toBe("2026-09-27T15:00:00.000Z");
  });

  it("puts Monday 00:00 in Tokyo in its own week", () => {
    expect(tokyoWeekStart(new Date("2026-09-27T15:00:00Z")).toISOString()).toBe("2026-09-27T15:00:00.000Z");
  });

  it("puts a minute before Monday in Tokyo in the week before, though it is already Sunday afternoon in UTC", () => {
    expect(tokyoWeekStart(new Date("2026-09-27T14:59:00Z")).toISOString()).toBe("2026-09-20T15:00:00.000Z");
  });

  it("puts Sunday evening UTC, which is Monday in Tokyo, in the new week", () => {
    expect(tokyoWeekStart(new Date("2026-09-27T20:30:00Z")).toISOString()).toBe("2026-09-27T15:00:00.000Z");
  });

  it("crosses a month and a year", () => {
    // Friday 2027-01-01 in Tokyo; its Monday is 2026-12-28.
    expect(tokyoWeekStart(new Date("2027-01-01T03:00:00Z")).toISOString()).toBe("2026-12-27T15:00:00.000Z");
  });
});

describe("the windows", () => {
  const now = new Date("2026-09-27T20:30:00Z"); // Monday 05:30 in Tokyo, when the digest runs

  it("week-to-date runs from Monday 00:00 in Tokyo to now", () => {
    expect(weekToDate(now)).toEqual({ start: new Date("2026-09-27T15:00:00Z"), end: now });
  });

  it("the digest's week is the whole week that just ended", () => {
    expect(previousWeek(now)).toEqual({
      start: new Date("2026-09-20T15:00:00Z"),
      end: new Date("2026-09-27T15:00:00Z"),
    });
  });
});

describe("Tokyo display", () => {
  it("shows the Tokyo wall clock, 24-hour", () => {
    expect(tokyoDateTime(new Date("2026-09-30T19:12:40Z"))).toBe("2026-10-01 04:12");
    expect(tokyoDate(new Date("2026-09-30T19:12:40Z"))).toBe("2026-10-01");
  });
});
