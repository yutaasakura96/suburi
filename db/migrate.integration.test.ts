import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { applyMigrations } from "./migrate";
import { ADMIN_URL } from "./test/database";

// The step a develop deploy runs before its build (docs/12-deployment.md §4). Each test gets an empty
// database of its own on the local (or CI service) Postgres; suburi_test is left alone.
const DATABASE = "suburi_migrate_test";
const MIGRATE_URL = ADMIN_URL.replace(/\/postgres$/, `/${DATABASE}`);
const FOLDER = "db/migrations";

type Journal = { entries: { idx: number; when: number; tag: string }[] };

const journal = JSON.parse(readFileSync(join(FOLDER, "meta/_journal.json"), "utf8")) as Journal;
const total = journal.entries.length;
const temporary: string[] = [];

// A copy of the real migrations with the journal rewritten: what the folder was one merge ago, or
// what it would be with a migration that cannot apply.
function folderWith(rewrite: (journal: Journal, folder: string) => void): string {
  const folder = mkdtempSync(join(tmpdir(), "suburi-migrations-"));
  temporary.push(folder);
  cpSync(FOLDER, folder, { recursive: true });
  const copy = structuredClone(journal);
  rewrite(copy, folder);
  writeFileSync(join(folder, "meta/_journal.json"), JSON.stringify(copy));
  return folder;
}

async function admin(statement: string) {
  const client = new Client({ connectionString: ADMIN_URL });
  await client.connect();
  try {
    await client.query(statement);
  } finally {
    await client.end();
  }
}

async function query<Row>(statement: string): Promise<Row[]> {
  const client = new Client({ connectionString: MIGRATE_URL });
  await client.connect();
  try {
    return (await client.query(statement)).rows as Row[];
  } finally {
    await client.end();
  }
}

async function applied(): Promise<number> {
  const [row] = await query<{ count: number }>("select count(*)::int as count from drizzle.__drizzle_migrations");
  return row.count;
}

async function tableExists(name: string): Promise<boolean> {
  const [row] = await query<{ found: boolean }>(`select to_regclass('public.${name}') is not null as found`);
  return row.found;
}

beforeEach(async () => {
  await admin(`drop database if exists ${DATABASE} with (force)`);
  await admin(`create database ${DATABASE}`);
});

afterAll(async () => {
  await admin(`drop database if exists ${DATABASE} with (force)`);
  for (const folder of temporary) rmSync(folder, { recursive: true, force: true });
});

describe("applyMigrations", () => {
  it("builds an empty database from the first migration to the last", async () => {
    expect(await applyMigrations(MIGRATE_URL)).toEqual({ applied: total, total });
    expect(await applied()).toBe(total);
    expect(await tableExists("answers")).toBe(true);
  });

  it("applies nothing to a database that is already current", async () => {
    await applyMigrations(MIGRATE_URL);

    expect(await applyMigrations(MIGRATE_URL)).toEqual({ applied: 0, total });
  });

  it("applies only the pending migration to a database one behind", async () => {
    const oneBehind = folderWith((copy) => copy.entries.pop());
    expect(await applyMigrations(MIGRATE_URL, oneBehind)).toEqual({ applied: total - 1, total: total - 1 });

    expect(await applyMigrations(MIGRATE_URL)).toEqual({ applied: 1, total });
  });

  it("rejects on a migration that cannot apply, and leaves the database as it was", async () => {
    await applyMigrations(MIGRATE_URL);
    const broken = folderWith((copy, folder) => {
      const last = copy.entries[copy.entries.length - 1];
      copy.entries.push({ ...last, idx: total, when: Date.now(), tag: "9999_broken" });
      writeFileSync(
        join(folder, "9999_broken.sql"),
        "create table half_applied (id integer);\n--> statement-breakpoint\nalter table no_such_table add column x integer;",
      );
    });

    await expect(applyMigrations(MIGRATE_URL, broken)).rejects.toThrow();
    expect(await applied()).toBe(total);
    expect(await tableExists("half_applied")).toBe(false);
  });

  // Two develop deploys can build at once. Unserialised, both would read an empty journal and the
  // second would fail on the first's tables.
  it("serialises two runs against one database", async () => {
    const results = await Promise.all([applyMigrations(MIGRATE_URL), applyMigrations(MIGRATE_URL)]);

    expect(results.map((result) => result.applied).sort()).toEqual([0, total]);
    expect(await applied()).toBe(total);
  });
});
