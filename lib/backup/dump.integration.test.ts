import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client, type ClientBase } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as s from "../../db/schema";
import { ADMIN_URL, TEST_URL, closePool, inRolledBackTransaction, type TestDb } from "../../db/test/database";
import { answerValues, attemptValues, insertWorld, roundValues } from "../../db/test/fixtures";
import { EXCLUDED_TABLES, createDump } from "./dump";
import { fakeBackupStore } from "./fake-store";
import { backupKey, runBackup } from "./run";

// #56: the daily dump, against the migrated test database, restored with psql into fresh databases
// built by the same migrations. Synthetic rows only (11 §8).

const TAKEN_AT = new Date("2030-01-02T04:00:00Z");
// Credentials the dump must never carry (12 §8).
const TOKEN_SENTINEL = "OAUTH-TOKEN-SENTINEL-7731";
// COPY's text format has to escape all of these, and the restore has to read them back exactly.
const AWKWARD = "tab\there\nnewline\r\\backslash 'quote' \"double\"\n\\.\n架空の株式会社で請求処理を40%短縮。";

const scratch = mkdtempSync(join(tmpdir(), "suburi-dump-"));
const created: string[] = [];

async function admin(sql: string) {
  const client = new Client({ connectionString: ADMIN_URL });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

/** A new database with only the migrations applied: the shape of a Neon branch made Schema only. */
async function freshDatabase() {
  const name = `suburi_restore_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  await admin(`create database ${name}`);
  created.push(name);
  const url = ADMIN_URL.replace(/\/postgres$/, `/${name}`);
  await migrateTo(url);
  return url;
}

/** `psql -f`, as 12 §8's restore path runs it. Throws on a non-zero exit. */
function psql(url: string, dump: Buffer) {
  const file = join(scratch, `${randomUUID()}.sql`);
  writeFileSync(file, dump);
  return execFileSync("psql", [url, "--no-psqlrc", "--quiet", "-f", file], { stdio: "pipe" }).toString();
}

async function withClient<T>(url: string, work: (client: Client) => Promise<T>) {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

async function publicTables(client: ClientBase) {
  const result = await client.query<{ name: string }>(
    `select relname::text as name from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' order by 1`,
  );
  return result.rows.map((row) => row.name);
}

/** Each table's row count and a digest of its rows' full text, in a stable order. */
async function fingerprint(client: ClientBase) {
  const out: Record<string, { rows: number; digest: string | null }> = {};
  for (const name of await publicTables(client)) {
    const result = await client.query<{ rows: number; digest: string | null }>(
      `select count(*)::int as rows, md5(string_agg(t::text, '|' order by t::text)) as digest from public."${name}" t`,
    );
    out[name] = result.rows[0];
  }
  return out;
}

async function journalOf(client: ClientBase) {
  const result = await client.query<{ id: number; hash: string; created_at: string }>(
    "select id, hash, created_at::text from drizzle.__drizzle_migrations order by id",
  );
  return result.rows;
}

async function migrateTo(url: string) {
  const db = drizzle(url);
  try {
    await migrate(db, { migrationsFolder: "db/migrations" });
  } finally {
    await db.$client.end();
  }
}

async function dumpOf(client: ClientBase) {
  const dump = createDump(client, TAKEN_AT);
  const chunks: Buffer[] = [];
  for await (const chunk of dump.chunks) chunks.push(chunk);
  return { bytes: Buffer.concat(chunks), summary: dump.summary };
}

/** A row in every table the schema has, each column type the dump must carry, and the three left out. */
async function seedEverything(db: TestDb) {
  const world = await insertWorld(db);
  const [cv] = await db
    .insert(s.cvVersions)
    .values({ userId: world.userId, versionLabel: "応募書類 v2", language: "en", body: AWKWARD, spansRejected: 0, unclaimedRunMax: 1_071 })
    .returning({ id: s.cvVersions.id });
  await db.insert(s.cvDocuments).values({ cvVersionId: cv.id, userId: world.userId, kind: "cv", position: 1, start: 0, end: 3, sourceFilename: "cv.pdf" });
  const [claim] = await db
    .insert(s.cvClaims)
    .values({ cvVersionId: cv.id, userId: world.userId, textNormalised: "tab", spanStart: 0, spanEnd: 3 })
    .returning({ id: s.cvClaims.id });
  const [question] = await db.insert(s.questions).values({
    userId: world.userId,
    language: "en",
    roundType: "behavioural",
    origin: "generated",
    body: AWKWARD,
    embedding: Array.from({ length: 1536 }, (_, i) => (i % 7) / 7 - 0.4),
    generatorModelId: "fixture-model",
    generatorPromptVersion: "generate-fixture",
    tokensIn: 1_200,
    tokensOut: 300,
  }).returning({ id: s.questions.id });
  const [round] = await db.insert(s.rounds).values(roundValues(world, { completedAt: TAKEN_AT })).returning({ id: s.rounds.id });
  await db.insert(s.roundQuestions).values({ roundId: round.id, userId: world.userId, position: 1, questionId: question.id });
  const [first] = await db
    .insert(s.answers)
    .values(answerValues(world, round.id, { transcriptRaw: AWKWARD, transcriptCorrected: null, rewriteMagnitude: 0.125, isFirstAttempt: true }))
    .returning({ id: s.answers.id });
  // Self-references in both directions: a follow-up and a retry.
  await db.insert(s.answers).values(answerValues(world, round.id, { questionId: null, parentAnswerId: first.id, position: 2 }));
  await db.insert(s.answers).values(answerValues(world, round.id, { retryOfAnswerId: first.id, position: 3 }));
  await db.insert(s.followUps).values({
    parentAnswerId: first.id,
    userId: world.userId,
    status: "generated",
    promptText: AWKWARD,
    modelId: "fixture-model",
    promptVersion: "follow-up-fixture",
    tokensIn: 400,
    tokensOut: 20,
  });
  const [attempt] = await db
    .insert(s.scoringAttempts)
    .values({ ...attemptValues(world, first.id), status: "ok", tokensIn: 3_000, tokensOut: 600 })
    .returning({ id: s.scoringAttempts.id });
  const [rescore] = await db
    .insert(s.scoringAttempts)
    .values({ ...attemptValues(world, first.id), status: "failed", errorClass: "upstream_timeout" })
    .returning({ id: s.scoringAttempts.id });
  await db.insert(s.heldOutRescores).values({ answerId: first.id, baselineAttemptId: attempt.id, rescoreAttemptId: rescore.id });
  await db.insert(s.scores).values({ scoringAttemptId: attempt.id, dimension: "structure", value: 3, justification: AWKWARD });
  await db.insert(s.claimCitations).values({ answerId: first.id, cvClaimId: claim.id, relation: "supported_by" });
  await db.insert(s.roundFeedback).values({
    roundId: round.id,
    toFix: [{ point: AWKWARD, nested: { n: 1.5, list: [null, true] } }],
    whatWorked: AWKWARD,
    language: "en",
    modelId: "fixture-model",
    promptVersion: "feedback-fixture",
  });
  const [run] = await db.insert(s.cronRuns).values({ job: "self-check" }).returning({ id: s.cronRuns.id });
  await db.insert(s.cronReadings).values({
    runId: run.id,
    userId: world.userId,
    signal: "spend_week_to_date_usd",
    value: 0.1 + 0.2,
    threshold: 1.2,
    isRed: true,
    subjectIds: [attempt.id],
    unpricedModelIds: ["unpriced-model", null],
    windowStart: new Date("2029-12-30T15:00:00Z"),
    windowEnd: new Date("2030-01-06T15:00:00Z"),
  });
  await db.insert(s.rateLimitWindows).values({ userId: world.userId, sessionId: "session-fixture", route: "cv-versions", windowStartedAt: TAKEN_AT, count: 2 });

  await db.insert(s.sessions).values({ id: randomUUID(), userId: world.userId, token: TOKEN_SENTINEL, expiresAt: TAKEN_AT });
  await db.insert(s.accounts).values({ id: randomUUID(), userId: world.userId, accountId: "google-fixture", providerId: "google", accessToken: TOKEN_SENTINEL, refreshToken: TOKEN_SENTINEL, idToken: TOKEN_SENTINEL });
  await db.insert(s.verifications).values({ id: randomUUID(), identifier: "fixture", value: TOKEN_SENTINEL, expiresAt: TAKEN_AT });
}

/** Seeds every table, then dumps and fingerprints from one repeatable-read snapshot. */
async function seededDump() {
  let result:
    | { bytes: Buffer; summary: { tables: number; rows: number }; source: Awaited<ReturnType<typeof fingerprint>>; journal: Awaited<ReturnType<typeof journalOf>> }
    | undefined;
  await inRolledBackTransaction(async (db) => {
    const client = (db as TestDb & { $client: ClientBase }).$client;
    await client.query("set transaction isolation level repeatable read");
    await seedEverything(db);
    const { bytes, summary } = await dumpOf(client);
    result = { bytes, summary, source: await fingerprint(client), journal: await journalOf(client) };
  });
  return result!;
}

let seeded: Awaited<ReturnType<typeof seededDump>>;

beforeAll(async () => {
  seeded = await seededDump();
});

afterAll(async () => {
  await closePool();
  for (const name of created) await admin(`drop database if exists ${name} with (force)`);
  rmSync(scratch, { recursive: true, force: true });
});

describe("the daily dump (12 §8)", () => {
  it("restores with psql into a fresh database: every table's rows, exactly", async () => {
    const url = await freshDatabase();
    psql(url, seeded.bytes);
    const restored = await withClient(url, fingerprint);

    for (const [name, table] of Object.entries(seeded.source)) {
      if (EXCLUDED_TABLES.includes(name)) continue;
      expect(table.rows, name).toBeGreaterThan(0);
      expect(restored[name], name).toEqual(table);
    }
    expect(seeded.summary.rows).toBe(
      Object.entries(seeded.source).filter(([name]) => !EXCLUDED_TABLES.includes(name)).reduce((n, [, table]) => n + table.rows, 0),
    );
  });

  it("leaves out sessions, accounts and verifications, and every token in them", async () => {
    const text = seeded.bytes.toString("utf8");
    for (const name of EXCLUDED_TABLES) {
      expect(seeded.source[name].rows, name).toBeGreaterThan(0);
      expect(text).not.toContain(`public."${name}"`);
    }
    expect(text).not.toContain(TOKEN_SENTINEL);

    const url = await freshDatabase();
    psql(url, seeded.bytes);
    const restored = await withClient(url, fingerprint);
    for (const name of EXCLUDED_TABLES) expect(restored[name].rows, name).toBe(0);
  });

  it("names the migration to restore onto, and every table but the three", async () => {
    const journal = (await import("../../db/migrations/meta/_journal.json")).default;
    const text = seeded.bytes.toString("utf8");
    expect(text).toContain(`migrated through db/migrations ${journal.entries.at(-1)!.tag}`);
    const copied = [...text.matchAll(/^COPY public\."([^"]+)"/gm)].map((match) => match[1]).sort();
    expect(copied).toEqual(Object.keys(seeded.source).filter((name) => !EXCLUDED_TABLES.includes(name)).sort());
  });

  it("carries drizzle's journal onto a Schema only target, so migrate afterwards applies nothing", async () => {
    const url = await freshDatabase();
    await withClient(url, (client) => client.query("delete from drizzle.__drizzle_migrations"));
    psql(url, seeded.bytes);
    expect(seeded.journal.length).toBeGreaterThan(0);
    expect(await withClient(url, journalOf)).toEqual(seeded.journal);

    const before = await withClient(url, fingerprint);
    await migrateTo(url);
    expect(await withClient(url, journalOf)).toEqual(seeded.journal);
    expect(await withClient(url, fingerprint)).toEqual(before);
    const next = await withClient(url, (client) => client.query<{ id: number }>("select nextval(pg_get_serial_sequence('drizzle.__drizzle_migrations', 'id'))::int as id"));
    expect(next.rows[0].id).toBe(Math.max(...seeded.journal.map((row) => row.id)) + 1);
  });

  it("leaves the journal of a target drizzle-kit migrate built as it was", async () => {
    const url = await freshDatabase();
    const before = await withClient(url, journalOf);
    psql(url, seeded.bytes);
    expect(await withClient(url, journalOf)).toEqual(before);
  });

  it("refuses a target at another migration, and writes neither rows nor journal to it", async () => {
    const url = await freshDatabase();
    await withClient(url, async (client) => {
      await client.query("alter table public.rounds add column later_migration text");
      await client.query("delete from drizzle.__drizzle_migrations");
    });
    expect(() => psql(url, seeded.bytes)).toThrow(/restore target schema differs from the dump's \(migrated through db\/migrations /);
    const restored = await withClient(url, fingerprint);
    for (const [name, table] of Object.entries(restored)) expect(table.rows, name).toBe(0);
    expect(await withClient(url, journalOf)).toEqual([]);
  });

  it("refuses a target that already holds rows, and writes nothing to it", async () => {
    const url = await freshDatabase();
    psql(url, seeded.bytes);
    const before = await withClient(url, fingerprint);
    expect(() => psql(url, seeded.bytes)).toThrow(/restore target is not empty/);
    expect(await withClient(url, fingerprint)).toEqual(before);
  });

  it("commits nothing from a file cut short", async () => {
    const url = await freshDatabase();
    const cut = seeded.bytes.subarray(0, seeded.bytes.lastIndexOf("COMMIT;"));
    psql(url, cut);
    const restored = await withClient(url, fingerprint);
    for (const [name, table] of Object.entries(restored)) expect(table.rows, name).toBe(0);
  });
});

describe("runBackup", () => {
  it("streams one snapshot into the store under the run's dated key", async () => {
    const { store, objects } = fakeBackupStore();
    const logged = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const outcome = await runBackup(
      { connect: async () => { const client = new Client({ connectionString: TEST_URL }); await client.connect(); return client; }, store },
      TAKEN_AT,
    );
    const calls = [...logged.mock.calls];
    logged.mockRestore();
    expect(outcome).toMatchObject({ ok: true, key: "backups/2030-01-02T04-00-00.000Z.sql" });
    expect(calls).toHaveLength(1);
    const line = JSON.parse(String(calls[0][0]));
    expect(Object.keys(line).sort()).toEqual(["bytes", "duration_ms", "event", "key"]);
    expect(backupKey(TAKEN_AT)).toBe("backups/2030-01-02T04-00-00.000Z.sql");
    const object = objects.get(outcome.key)!;
    expect(outcome.ok && outcome.bytes).toBe(object.length);
    expect(object.toString("utf8")).toMatch(/COMMIT;\n-- Complete: \d+ tables, \d+ rows\.\n$/);
  });

  it("a refused write is an outcome with S3's error class, never a throw", async () => {
    const refused = Object.assign(new Error(`Access Denied for ${TOKEN_SENTINEL}`), { name: "AccessDenied", $metadata: { httpStatusCode: 403 } });
    const { store, objects } = fakeBackupStore({ failWith: refused });
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const outcome = await runBackup(
        { connect: async () => { const client = new Client({ connectionString: TEST_URL }); await client.connect(); return client; }, store },
        TAKEN_AT,
      );
      expect(outcome).toMatchObject({ ok: false, errorClass: "s3_AccessDenied" });
      expect(objects.size).toBe(0);
      // 12 §7: the key, size, duration and error class, and never the error's message.
      expect(logged).toHaveBeenCalledTimes(1);
      const line = JSON.parse(String(logged.mock.calls[0][0]));
      expect(Object.keys(line).sort()).toEqual(["duration_ms", "error_class", "event", "key"]);
      expect(line).toMatchObject({ event: "backup_dump_failed", key: outcome.key, error_class: "s3_AccessDenied" });
      expect(String(logged.mock.calls[0][0])).not.toContain(TOKEN_SENTINEL);
    } finally {
      logged.mockRestore();
    }
  });

  it("a database it cannot reach is an outcome with the SQLSTATE", async () => {
    const { store } = fakeBackupStore();
    const outcome = await runBackup(
      { connect: async () => { const client = new Client({ connectionString: ADMIN_URL.replace(/\/postgres$/, "/suburi_no_such_database") }); await client.connect(); return client; }, store },
      TAKEN_AT,
    );
    expect(outcome).toMatchObject({ ok: false, errorClass: "pg_3D000" });
  });
});
