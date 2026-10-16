import { describe, expect, it } from "vitest";
import { MAX_ENGLISH_READING_CODE_POINTS, checkEnglishReading } from "./english-reading";
import { ModelCallFailed } from "./upstream";

// The English-reading port's check (07 §5.20): what comes back is checked, not trusted.

describe("checkEnglishReading", () => {
  it("returns the English, trimmed, with its line breaks inside", () => {
    expect(checkEnglishReading("  Um, at my last job,\nI led the migration.\n")).toBe("Um, at my last job,\nI led the migration.");
  });

  it("refuses a blank English", () => {
    expect(() => checkEnglishReading(" \n ")).toThrow(new ModelCallFailed("English reading", "malformed_output"));
  });

  it("refuses a runaway output, counted in code points", () => {
    expect(checkEnglishReading("😀".repeat(MAX_ENGLISH_READING_CODE_POINTS))).toHaveLength(MAX_ENGLISH_READING_CODE_POINTS * 2);
    expect(() => checkEnglishReading("a".repeat(MAX_ENGLISH_READING_CODE_POINTS + 1))).toThrow(ModelCallFailed);
  });
});
