/**
 * The user's week: Monday 00:00 to Monday 00:00 in Asia/Tokyo, as "today" is the user's local day
 * (06, 2026-09-28 and #55). Japan keeps no daylight saving, so Tokyo is a fixed nine hours ahead of
 * UTC and the arithmetic needs no time-zone database.
 */

const TOKYO_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface Week {
  readonly start: Date;
  readonly end: Date;
}

/** Monday 00:00 in Tokyo of the week `now` falls in. */
export function tokyoWeekStart(now: Date): Date {
  // A Date whose UTC fields read as Tokyo's wall clock.
  const wall = new Date(now.getTime() + TOKYO_OFFSET_MS);
  const daysSinceMonday = (wall.getUTCDay() + 6) % 7;
  const mondayWall = Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate() - daysSinceMonday);
  return new Date(mondayWall - TOKYO_OFFSET_MS);
}

/** This week so far: Monday 00:00 in Tokyo up to `now`. What the spend signal reads. */
export function weekToDate(now: Date): Week {
  return { start: tokyoWeekStart(now), end: now };
}

/** The whole week before the one `now` falls in. What the weekly digest reports. */
export function previousWeek(now: Date): Week {
  const end = tokyoWeekStart(now);
  return { start: new Date(end.getTime() - 7 * DAY_MS), end };
}

/** `2026-09-30 04:12`, in Tokyo, 24-hour. */
export function tokyoDateTime(date: Date): string {
  return new Date(date.getTime() + TOKYO_OFFSET_MS).toISOString().slice(0, 16).replace("T", " ");
}

/** `2026-09-30`, in Tokyo. */
export function tokyoDate(date: Date): string {
  return tokyoDateTime(date).slice(0, 10);
}
