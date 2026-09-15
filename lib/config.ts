import { z } from "zod";

// The only module that reads process.env (docs/12-deployment.md §2). Every variable is
// required; none has a default. Errors name the variable, never its value.

const postgresUrl = z.url({ protocol: /^postgres(ql)?$/ });

const schema = z.object({
  DATABASE_URL: postgresUrl,
  DATABASE_URL_UNPOOLED: postgresUrl,
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.url({ protocol: /^https?$/ }),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  ALLOWED_EMAIL: z.email(),
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
