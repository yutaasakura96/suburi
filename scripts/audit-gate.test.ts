import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { auditRefusals } from "./audit-gate";

const braces = {
  source: 1240992,
  name: "braces",
  dependency: "braces",
  title: "braces vulnerable to stack-exhaustion denial of service through deeply nested patterns",
  url: "https://github.com/advisories/GHSA-vfj7-8cjw-p6xm",
  severity: "high",
  range: "<=3.0.3",
};

const lodash = {
  source: 1106913,
  name: "lodash",
  dependency: "lodash",
  title: "Command Injection in lodash",
  url: "https://github.com/advisories/GHSA-35jh-r3h4-6jhm",
  severity: "high",
  range: "<4.17.21",
};

type Via = string | Record<string, unknown>;

function vulnerability(name: string, severity: string, via: Via[]) {
  return { name, severity, isDirect: false, via, effects: [], range: "*", nodes: [], fixAvailable: false };
}

function report(...vulnerabilities: ReturnType<typeof vulnerability>[]) {
  return {
    auditReportVersion: 2,
    vulnerabilities: Object.fromEntries(vulnerabilities.map((entry) => [entry.name, entry])),
    metadata: {},
  };
}

// What `npm audit --json` reports on develop, 2026-10-03: one advisory, and the packages above it.
const today = [
  vulnerability("braces", "high", [braces]),
  vulnerability("micromatch", "high", ["braces"]),
  vulnerability("fast-glob", "high", ["micromatch"]),
  vulnerability("shadcn", "high", ["fast-glob", "ts-morph"]),
];

describe("auditRefusals", () => {
  it("passes the accepted braces advisory and the packages that inherit it", () => {
    expect(auditRefusals(report(...today))).toEqual([]);
  });

  it("refuses another high advisory beside the accepted one", () => {
    expect(auditRefusals(report(...today, vulnerability("lodash", "high", [lodash])))).toEqual([
      "lodash <4.17.21 is high: https://github.com/advisories/GHSA-35jh-r3h4-6jhm",
    ]);
  });

  it("refuses a critical advisory", () => {
    const critical = { ...lodash, severity: "critical" };
    expect(auditRefusals(report(...today, vulnerability("lodash", "critical", [critical])))).toEqual([
      "lodash <4.17.21 is critical: https://github.com/advisories/GHSA-35jh-r3h4-6jhm",
    ]);
  });

  it("refuses the accepted braces advisory if its severity becomes critical", () => {
    const critical = { ...braces, severity: "critical" };
    expect(auditRefusals(report(vulnerability("braces", "critical", [critical])))).toEqual([
      "GHSA-vfj7-8cjw-p6xm is now critical, not the high that was accepted.",
    ]);
  });

  it("refuses a second advisory against braces itself", () => {
    const second = { ...braces, source: 1, url: "https://github.com/advisories/GHSA-grv7-fg5c-xmjg" };
    expect(auditRefusals(report(vulnerability("braces", "high", [braces, second])))).toEqual([
      "braces <=3.0.3 is high: https://github.com/advisories/GHSA-grv7-fg5c-xmjg",
    ]);
  });

  it("names an advisory once, however many packages report it", () => {
    expect(
      auditRefusals(
        report(...today, vulnerability("lodash", "high", [lodash]), vulnerability("lodash-es", "high", [lodash])),
      ),
    ).toHaveLength(1);
  });

  it("leaves moderate and low advisories alone, as --audit-level=high did", () => {
    const moderate = { ...lodash, severity: "moderate" };
    const low = { ...lodash, source: 2, severity: "low" };
    expect(
      auditRefusals(report(...today, vulnerability("lodash", "moderate", [moderate, low]))),
    ).toEqual([]);
  });

  it("stops accepting the advisory once its range changes, which is how a patched release shows", () => {
    const patched = { ...braces, range: "<3.0.4" };
    expect(auditRefusals(report(vulnerability("braces", "high", [patched])))).toEqual([
      "GHSA-vfj7-8cjw-p6xm now covers braces <3.0.4, not the <=3.0.3 that was accepted. " +
        "A patched braces has probably shipped: update to it and remove the entry from scripts/audit-gate.ts.",
    ]);
  });

  it("does not accept the same advisory against another package", () => {
    const elsewhere = { ...braces, name: "micromatch" };
    expect(auditRefusals(report(vulnerability("micromatch", "high", [elsewhere])))[0]).toBe(
      "micromatch <=3.0.3 is high: https://github.com/advisories/GHSA-vfj7-8cjw-p6xm",
    );
  });

  it("refuses an accepted advisory that is no longer reported", () => {
    expect(auditRefusals(report())).toEqual([
      "GHSA-vfj7-8cjw-p6xm is no longer reported against braces. Remove its entry from scripts/audit-gate.ts.",
    ]);
  });

  it("refuses a high package that no advisory in the report explains", () => {
    expect(auditRefusals(report(...today, vulnerability("lodash", "high", ["missing"])))).toContain(
      "lodash is high, but the report names no advisory for it.",
    );
  });

  it.each([
    ["nothing", undefined],
    ["npm's error body", { error: { code: "ENOTFOUND", summary: "request failed" } }],
    ["another report version", { ...report(...today), auditReportVersion: 3 }],
    ["an unknown severity", report(vulnerability("braces", "severe", [{ ...braces, severity: "severe" }]))],
  ])("refuses %s rather than read it as clean", (_, body) => {
    expect(auditRefusals(body)).toEqual(["npm audit did not return a report this gate can read."]);
  });
});

// The script itself, with `npm` replaced on PATH by one that prints a canned report.
describe("npm run audit:ci", () => {
  function run(stdout: string) {
    const dir = mkdtempSync(join(tmpdir(), "audit-gate-test-"));
    try {
      writeFileSync(join(dir, "report"), stdout);
      // npm exits 1 whenever it reports anything at all.
      writeFileSync(join(dir, "npm"), `#!/bin/sh\ncat "${join(dir, "report")}"\nexit 1\n`);
      chmodSync(join(dir, "npm"), 0o755);
      return spawnSync(
        process.execPath,
        ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", join(process.cwd(), "scripts/audit.mts")],
        { env: { NODE_ENV: "test", PATH: `${dir}:/usr/bin:/bin` }, encoding: "utf8" },
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it("passes on the accepted advisory alone, and says what it accepted", () => {
    const result = run(JSON.stringify(report(...today)));
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("GHSA-vfj7-8cjw-p6xm");
  });

  it("fails on another high advisory", () => {
    const result = run(JSON.stringify(report(...today, vulnerability("lodash", "high", [lodash]))));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("lodash <4.17.21 is high: https://github.com/advisories/GHSA-35jh-r3h4-6jhm");
  });

  it("fails when npm prints no report", () => {
    const result = run("npm error code ENOTFOUND\n");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("npm audit did not return a report this gate can read.");
  });
});
