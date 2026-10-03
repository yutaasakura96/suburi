import { describe, expect, it } from "vitest";
import { vectorNear } from "../ai/fake-round-ports";
import { NEAR_DUPLICATE_THRESHOLD, isNearDuplicate } from "./near-duplicate";

// 11 §3.7's decision rule without a database. The tests read the constant: tuning it changes none.
describe("isNearDuplicate", () => {
  it("is true at the threshold and above it, false below", () => {
    expect(isNearDuplicate(NEAR_DUPLICATE_THRESHOLD)).toBe(true);
    expect(isNearDuplicate(1)).toBe(true);
    expect(isNearDuplicate(NEAR_DUPLICATE_THRESHOLD - Number.EPSILON)).toBe(false);
    expect(isNearDuplicate(0)).toBe(false);
  });

  it("judges by the threshold it is given, so a stored check can be re-read against its own", () => {
    expect(isNearDuplicate(0.8, 0.75)).toBe(true);
    expect(isNearDuplicate(0.8, 0.85)).toBe(false);
  });

  it("keeps the threshold a cosine similarity", () => {
    expect(NEAR_DUPLICATE_THRESHOLD).toBeGreaterThan(0);
    expect(NEAR_DUPLICATE_THRESHOLD).toBeLessThanOrEqual(1);
  });
});

// The fixture the integration tests state similarities with.
describe("vectorNear", () => {
  const dot = (a: readonly number[], b: readonly number[]) => a.reduce((sum, value, index) => sum + value * b[index], 0);

  it("is a unit vector at the stated cosine similarity to its axis, and orthogonal to another's", () => {
    const near = vectorNear(1, 0.87);
    expect(dot(near, near)).toBeCloseTo(1, 12);
    expect(dot(near, vectorNear(1))).toBeCloseTo(0.87, 12);
    expect(dot(near, vectorNear(2))).toBe(0);
  });
});
