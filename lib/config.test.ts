import { describe, expect, it } from "vitest";
import { ConfigError, parseConfig, parseSentryConfig } from "./config";

const valid = {
  DATABASE_URL: "postgresql://suburi:pw@localhost:5432/suburi",
  DATABASE_URL_UNPOOLED: "postgresql://suburi:pw@localhost:5432/suburi",
  BETTER_AUTH_SECRET: "s".repeat(32),
  BETTER_AUTH_URL: "http://localhost:3000",
  GOOGLE_CLIENT_ID: "client-id",
  GOOGLE_CLIENT_SECRET: "client-secret",
  ALLOWED_EMAIL: "me@example.com",
  OPENAI_API_KEY: "sk-test-not-a-real-key",
  AWS_ACCESS_KEY_ID: "AKIA-test-not-a-real-id",
  AWS_SECRET_ACCESS_KEY: "test-not-a-real-secret",
  AWS_REGION: "ap-northeast-1",
  S3_BUCKET: "suburi-test-bucket",
  S3_PREFIX: "dev/",
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
    ["AWS_REGION", "Tokyo"],
    ["AWS_REGION", "ap-northeast"],
    ["S3_BUCKET", "Suburi_Audio"],
    ["S3_BUCKET", "s3://suburi-audio"],
    ["S3_BUCKET", "suburi..audio"],
    ["S3_BUCKET", "ab"],
    ["S3_PREFIX", "dev"],
    ["S3_PREFIX", "/dev/"],
    ["S3_PREFIX", "staging/"],
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

  // Playwright's mock OpenAI (e2e/mock-openai.ts). Optional, and local only: a remote value would
  // send OPENAI_API_KEY to whoever runs that host.
  describe("OPENAI_BASE_URL", () => {
    it("is absent unless set, and the SDK's own default stands", () => {
      expect(parseConfig(valid).OPENAI_BASE_URL).toBeUndefined();
    });

    it.each(["http://localhost:3199/v1", "http://127.0.0.1:3199/v1"])("accepts %s", (value) => {
      expect(parseConfig({ ...valid, OPENAI_BASE_URL: value }).OPENAI_BASE_URL).toBe(value);
    });

    it.each(["https://api.openai.com/v1", "https://evil.example/v1", "http://localhost.evil.example/v1", "not a url"])(
      "refuses %s",
      (value) => {
        const error = errorFrom({ ...valid, OPENAI_BASE_URL: value });
        expect(error.problems).toEqual([{ name: "OPENAI_BASE_URL", problem: "malformed" }]);
        expect(error.message).not.toContain(value);
      },
    );
  });

  // Playwright's mock S3 (e2e/mock-s3.ts), under OPENAI_BASE_URL's rule: a remote value would send the
  // AWS key to whoever runs that host.
  describe("S3_ENDPOINT", () => {
    it("is absent unless set, and the SDK talks to S3", () => {
      expect(parseConfig(valid).S3_ENDPOINT).toBeUndefined();
    });

    it("accepts a local host", () => {
      expect(parseConfig({ ...valid, S3_ENDPOINT: "http://localhost:3198" }).S3_ENDPOINT).toBe("http://localhost:3198");
    });

    it.each(["https://s3.ap-northeast-1.amazonaws.com", "http://localhost.evil.example", "not a url"])(
      "refuses %s",
      (value) => {
        const error = errorFrom({ ...valid, S3_ENDPOINT: value });
        expect(error.problems).toEqual([{ name: "S3_ENDPOINT", problem: "malformed" }]);
        expect(error.message).not.toContain(value);
      },
    );
  });

  // The cron routes' caller check (07 §5.17): Production scope only, so required only there (06, #55).
  describe("CRON_SECRET", () => {
    const secret = "cron-secret-not-a-real-one";
    const backup = { BACKUP_AWS_ACCESS_KEY_ID: "AKIA-backup-not-a-real-id", BACKUP_AWS_SECRET_ACCESS_KEY: "backup-not-a-real-secret" };

    it.each([[undefined], ["preview"], ["development"]])("is optional when VERCEL_ENV is %s", (vercelEnv) => {
      expect(parseConfig({ ...valid, VERCEL_ENV: vercelEnv }).CRON_SECRET).toBeUndefined();
    });

    it("is required in production, and names itself as missing", () => {
      const error = errorFrom({ ...valid, ...backup, VERCEL_ENV: "production" });
      expect(error.problems).toEqual([{ name: "CRON_SECRET", problem: "missing" }]);
    });

    it("is accepted in production", () => {
      expect(parseConfig({ ...valid, ...backup, VERCEL_ENV: "production", CRON_SECRET: secret }).CRON_SECRET).toBe(secret);
    });

    it("refuses one shorter than 16 characters without echoing it", () => {
      const error = errorFrom({ ...valid, CRON_SECRET: "fifteen-chars-x" });
      expect(error.problems).toEqual([{ name: "CRON_SECRET", problem: "malformed" }]);
      expect(error.message).not.toContain("fifteen-chars-x");
    });

    it("refuses a VERCEL_ENV Vercel never sets", () => {
      const error = errorFrom({ ...valid, VERCEL_ENV: "staging" });
      expect(error.problems).toEqual([{ name: "VERCEL_ENV", problem: "malformed" }]);
    });
  });

  // The daily dump's own write-only user (12 §2, §3 step 5): Production scope only, so required only
  // there, and never the app's own key (06, #56).
  describe("BACKUP_AWS_ACCESS_KEY_ID and BACKUP_AWS_SECRET_ACCESS_KEY", () => {
    const backup = { BACKUP_AWS_ACCESS_KEY_ID: "AKIA-backup-not-a-real-id", BACKUP_AWS_SECRET_ACCESS_KEY: "backup-not-a-real-secret" };
    const production = { ...valid, VERCEL_ENV: "production", CRON_SECRET: "cron-secret-not-a-real-one" };

    it.each([[undefined], ["preview"], ["development"]])("are optional when VERCEL_ENV is %s", (vercelEnv) => {
      const config = parseConfig({ ...valid, VERCEL_ENV: vercelEnv });
      expect(config.BACKUP_AWS_ACCESS_KEY_ID).toBeUndefined();
      expect(config.BACKUP_AWS_SECRET_ACCESS_KEY).toBeUndefined();
    });

    it("are required in production, each named as missing", () => {
      const error = errorFrom(production);
      expect(error.problems).toEqual([
        { name: "BACKUP_AWS_ACCESS_KEY_ID", problem: "missing" },
        { name: "BACKUP_AWS_SECRET_ACCESS_KEY", problem: "missing" },
      ]);
    });

    it("are accepted in production", () => {
      expect(parseConfig({ ...production, ...backup })).toMatchObject(backup);
    });

    it.each(Object.keys(backup))("refuses half a key: %s alone is not enough anywhere", (name) => {
      const other = Object.keys(backup).find((key) => key !== name)!;
      const error = errorFrom({ ...valid, [name]: backup[name as keyof typeof backup] });
      expect(error.problems).toEqual([{ name: other, problem: "missing" }]);
    });

    it("refuses the app's own key without echoing it", () => {
      const error = errorFrom({ ...valid, ...backup, BACKUP_AWS_ACCESS_KEY_ID: valid.AWS_ACCESS_KEY_ID });
      expect(error.problems).toEqual([{ name: "BACKUP_AWS_ACCESS_KEY_ID", problem: "malformed" }]);
      expect(error.message).not.toContain(valid.AWS_ACCESS_KEY_ID);
    });
  });

  // The prefix is the only thing separating develop's audio from real audio (12 §2).
  it.each(["prod/", "dev/"])("accepts S3_PREFIX %s", (value) => {
    expect(parseConfig({ ...valid, S3_PREFIX: value }).S3_PREFIX).toBe(value);
  });

  it("never echoes a secret value, even when another variable is wrong", () => {
    const error = errorFrom({ ...valid, ALLOWED_EMAIL: undefined });
    expect(error.message).not.toContain(valid.GOOGLE_CLIENT_SECRET);
    expect(error.message).not.toContain(valid.BETTER_AUTH_SECRET);
    expect(error.message).not.toContain(valid.AWS_SECRET_ACCESS_KEY);
  });

  it("reports every problem at once", () => {
    const error = errorFrom({});
    expect(error.problems.map((p) => p.name).sort()).toEqual(Object.keys(valid).sort());
  });
});

// Sentry is optional and off unless the deployment is production or develop (12 §1, 06).
describe("parseSentryConfig", () => {
  const sentry = {
    SENTRY_DSN: "https://0123456789abcdef@o1.ingest.sentry.io/2",
    SENTRY_AUTH_TOKEN: "sntrys_test-not-a-real-token",
  };
  const production = { ...sentry, VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "main" };
  const develop = { ...sentry, VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "develop" };

  function sentryErrorFrom(env: Record<string, string | undefined>): ConfigError {
    try {
      parseSentryConfig(env);
    } catch (error) {
      if (error instanceof ConfigError) return error;
      throw error;
    }
    throw new Error("expected parseSentryConfig to throw");
  }

  it("is on in production, tagged production", () => {
    expect(parseSentryConfig(production)).toEqual({
      dsn: sentry.SENTRY_DSN,
      authToken: sentry.SENTRY_AUTH_TOKEN,
      environment: "production",
    });
  });

  it("is on for the develop branch's preview, tagged develop", () => {
    expect(parseSentryConfig(develop)?.environment).toBe("develop");
  });

  it.each([
    ["locally", { ...sentry }],
    ["in Vercel development", { ...sentry, VERCEL_ENV: "development" }],
    ["on another branch's preview", { ...develop, VERCEL_GIT_COMMIT_REF: "feature/x" }],
    ["without SENTRY_DSN", { ...production, SENTRY_DSN: undefined }],
    ["with an empty SENTRY_DSN", { ...production, SENTRY_DSN: "" }],
  ])("is off %s", (_, env) => {
    expect(parseSentryConfig(env)).toBeUndefined();
  });

  it("never reads the environment tag from a variable someone sets", () => {
    expect(parseSentryConfig({ ...sentry, SENTRY_ENVIRONMENT: "production" })).toBeUndefined();
    expect(parseSentryConfig({ ...develop, SENTRY_ENVIRONMENT: "production" })?.environment).toBe(
      "develop",
    );
  });

  it("refuses a DSN without the auth token, naming it", () => {
    const error = sentryErrorFrom({ ...production, SENTRY_AUTH_TOKEN: undefined });
    expect(error.problems).toEqual([{ name: "SENTRY_AUTH_TOKEN", problem: "missing" }]);
  });

  it.each(["not a url", "http://0123456789abcdef@o1.ingest.sentry.io/2"])(
    "refuses a malformed SENTRY_DSN without echoing it",
    (value) => {
      const error = sentryErrorFrom({ ...develop, SENTRY_DSN: value });
      expect(error.problems).toEqual([{ name: "SENTRY_DSN", problem: "malformed" }]);
      expect(error.message).not.toContain(value);
    },
  );

  it("leaves parseConfig unchanged: the rest of the environment never needs Sentry", () => {
    expect(() => parseConfig({ ...valid, SENTRY_DSN: undefined })).not.toThrow();
  });
});
