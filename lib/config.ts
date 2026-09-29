import { z } from "zod";

// The only application module that reads process.env (docs/12-deployment.md §2). The application
// variables are required except OPENAI_BASE_URL, which only Playwright sets, CRON_SECRET, which only
// production requires, and the Sentry pair parsed below. Errors name the variable, never its value.

const localHosts = new Set(["localhost", "127.0.0.1"]);

// A remote database must verify the server certificate. pg v9 gives `require` libpq's meaning
// (encrypted, certificate unchecked), so anything but an explicit verify-full is refused. Local
// Docker has no TLS.
const postgresUrl = z.url({ protocol: /^postgres(ql)?$/ }).refine((value) => {
  // Zod 4 runs this even when the url check above has already failed.
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  if (localHosts.has(url.hostname)) return true;
  return url.searchParams.get("sslmode") === "verify-full" && !url.searchParams.has("uselibpqcompat");
});

// Playwright's mock OpenAI (e2e/mock-openai.ts, 06). Local hosts only, so no value can send
// OPENAI_API_KEY to another server; unset everywhere else, where the SDK talks to OpenAI.
const localBaseUrl = z.url({ protocol: /^https?$/ }).refine((value) => {
  if (!URL.canParse(value)) return false;
  return localHosts.has(new URL(value).hostname);
});

// S3's bucket naming rules: 3–63 characters of lowercase letters, digits, dots and hyphens, starting
// and ending with a letter or digit, no two dots together.
const bucketName = z
  .string()
  .regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/)
  .refine((value) => !value.includes(".."));

const schema = z.object({
  DATABASE_URL: postgresUrl,
  DATABASE_URL_UNPOOLED: postgresUrl,
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.url({ protocol: /^https?$/ }),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  ALLOWED_EMAIL: z.email(),
  // Every model call (12 §2). The model strings are not here: they are constants in lib/ai/models.ts.
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_BASE_URL: localBaseUrl.optional(),
  // Presigning the audio PUT and GET (12 §2). One IAM user per environment, holding only
  // s3:PutObject and s3:GetObject on its own prefix (12 §3 step 5).
  AWS_ACCESS_KEY_ID: z.string().min(1),
  AWS_SECRET_ACCESS_KEY: z.string().min(1),
  AWS_REGION: z.string().regex(/^[a-z]{2}(-[a-z]+)+-\d$/),
  S3_BUCKET: bucketName,
  // The only thing separating develop's audio from real audio (12 §2), so exactly one of the two.
  S3_PREFIX: z.enum(["prod/", "dev/"]),
  // The cron routes' caller check (07 §5.17). Production scope only (12 §2); elsewhere absent, and the
  // routes then refuse every call. Vercel recommends at least 16 characters.
  CRON_SECRET: z.string().min(16).optional(),
  // Set by Vercel itself at build and runtime (06, 2026-09-30); unset locally.
  VERCEL_ENV: z.enum(["production", "preview", "development"]).optional(),
}).superRefine((env, context) => {
  // A production that booted without it would refuse every scheduled run, found only when the status
  // page went stale two days later. So it fails the boot instead (06, #55).
  if (env.VERCEL_ENV === "production" && env.CRON_SECRET === undefined) {
    context.addIssue({ code: "custom", path: ["CRON_SECRET"], message: "required in production" });
  }
});

export type Config = z.infer<typeof schema>;

type Env = Record<string, string | undefined>;

type Problem = { name: string; problem: "missing" | "malformed" };

// No parameter properties: scripts/seed.mts runs this file under Node's type stripping.
export class ConfigError extends Error {
  readonly problems: Problem[];

  constructor(problems: Problem[]) {
    super(
      `Invalid configuration: ${problems.map((p) => `${p.name} is ${p.problem}`).join(", ")}`,
    );
    this.name = "ConfigError";
    this.problems = problems;
  }
}

export function parseConfig(env: Env): Config {
  const result = schema.safeParse(env);
  if (result.success) return result.data;

  throw configError(result.error, env);
}

function configError(error: z.ZodError, env: Env): ConfigError {
  const names = [...new Set(error.issues.map((issue) => String(issue.path[0])))];
  return new ConfigError(
    names.map((name) => ({ name, problem: env[name] ? "malformed" : "missing" })),
  );
}

let cached: Config | undefined;

export function getConfig(): Config {
  cached ??= parseConfig(process.env);
  return cached;
}

// Sentry is the one optional service (12 §1, 06): off locally, in CI and under Playwright, on only
// in the two deployments below. Parsed apart from the schema above because next.config.ts reads it
// at build time, where the runtime variables are not all present.
const sentrySchema = z.object({
  SENTRY_DSN: z.url({ protocol: /^https$/ }),
  // Source-map upload at build (12 §2). Same scopes as the DSN, so a DSN without it is a half-done
  // setup, refused rather than shipping unreadable stack traces.
  SENTRY_AUTH_TOKEN: z.string().min(1),
});

export type SentryEnvironment = "develop" | "production";

export type SentryConfig = {
  dsn: string;
  authToken: string;
  environment: SentryEnvironment;
};

// The environment tag comes from Vercel's system variables, never from a variable someone sets.
// Anything that is neither production nor the develop branch's preview has no Sentry.
function sentryEnvironment(env: Env): SentryEnvironment | undefined {
  if (env.VERCEL_ENV === "production") return "production";
  if (env.VERCEL_ENV === "preview" && env.VERCEL_GIT_COMMIT_REF === "develop") return "develop";
  return undefined;
}

export function parseSentryConfig(env: Env): SentryConfig | undefined {
  if (!env.SENTRY_DSN) return undefined;
  const environment = sentryEnvironment(env);
  if (!environment) return undefined;

  const result = sentrySchema.safeParse(env);
  if (!result.success) throw configError(result.error, env);
  return {
    dsn: result.data.SENTRY_DSN,
    authToken: result.data.SENTRY_AUTH_TOKEN,
    environment,
  };
}

export function getSentryConfig(): SentryConfig | undefined {
  return parseSentryConfig(process.env);
}

// Set by Next.js itself in instrumentation.ts's register(): which server runtime is booting.
export function nextRuntime(): string | undefined {
  return process.env.NEXT_RUNTIME;
}
