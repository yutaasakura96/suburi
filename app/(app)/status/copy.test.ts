import { describe, expect, it } from "vitest";
import { SELF_CHECK_SIGNALS } from "../../../db/schema";
import type { Status } from "../../../lib/monitor/status";
import { CHECK_NAMES, formatThreshold, formatValue, stalenessNotice, stateOf, statusLine, unpricedModelsText, weekRange } from "./copy";

// 10 §1 and §14's copy: names and counts only, and a line only when something is wrong.

const RAN = new Date("2026-09-27T19:12:00Z"); // 2026-09-28 04:12 in Tokyo

function status({ stale = false, lastRun = RAN as Date | null, red = [] as string[] } = {}): Status {
  return {
    selfCheck: { lastRun, stale },
    digest: { lastRun: null },
    checks: SELF_CHECK_SIGNALS.map((signal) => ({ signal, value: 0, threshold: 0, isRed: red.includes(signal), unpricedModelIds: [] })),
    lastWeek: null,
  };
}

describe("Home's status line", () => {
  it("is absent when every check is clear and self-check is fresh — never an all-clear", () => {
    expect(statusLine(status())).toBeNull();
  });

  it("names one red check", () => {
    expect(statusLine(status({ red: ["cv_claims_split"] }))).toBe("1 check is red: CV claims split.");
  });

  it("counts and names several, in 12 §6's order", () => {
    expect(statusLine(status({ red: ["cv_claims_split", "scoring_pending_over_24h"] }))).toBe(
      "2 checks are red: Scores pending over 24 hours, CV claims split.",
    );
  });

  it("says self-check never ran", () => {
    expect(statusLine(status({ stale: true, lastRun: null }))).toBe("Self-check has never run.");
  });

  it("puts staleness first, then what the last run found", () => {
    expect(statusLine(status({ stale: true, red: ["spend_week_to_date_usd"] }))).toBe(
      "Self-check has not run since 2026-09-28 04:12. 1 check is red: Spend this week.",
    );
  });

  it("names an unpriced model on Home", () => {
    const original = status({ red: ["spend_week_to_date_usd"] });
    const data = { ...original, checks: original.checks.map((check) => check.signal === "spend_week_to_date_usd"
      ? { ...check, unpricedModelIds: ["unpriced-model"] }
      : check) };
    expect(statusLine(data)).toBe("1 check is red: Spend this week (Unpriced model: unpriced-model).");
  });
});

describe("the status page", () => {
  it("names every self-check signal", () => {
    expect(Object.keys(CHECK_NAMES)).toEqual([...SELF_CHECK_SIGNALS]);
  });

  it("leads with staleness only when stale", () => {
    expect(stalenessNotice(status())).toBeNull();
    expect(stalenessNotice(status({ stale: true, lastRun: null }))).toBe(
      "Self-check has never run. Nothing below has been checked.",
    );
    expect(stalenessNotice(status({ stale: true }))).toBe(
      "Self-check has not run since 2026-09-28 04:12. Every reading below is from that run or earlier.",
    );
  });

  it("formats counts, code points and dollars, and no reading as a dash", () => {
    expect(formatValue("cv_unclaimed_run_max", 1071)).toBe("1,071");
    expect(formatValue("spend_week_to_date_usd", 0.84)).toBe("$0.84");
    expect(formatValue("digest_spend_usd", 1.014)).toBe("$1.01");
    expect(formatValue("cv_spans_rejected", null)).toBe("—");
    expect(formatThreshold("cv_unclaimed_run_max", 2000)).toBe("above 2,000");
    expect(formatThreshold("spend_week_to_date_usd", 1.2)).toBe("above $1.20");
    expect(formatThreshold("scoring_pending_over_24h", null)).toBe("—");
  });

  it("states no reading apart from OK", () => {
    expect(stateOf({ signal: "cv_spans_rejected", value: null, threshold: 0, isRed: false, unpricedModelIds: [] })).toBe("No reading");
    expect(stateOf({ signal: "cv_spans_rejected", value: 0, threshold: 0, isRed: false, unpricedModelIds: [] })).toBe("OK");
    expect(stateOf({ signal: "cv_spans_rejected", value: 2, threshold: 0, isRed: true, unpricedModelIds: [] })).toBe("Red");
  });

  it("names an unpriced and a missing model stamp", () => {
    expect(unpricedModelsText(["future-model", null])).toBe("Unpriced models: future-model, missing model ID.");
  });

  it("shows a Tokyo week as its Monday and Sunday", () => {
    expect(weekRange(new Date("2026-09-20T15:00:00Z"), new Date("2026-09-27T15:00:00Z"))).toBe("2026-09-21 – 2026-09-27");
  });
});
