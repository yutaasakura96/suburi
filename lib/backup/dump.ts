import type { ClientBase } from "pg";
import { to as copyTo } from "pg-copy-streams";
import journal from "../../db/migrations/meta/_journal.json";

// Relative imports: the integration tests load this file outside Next's path aliases.

/**
 * Left out of every dump (12 §8, 06 2026-09-29): session tokens and Google's OAuth tokens. A restore
 * does not need them, since signing in again rebuilds them, and a file kept forever must not carry
 * credentials.
 */
export const EXCLUDED_TABLES: readonly string[] = ["sessions", "accounts", "verifications"];

/** The dump cannot be written as asked: a dumped table references a left-out one, or the keys cycle. */
export class DumpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DumpError";
  }
}

interface Table {
  readonly name: string;
  readonly columns: readonly string[];
}

export interface DumpSummary {
  tables: number;
  rows: number;
}

const NEWLINE = 0x0a;

function ident(name: string) {
  return `"${name.replaceAll('"', '""')}"`;
}

function literal(text: string) {
  return `'${text.replaceAll("'", "''")}'`;
}

function qualified(table: Table) {
  return `public.${ident(table.name)}`;
}

/** Every ordinary and partitioned table in `public`, bar the left-out three and extension members. */
async function listTables(client: ClientBase): Promise<Table[]> {
  const result = await client.query<{ name: string; columns: string[] }>(`
    select c.relname::text as name, array_agg(a.attname::text order by a.attnum) as columns
    from pg_class c
    join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped and a.attgenerated = ''
    where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and not c.relispartition
      and not exists (select 1 from pg_depend d where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e')
    group by c.relname`);
  return result.rows.filter((table) => !EXCLUDED_TABLES.includes(table.name));
}

/**
 * Parents before children, so every row lands after the row it references: the restore target has
 * its foreign keys in place. A self-reference is checked at the end of its own COPY, so it needs no
 * order. Ties go by name, so the same schema always dumps in the same order.
 */
async function inLoadOrder(client: ClientBase, tables: Table[]): Promise<Table[]> {
  const result = await client.query<{ child: string; parent: string }>(`
    select child.relname::text as child, parent.relname::text as parent
    from pg_constraint k
    join pg_class child on child.oid = k.conrelid
    join pg_class parent on parent.oid = k.confrelid
    where k.contype = 'f' and child.relnamespace = 'public'::regnamespace and k.conrelid <> k.confrelid`);

  const dumped = new Map(tables.map((table) => [table.name, table]));
  const parents = new Map(tables.map((table) => [table.name, new Set<string>()]));
  for (const { child, parent } of result.rows) {
    if (!dumped.has(child)) continue;
    if (!dumped.has(parent)) throw new DumpError(`${child} references ${parent}, which is not dumped`);
    parents.get(child)!.add(parent);
  }

  const ordered: Table[] = [];
  while (parents.size > 0) {
    const ready = [...parents].filter(([, pending]) => pending.size === 0).map(([name]) => name).sort();
    if (ready.length === 0) throw new DumpError(`foreign keys cycle through ${[...parents.keys()].sort().join(", ")}`);
    for (const name of ready) {
      ordered.push(dumped.get(name)!);
      parents.delete(name);
      for (const pending of parents.values()) pending.delete(name);
    }
  }
  return ordered;
}

const JOURNAL = "drizzle.__drizzle_migrations";

async function hasJournal(client: ClientBase) {
  const result = await client.query<{ present: boolean }>(`select to_regclass('${JOURNAL}') is not null as present`);
  return result.rows[0].present;
}

/** The migration the database is at, by its `db/migrations` tag, so a restorer knows what to migrate to. */
async function schemaNote(client: ClientBase) {
  const result = await client.query<{ created_at: string | null }>(`
    select case when to_regclass('drizzle.__drizzle_migrations') is null then null
      else (select max(created_at)::text from drizzle.__drizzle_migrations) end as created_at`);
  const when = result.rows[0]?.created_at;
  if (when === null || when === undefined) return "no drizzle migrations table: migrate the target to match by hand";
  const entry = journal.entries.find((candidate) => String(candidate.when) === when);
  return entry ? `migrated through db/migrations ${entry.tag}` : `migrated through the journal entry dated ${when}, newer than this build`;
}

function header(tables: readonly Table[], takenAt: Date, schema: string) {
  const empty = tables.map((table) =>
    `  IF EXISTS (SELECT 1 FROM ${qualified(table)}) THEN RAISE EXCEPTION ${literal(`restore target is not empty: ${table.name}`)}; END IF;`);
  return [
    `-- Suburi daily backup (docs/12-deployment.md §8). Data only, schema public, taken ${takenAt.toISOString()}.`,
    `-- Left out: ${EXCLUDED_TABLES.join(", ")}. Signing in again rebuilds them.`,
    `-- Restore onto an empty database whose schema is ${schema}, such as a Neon branch`,
    "-- made Schema only from main:",
    "--   psql \"$DATABASE_URL_UNPOOLED\" -f <this file>",
    "-- One transaction. It refuses a target that already holds rows, and checks every table's row count",
    "-- before it commits; a file cut short commits nothing. drizzle's migration journal travels too, written",
    "-- only where the target's is empty, so a restored branch that is promoted migrates from where it was.",
    "\\set ON_ERROR_STOP on",
    "SET client_encoding = 'UTF8';",
    "SET standard_conforming_strings = on;",
    "SET datestyle = 'ISO, YMD';",
    "SET intervalstyle = 'postgres';",
    "BEGIN;",
    "DO $restore$",
    "BEGIN",
    ...empty,
    "END",
    "$restore$;",
    "",
  ].join("\n");
}

/**
 * The journal's rows go to a temporary table, then into the target's journal only if that is empty: a
 * Schema only branch has the table and no rows, and a target `drizzle-kit migrate` built already holds
 * the same rows. Without them a promoted branch would re-run every migration from the first.
 */
function journalRestore() {
  return [
    "DO $restore$",
    "BEGIN",
    `  IF NOT EXISTS (SELECT 1 FROM ${JOURNAL}) THEN`,
    `    INSERT INTO ${JOURNAL} (id, hash, created_at) SELECT id, hash, created_at FROM pg_temp.restore_journal ORDER BY id;`,
    `    PERFORM setval(pg_get_serial_sequence('${JOURNAL}', 'id'), max(id)) FROM ${JOURNAL};`,
    "  END IF;",
    "END",
    "$restore$;",
    "",
  ].join("\n");
}

function footer(counts: readonly [Table, number][]) {
  const checks = counts.map(([table, rows]) =>
    `  IF (SELECT count(*) FROM ${qualified(table)}) <> ${rows} THEN RAISE EXCEPTION ${literal(`row count differs: ${table.name}`)}; END IF;`);
  const rows = counts.reduce((sum, [, n]) => sum + n, 0);
  return [
    "DO $restore$",
    "BEGIN",
    ...checks,
    "END",
    "$restore$;",
    "COMMIT;",
    `-- Complete: ${counts.length} tables, ${rows} rows.`,
    "",
  ].join("\n");
}

/**
 * A logical dump of every table's rows as a psql script: `COPY … FROM stdin` blocks in load order,
 * the text Postgres itself writes for `COPY … TO STDOUT`, streamed a chunk at a time. **Call it inside
 * a `repeatable read` transaction**, which is the one snapshot every table is read from; it sets its
 * own output settings with `set local`.
 *
 * Data only: the schema is the migrations in git (12 §8), and the header names the one to restore
 * onto. drizzle's journal rows come last, outside `summary`. `summary` is filled in as the dump is read.
 */
export function createDump(client: ClientBase, takenAt: Date) {
  const summary: DumpSummary = { tables: 0, rows: 0 };

  async function* chunks(): AsyncGenerator<Buffer> {
    // pg_dump's own choices: dates and intervals in a style any server reads back, floats exact.
    await client.query("set local datestyle = 'ISO, YMD'");
    await client.query("set local intervalstyle = 'postgres'");
    await client.query("set local extra_float_digits = 3");
    await client.query("set local timezone = 'UTC'");

    const tables = await inLoadOrder(client, await listTables(client));
    yield Buffer.from(header(tables, takenAt, await schemaNote(client)));

    const counts: [Table, number][] = [];
    for (const table of tables) {
      const columns = table.columns.map(ident).join(", ");
      yield Buffer.from(`COPY ${qualified(table)} (${columns}) FROM stdin;\n`);
      let rows = 0;
      // Every row of COPY's text format ends in a newline, and a newline inside a value is escaped.
      for await (const chunk of client.query(copyTo(`COPY (SELECT ${columns} FROM ${qualified(table)}) TO STDOUT`))) {
        const data = chunk as Buffer;
        for (let at = data.indexOf(NEWLINE); at !== -1; at = data.indexOf(NEWLINE, at + 1)) rows++;
        yield data;
      }
      yield Buffer.from("\\.\n\n");
      counts.push([table, rows]);
      summary.tables++;
      summary.rows += rows;
    }

    if (await hasJournal(client)) {
      yield Buffer.from("CREATE TEMPORARY TABLE restore_journal (id integer, hash text, created_at bigint) ON COMMIT DROP;\n");
      yield Buffer.from("COPY pg_temp.restore_journal (id, hash, created_at) FROM stdin;\n");
      for await (const chunk of client.query(copyTo(`COPY (SELECT id, hash, created_at FROM ${JOURNAL} ORDER BY id) TO STDOUT`))) {
        yield chunk as Buffer;
      }
      yield Buffer.from(`\\.\n\n${journalRestore()}`);
    }
    yield Buffer.from(footer(counts));
  }

  return { chunks: chunks(), summary };
}
