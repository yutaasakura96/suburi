import { describe, expect, it } from "vitest";
import { backupErrorClass, backupKey } from "./run";
import { DumpError } from "./dump";

describe("backupKey", () => {
  it("is dated by the run's own instant under backups/, never chosen by a caller", () => {
    expect(backupKey(new Date("2026-09-30T19:12:40.123Z"))).toBe("backups/2026-09-30T19-12-40.123Z.sql");
  });
});

// 12 §7: a log line names what failed by class only; a message can carry a query's parameters.
describe("backupErrorClass", () => {
  it.each([
    ["an SQLSTATE", Object.assign(new Error("relation secret text"), { code: "42P01", severity: "ERROR" }), "pg_42P01"],
    ["drizzle's wrapped SQLSTATE", Object.assign(new Error("Failed query: secret"), { cause: { code: "57014", severity: "ERROR" } }), "pg_57014"],
    ["a refused dump", new DumpError("sessions references users"), "dump_refused"],
    ["S3's error code", Object.assign(new Error("Access Denied"), { name: "AccessDenied", $metadata: {} }), "s3_AccessDenied"],
    ["Node's system code", Object.assign(new Error("connect ECONNREFUSED 10.0.0.1"), { code: "ECONNREFUSED" }), "node_ECONNREFUSED"],
    ["Node's five-letter system code", Object.assign(new Error("write EPIPE"), { code: "EPIPE" }), "node_EPIPE"],
    ["anything else", new Error("secret text"), "unexpected"],
    ["a thrown string", "secret text", "unexpected"],
  ])("%s", (_, error, errorClass) => {
    expect(backupErrorClass(error)).toBe(errorClass);
  });
});
