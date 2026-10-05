import { applyMigrations } from "../db/migrate.ts";
import { getDeployMigrationConfig } from "../lib/config.ts";

// Vercel's build runs this before `npm run build` (vercel.json, docs/12-deployment.md §4). It
// migrates the develop deployment's database and nothing else; a failure exits non-zero, which fails
// the build and leaves the previous deployment serving. Logs counts and the database's own error,
// never the URL or anything in it.
const migration = getDeployMigrationConfig();

if (!migration) {
  console.log("No migration on this build: only the develop deployment migrates its database.");
} else {
  const { url, deployment } = migration;
  const { password, hostname } = new URL(url);
  const secrets = [url, password, decodeURIComponent(password), hostname];
  const scrub = (text: string) => secrets.reduce((out, secret) => (secret ? out.replaceAll(secret, "[redacted]") : out), text);

  try {
    const { applied, total } = await applyMigrations(url);
    console.log(`Migrated the ${deployment} database: ${applied} applied, ${total} in its journal.`);
  } catch (error) {
    console.error(`Migrating the ${deployment} database failed; nothing was applied.`);
    for (const line of describe(error)) console.error(scrub(line));
    process.exitCode = 1;
  }
}

// The error, what it wraps and what caused it: drizzle wraps the database's error as a cause, and a
// refused connection is an AggregateError whose own message is empty.
function describe(error: unknown): string[] {
  if (!(error instanceof Error)) return [];
  const code = (error as { code?: unknown }).code;
  const line = [error.name, typeof code === "string" ? code : "", error.message].filter(Boolean).join(": ");
  const wrapped = error instanceof AggregateError ? error.errors : [];
  return [line, ...[...wrapped, error.cause].flatMap(describe)];
}
