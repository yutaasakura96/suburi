import { describe, expect, it } from "vitest";
import { carryForward } from "./carry-forward";

describe("carryForward", () => {
  it("points a new claim at the previous claim with byte-identical normalised text", () => {
    const previous = [
      { id: "p1", textNormalised: "Led a team of 5.", spanStart: 0 },
      { id: "p2", textNormalised: "Cut invoicing time by 40%.", spanStart: 20 },
    ];
    expect(carryForward(previous, ["Cut invoicing time by 40%.", "AWS certified."])).toEqual(["p2", null]);
  });

  it("matches exactly: one character different is a new claim", () => {
    const previous = [{ id: "p1", textNormalised: "Cut invoicing time by 40%.", spanStart: 0 }];
    expect(carryForward(previous, ["Cut invoicing time by 41%."])).toEqual([null]);
  });

  it("breaks a tie on the lowest span_start, whatever order the rows arrive in", () => {
    const previous = [
      { id: "later", textNormalised: "Led a team of 5.", spanStart: 300 },
      { id: "earlier", textNormalised: "Led a team of 5.", spanStart: 12 },
    ];
    expect(carryForward(previous, ["Led a team of 5."])).toEqual(["earlier"]);
  });

  it("lets several new claims point at the same previous claim", () => {
    const previous = [{ id: "p1", textNormalised: "Led a team of 5.", spanStart: 0 }];
    expect(carryForward(previous, ["Led a team of 5.", "Led a team of 5."])).toEqual(["p1", "p1"]);
  });

  it("carries nothing when there is no previous version", () => {
    expect(carryForward([], ["Led a team of 5."])).toEqual([null]);
  });
});
