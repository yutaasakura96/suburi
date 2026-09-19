import { describe, expect, it } from "vitest";
import { ConfigError, parseConfig } from "./config";

const valid = {
  DATABASE_URL: "postgresql://suburi:pw@localhost:5432/suburi",
  DATABASE_URL_UNPOOLED: "postgresql://suburi:pw@localhost:5432/suburi",
  BETTER_AUTH_SECRET: "s".repeat(32),
  BETTER_AUTH_URL: "http://localhost:3000",
  GOOGLE_CLIENT_ID: "client-id",
  GOOGLE_CLIENT_SECRET: "client-secret",
  ALLOWED_EMAIL: "me@example.com",
};

function errorFrom(env: Record<string, string | undefined>): ConfigError {
  try {
    parseConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) return error;
    throw error;
  }
  throw new Error("expected parseConfig to throw");
}

describe("parseConfig", () => {
  it("accepts a complete, well-formed environment", () => {
    expect(parseConfig(valid)).toEqual(valid);
  });

  it.each(Object.keys(valid))("rejects a missing %s and names it", (name) => {
    const error = errorFrom({ ...valid, [name]: undefined });
    expect(error.problems).toEqual([{ name, problem: "missing" }]);
    expect(error.message).toContain(name);
  });

  it("treats an empty value as missing, never as a default", () => {
    const error = errorFrom({ ...valid, DATABASE_URL: "" });
    expect(error.problems).toEqual([{ name: "DATABASE_URL", problem: "missing" }]);
  });

  it.each([
    ["DATABASE_URL", "not a url"],
    ["DATABASE_URL_UNPOOLED", "https://example.com/db"],
    ["BETTER_AUTH_SECRET", "too-short"],
    ["BETTER_AUTH_URL", "localhost:3000"],
    ["ALLOWED_EMAIL", "not-an-email"],
  ])("rejects a malformed %s without echoing its value", (name, value) => {
    const error = errorFrom({ ...valid, [name]: value });
    expect(error.problems).toEqual([{ name, problem: "malformed" }]);
    expect(error.message).toContain(name);
    expect(error.message).not.toContain(value);
  });

  // pg v9 gives `require` libpq's meaning: encrypted, certificate unchecked.
  describe.each(["DATABASE_URL", "DATABASE_URL_UNPOOLED"])("%s TLS", (name) => {
    const remote = "postgresql://suburi:pw@ep-x.ap-southeast-1.aws.neon.tech/suburi";

    it.each([
      ["no sslmode", remote],
      ["sslmode=require", `${remote}?sslmode=require&channel_binding=require`],
      ["sslmode=verify-ca", `${remote}?sslmode=verify-ca`],
      ["uselibpqcompat", `${remote}?uselibpqcompat=true&sslmode=verify-full`],
    ])("rejects a remote URL with %s", (_, value) => {
      const error = errorFrom({ ...valid, [name]: value });
      expect(error.problems).toEqual([{ name, problem: "malformed" }]);
      expect(error.message).not.toContain(value);
    });

    it("accepts a remote URL with sslmode=verify-full", () => {
      const value = `${remote}?sslmode=verify-full&channel_binding=require`;
      expect(parseConfig({ ...valid, [name]: value })[name as "DATABASE_URL"]).toBe(value);
    });

    it.each(["localhost:5433", "127.0.0.1:5433"])("accepts local %s without sslmode", (host) => {
      const value = `postgresql://suburi:pw@${host}/suburi`;
      expect(parseConfig({ ...valid, [name]: value })[name as "DATABASE_URL"]).toBe(value);
    });
  });

  it("never echoes a secret value, even when another variable is wrong", () => {
    const error = errorFrom({ ...valid, ALLOWED_EMAIL: undefined });
    expect(error.message).not.toContain(valid.GOOGLE_CLIENT_SECRET);
    expect(error.message).not.toContain(valid.BETTER_AUTH_SECRET);
  });

  it("reports every problem at once", () => {
    const error = errorFrom({});
    expect(error.problems.map((p) => p.name).sort()).toEqual(Object.keys(valid).sort());
  });
});
