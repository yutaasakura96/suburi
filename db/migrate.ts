import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";

export type MigrationResult = { applied: number; total: number };

async function journalRows(client: Client): Promise<number> {
  const { rows } = await client.query(
    "select to_regclass('drizzle.__drizzle_migrations') is not null as present",
  );
  if (!rows[0].present) return 0;
  const count = await client.query("select count(*)::int as count from drizzle.__drizzle_migrations");
  return count.rows[0].count;
}

// What `drizzle-kit migrate` does, callable from a deploy (docs/12-deployment.md §4): the same
// migrator and the same journal, so a database migrated by either is current for both. Pending
// migrations apply in one transaction, and a failure leaves the database as it was. Takes a direct
// URL, never the pooled one: the lock below is a session's.
export async function applyMigrations(url: string, migrationsFolder = "db/migrations"): Promise<MigrationResult> {
  // A build that cannot reach its database fails here rather than hanging.
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 30_000 });
  await client.connect();
  try {
    // drizzle reads the journal before it opens its transaction, so two builds at once would both
    // run the same migration. Released when the session ends.
    await client.query("select pg_advisory_lock(hashtext('suburi.migrations'))");
    const before = await journalRows(client);
    await migrate(drizzle(client), { migrationsFolder });
    const total = await journalRows(client);
    return { applied: total - before, total };
  } finally {
    await client.end();
  }
}
