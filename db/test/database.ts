import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { expect } from "vitest";
import { sql } from "drizzle-orm";

// Integration tests own a throwaway database on the local (or CI service) Postgres. It is not
// configuration, so it does not go through lib/config.ts.
export const TEST_DATABASE = "suburi_test";
// Host port 5433, matching docker-compose.yml and the CI service container.
const server = "postgresql://suburi:suburi@localhost:5433";
export const ADMIN_URL = `${server}/postgres`;
export const TEST_URL = `${server}/${TEST_DATABASE}`;

export type TestDb = NodePgDatabase;

const pool = new Pool({ connectionString: TEST_URL, max: 1 });

export function closePool() {
  return pool.end();
}

// Each test runs in a transaction that is always rolled back (docs/11-testing-plan.md §2).
export async function inRolledBackTransaction(fn: (db: TestDb) => Promise<void>) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await fn(drizzle(client));
  } finally {
    await client.query("rollback");
    client.release();
  }
}

// restrict is ON DELETE RESTRICT's own code; NO ACTION would raise foreign_key instead, so asserting
// restrict proves the key was declared restrict.
const SQLSTATE = {
  restrict: "23001",
  not_null: "23502",
  foreign_key: "23503",
  unique: "23505",
  check: "23514",
} as const;

type Refusal =
  | { kind: "not_null"; column: string }
  | { kind: "restrict" | "foreign_key" | "unique" | "check"; constraint: string };

type PgError = { code?: string; constraint?: string; column?: string };

// Asserts the database itself refused the write, and which rule refused it. A savepoint keeps the
// surrounding transaction usable afterwards.
export async function expectRefused(db: TestDb, write: () => Promise<unknown>, refusal: Refusal) {
  await db.execute(sql`savepoint refused`);
  let error: unknown;
  try {
    await write();
  } catch (caught) {
    error = caught;
  }
  await db.execute(sql`rollback to savepoint refused`);

  expect(error, "the database accepted a row it must refuse").toBeDefined();
  const pg = ((error as { cause?: PgError }).cause ?? error) as PgError;
  expect(pg.code).toBe(SQLSTATE[refusal.kind]);
  if (refusal.kind === "not_null") expect(pg.column).toBe(refusal.column);
  else expect(pg.constraint).toBe(refusal.constraint);
}
