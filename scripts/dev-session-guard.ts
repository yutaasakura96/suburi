// The local-only guard for `npm run dev:session` (06, 2026-09-25). Checked before anything is read
// from or written to a database: a session is a row, so the database decides where it would work.

type Env = Record<string, string | undefined>;

// `postgres` is the service name in docker-compose.yml, for a script run inside the Compose network.
const localDatabaseHosts = new Set(["localhost", "127.0.0.1", "[::1]", "postgres"]);
const localAppHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

function hostOf(value: string) {
  return URL.canParse(value) ? new URL(value).hostname : undefined;
}

/** Why the environment is not a local one, one line per reason. Empty means it is. Never a value. */
export function devSessionRefusals(env: Env): string[] {
  const reasons: string[] = [];

  if (env.NODE_ENV === "production") reasons.push("NODE_ENV is production.");
  // Set on Vercel builds and functions, and by `vercel env pull` for anything but Development.
  if (env.VERCEL === "1") reasons.push("VERCEL is set, so this is a Vercel build or function.");
  else if (env.VERCEL_ENV && env.VERCEL_ENV !== "development") {
    reasons.push(`VERCEL_ENV is ${env.VERCEL_ENV}.`);
  }

  for (const name of ["DATABASE_URL", "DATABASE_URL_UNPOOLED"]) {
    const value = env[name];
    if (!value) {
      reasons.push(`${name} is not set.`);
      continue;
    }
    const host = hostOf(value);
    if (host === undefined) reasons.push(`${name} is not a URL.`);
    else if (!localDatabaseHosts.has(host)) {
      reasons.push(`${name} points at ${host}, not localhost, 127.0.0.1 or the Docker service.`);
    }
  }

  // The secret travels with the URL it was made for (12 §2): .env.develop.local pairs develop's
  // secret with https://suburi-develop.vercel.app, local .env pairs a local one with localhost.
  const appUrl = env.BETTER_AUTH_URL;
  if (!appUrl) reasons.push("BETTER_AUTH_URL is not set.");
  else {
    const host = hostOf(appUrl);
    if (host === undefined) reasons.push("BETTER_AUTH_URL is not a URL.");
    else if (!localAppHosts.has(host)) {
      reasons.push(
        `BETTER_AUTH_URL is ${host}, so BETTER_AUTH_SECRET is a deployment's secret, not a local one.`,
      );
    }
  }

  return reasons;
}
