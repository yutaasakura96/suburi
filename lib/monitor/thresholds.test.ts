import { describe, expect, it } from "vitest";
import {
  ANY,
  PENDING_SCORE_MAX_HOURS,
  ROUND_COST_BASELINE_USD,
  ROUND_FEEDBACK_MAX_HOURS,
  SELF_CHECK_STALE_HOURS,
  SPEND_MULTIPLE,
  UNCLAIMED_RUN_MAX_CODE_POINTS,
  isOlderThan,
  isRed,
  isStale,
  spendThresholdUsd,
} from "./thresholds";

// 11 §3.17: every 12 §6 threshold, at, below and above it.

const NOW = new Date("2026-09-30T19:00:00Z");
const MINUTE = 60 * 1000;
const hoursAgo = (hours: number, plusMinutes = 0) => new Date(NOW.getTime() - hours * 60 * MINUTE + plusMinutes * MINUTE);

describe("the constants are 12 §6's", () => {
  it("names each value", () => {
    expect(PENDING_SCORE_MAX_HOURS).toBe(24);
    expect(ROUND_FEEDBACK_MAX_HOURS).toBe(24);
    expect(SELF_CHECK_STALE_HOURS).toBe(48);
    expect(UNCLAIMED_RUN_MAX_CODE_POINTS).toBe(2_000);
    expect(ANY).toBe(0);
    expect(ROUND_COST_BASELINE_USD).toBe(0.4);
    expect(SPEND_MULTIPLE).toBe(3);
  });
});

describe.each([
  ["pending score", PENDING_SCORE_MAX_HOURS],
  ["round without feedback", ROUND_FEEDBACK_MAX_HOURS],
])("%s age, %i hours", (_, hours) => {
  it("is not over the limit a minute below it", () => {
    expect(isOlderThan(hoursAgo(hours, 1), NOW, hours)).toBe(false);
  });
  it("is not over the limit exactly at it", () => {
    expect(isOlderThan(hoursAgo(hours), NOW, hours)).toBe(false);
  });
  it("is over the limit a minute above it", () => {
    expect(isOlderThan(hoursAgo(hours, -1), NOW, hours)).toBe(true);
  });
});

describe("self-check staleness, 48 hours", () => {
  it("is fresh below it", () => expect(isStale(hoursAgo(47), NOW)).toBe(false));
  it("is fresh exactly at it", () => expect(isStale(hoursAgo(48), NOW)).toBe(false));
  it("is stale above it", () => expect(isStale(hoursAgo(48, -1), NOW)).toBe(true));
  it("is stale when it has never run", () => expect(isStale(null, NOW)).toBe(true));
});

describe("an 'any' row: red above zero", () => {
  it("is not red at zero", () => expect(isRed(0, ANY)).toBe(false));
  it("is red at one", () => expect(isRed(1, ANY)).toBe(true));
  it("is never red below zero either", () => expect(isRed(-1, ANY)).toBe(false));
  it("is not red with no reading — null is not zero, and not a pass either", () => expect(isRed(null, ANY)).toBe(false));
});

describe("unclaimed_run_max, 2,000 code points", () => {
  it("is not red below it", () => expect(isRed(1_999, UNCLAIMED_RUN_MAX_CODE_POINTS)).toBe(false));
  it("is not red at it", () => expect(isRed(2_000, UNCLAIMED_RUN_MAX_CODE_POINTS)).toBe(false));
  it("is red above it", () => expect(isRed(2_001, UNCLAIMED_RUN_MAX_CODE_POINTS)).toBe(true));
});

describe("week-to-date spend: 3 × $0.40 × max(1, rounds started)", () => {
  it("floors at one round, so a week with no round started is $1.20", () => {
    expect(spendThresholdUsd(0)).toBe(1.2);
    expect(spendThresholdUsd(1)).toBe(1.2);
  });
  it("scales with rounds started", () => {
    expect(spendThresholdUsd(2)).toBe(2.4);
    expect(spendThresholdUsd(8)).toBe(9.6);
  });
  it("is not red a cent below it", () => expect(isRed(1.19, spendThresholdUsd(0))).toBe(false));
  it("is not red at it", () => expect(isRed(1.2, spendThresholdUsd(0))).toBe(false));
  it("is red a cent above it", () => expect(isRed(1.21, spendThresholdUsd(0))).toBe(true));
  it("is not red at it, with rounds started", () => expect(isRed(2.4, spendThresholdUsd(2))).toBe(false));
  it("is red above it, with rounds started", () => expect(isRed(2.400001, spendThresholdUsd(2))).toBe(true));
});
