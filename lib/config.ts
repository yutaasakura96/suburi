import { z } from "zod";

// The only module that reads process.env (docs/12-deployment.md §2). Every variable is
// required and none has a default, except OPENAI_BASE_URL, which only Playwright sets. Errors name
// the variable, never its value.

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

  const names = [...new Set(result.error.issues.map((issue) => String(issue.path[0])))];
  throw new ConfigError(
    names.map((name) => ({ name, problem: env[name] ? "malformed" : "missing" })),
  );
}

let cached: Config | undefined;

export function getConfig(): Config {
  cached ??= parseConfig(process.env);
  return cached;
}
