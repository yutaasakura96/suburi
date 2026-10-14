import { describe, expect, it } from "vitest";
import { saveBlocker } from "./copy";

// 10 §17: the save button is disabled until something differs from what is saved, and while the name
// is blank or over 80 characters, with the reason in its caption.

const saved = { name: "jordan", englishHelp: false };
const named = (name: string) => ({ name, englishHelp: false });

describe("saveBlocker", () => {
  it("allows a changed name", () => {
    expect(saveBlocker(named("Jordan"), saved)).toBeNull();
  });

  it("allows a changed English help alone", () => {
    expect(saveBlocker({ name: "jordan", englishHelp: true }, saved)).toBeNull();
  });

  it("blocks when nothing changed, the name compared trimmed", () => {
    expect(saveBlocker(named("jordan"), saved)).toBe("Nothing has changed since the last save.");
    expect(saveBlocker(named("  jordan "), saved)).toBe("Nothing has changed since the last save.");
  });

  it("blocks a blank name, whatever else changed", () => {
    expect(saveBlocker(named(""), saved)).toBe("The name cannot be blank.");
    expect(saveBlocker({ name: "   ", englishHelp: true }, saved)).toBe("The name cannot be blank.");
  });

  it("blocks a name over 80 code points, and allows 80", () => {
    expect(saveBlocker(named("a".repeat(81)), saved)).toBe("The name is over 80 characters.");
    expect(saveBlocker(named("𠮷".repeat(80)), saved)).toBeNull();
  });
});
