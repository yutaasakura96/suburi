import { describe, expect, it } from "vitest";
import { saveBlocker } from "./copy";

// 10 §17: the save button is disabled until the name differs from what is saved, and while it is blank
// or over 80 characters, with the reason in its caption.

describe("saveBlocker", () => {
  it("allows a changed name", () => {
    expect(saveBlocker("Jordan", "jordan")).toBeNull();
  });

  it("blocks an unchanged name, compared trimmed", () => {
    expect(saveBlocker("jordan", "jordan")).toBe("Nothing has changed since the last save.");
    expect(saveBlocker("  jordan ", "jordan")).toBe("Nothing has changed since the last save.");
  });

  it("blocks a blank name", () => {
    expect(saveBlocker("", "jordan")).toBe("The name cannot be blank.");
    expect(saveBlocker("   ", "jordan")).toBe("The name cannot be blank.");
  });

  it("blocks a name over 80 code points, and allows 80", () => {
    expect(saveBlocker("a".repeat(81), "jordan")).toBe("The name is over 80 characters.");
    expect(saveBlocker("𠮷".repeat(80), "jordan")).toBeNull();
  });
});
