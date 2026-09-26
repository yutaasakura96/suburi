import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { devSessionRefusals } from "./dev-session-guard";

const local = {
  DATABASE_URL: "postgresql://suburi:suburi@localhost:5433/suburi",
  DATABASE_URL_UNPOOLED: "postgresql://suburi:suburi@localhost:5433/suburi",
  BETTER_AUTH_URL: "http://localhost:3000",
};

const neon =
  "postgresql://u:secret@ep-example-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=verify-full";

describe("devSessionRefusals", () => {
  it("accepts a local environment", () => {
    expect(devSessionRefusals(local)).toEqual([]);
  });

  it("accepts a database on 127.0.0.1", () => {
    const url = "postgresql://suburi:suburi@127.0.0.1:5432/suburi";
    expect(
      devSessionRefusals({
        ...local,
        DATABASE_URL: url,
        DATABASE_URL_UNPOOLED: url,
      }),
    ).toEqual([]);
  });

  it.each(["DATABASE_URL", "DATABASE_URL_UNPOOLED"])("refuses a non-local %s", (name) => {
    const reasons = devSessionRefusals({ ...local, [name]: neon });
    expect(reasons).toEqual([
      `${name} points at ep-example-pooler.ap-southeast-1.aws.neon.tech, not localhost or 127.0.0.1.`,
    ]);
    // Names the host, never the credentials.
    expect(reasons.join()).not.toContain("secret");
  });

  it("refuses a missing or malformed database URL", () => {
    expect(devSessionRefusals({ ...local, DATABASE_URL: undefined })).toEqual([
      "DATABASE_URL is not set.",
    ]);
    expect(devSessionRefusals({ ...local, DATABASE_URL: "localhost" })).toEqual([
      "DATABASE_URL is not a URL.",
    ]);
  });

  it("refuses NODE_ENV=production", () => {
    expect(devSessionRefusals({ ...local, NODE_ENV: "production" })).toEqual([
      "NODE_ENV is production.",
    ]);
  });

  it("refuses a deployment's secret, told by the URL it belongs to", () => {
    expect(
      devSessionRefusals({
        ...local,
        BETTER_AUTH_URL: "https://suburi-develop.vercel.app",
      }),
    ).toEqual([
      "BETTER_AUTH_URL is suburi-develop.vercel.app, so BETTER_AUTH_SECRET is a deployment's secret, not a local one.",
    ]);
  });

  it("refuses a Vercel environment", () => {
    expect(devSessionRefusals({ ...local, VERCEL: "1", VERCEL_ENV: "preview" })).toEqual([
      "VERCEL is set, so this is a Vercel build or function.",
    ]);
    expect(devSessionRefusals({ ...local, VERCEL_ENV: "production" })).toEqual([
      "VERCEL_ENV is production.",
    ]);
    expect(devSessionRefusals({ ...local, VERCEL_ENV: "development" })).toEqual([]);
  });
});

// The script itself: it refuses before it connects, so no database is needed and nothing is written.
describe("npm run dev:session", () => {
  function run(env: {
    NODE_ENV?: "production";
    DATABASE_URL?: string;
    DATABASE_URL_UNPOOLED?: string;
    BETTER_AUTH_SECRET?: string;
  }) {
    mkdirSync(".playwright", { recursive: true });
    const dir = mkdtempSync(join(process.cwd(), ".playwright/dev-session-test-"));
    const out = join(dir, "state.json");
    const secret = "local-dev-session-secret-32-characters";
    writeFileSync(join(dir, ".env"), [
      `DATABASE_URL=${local.DATABASE_URL}`,
      `DATABASE_URL_UNPOOLED=${local.DATABASE_URL_UNPOOLED}`,
      `BETTER_AUTH_SECRET=${secret}`,
      `BETTER_AUTH_URL=${local.BETTER_AUTH_URL}`,
    ].join("\n"), { mode: 0o600 });
    const result = spawnSync(
      "node",
      [
        "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
        "--import",
        join(process.cwd(), "scripts/resolve-ts.mts"),
        join(process.cwd(), "scripts/dev-session.mts"),
        "--out",
        out,
      ],
      {
        cwd: dir,
        env: {
          NODE_ENV: "development",
          PATH: process.env.PATH,
          ...env,
        },
        encoding: "utf8",
      },
    );
    return { ...result, wrote: existsSync(out) };
  }

  it("refuses exported non-local database URLs and writes nothing", () => {
    const result = run({ DATABASE_URL: neon, DATABASE_URL_UNPOOLED: neon });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Exported DATABASE_URL differs from the local env file.");
    expect(result.stderr).toContain("Exported DATABASE_URL_UNPOOLED differs from the local env file.");
    expect(result.stdout).toBe("");
    expect(result.wrote).toBe(false);
  });

  it("refuses an exported deployment secret with local URLs and writes nothing", () => {
    const result = run({ BETTER_AUTH_SECRET: "deployed-secret-with-at-least-32-characters" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Exported BETTER_AUTH_SECRET differs from the local env file.");
    expect(result.stdout).toBe("");
    expect(result.wrote).toBe(false);
  });

  it.each(["DATABASE_URL", "DATABASE_URL_UNPOOLED"] as const)(
    "refuses an exported %s that differs from the local file",
    (name) => {
      const result = run({ [name]: "postgresql://suburi:suburi@localhost:5433/other" });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(`Exported ${name} differs from the local env file.`);
      expect(result.wrote).toBe(false);
    },
  );

  it("refuses NODE_ENV=production and writes nothing", () => {
    const result = run({ NODE_ENV: "production" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("NODE_ENV is production.");
    expect(result.wrote).toBe(false);
  });
}, 30_000);
