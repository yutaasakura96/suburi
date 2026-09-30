import { Readable } from "node:stream";
import { Client, type ClientBase } from "pg";
import type { Config } from "../config";
import { createDump } from "./dump";
import { type BackupStore, s3BackupStore } from "./store";

// Relative imports: the integration tests load this file outside Next's path aliases.

export type BackupOutcome =
  | { readonly ok: true; readonly key: string; readonly bytes: number; readonly durationMs: number }
  | { readonly ok: false; readonly key: string; readonly errorClass: string; readonly durationMs: number };

export interface BackupDeps {
  /** A connection of the dump's own, opened for it and ended after: never a pooled one. */
  readonly connect: () => Promise<ClientBase & { end(): Promise<void> }>;
  readonly store: BackupStore;
}

/** `backups/2026-09-30T19-12-40.123Z.sql`: the run's own instant, so no two runs share a key. */
export function backupKey(now: Date) {
  return `backups/${now.toISOString().replaceAll(":", "-")}.sql`;
}

/** An SQLSTATE, a DumpError, S3's error code or Node's system code; never a message (12 §7). */
export function backupErrorClass(error: unknown): string {
  const cause = ((error as { cause?: unknown })?.cause ?? error) as { code?: unknown; name?: unknown; $metadata?: unknown };
  if (typeof cause.code === "string" && /^[0-9A-Z]{5}$/.test(cause.code)) return `pg_${cause.code}`;
  if (cause.name === "DumpError") return "dump_refused";
  if (cause.$metadata !== undefined && typeof cause.name === "string" && /^[A-Za-z]+$/.test(cause.name)) return `s3_${cause.name}`;
  if (typeof cause.code === "string" && /^[A-Z][A-Z0-9_]+$/.test(cause.code)) return `node_${cause.code}`;
  return "unexpected";
}

function log(level: "info" | "error", fields: Record<string, string | number>) {
  console[level](JSON.stringify(fields));
}

/**
 * The daily dump (12 §8), written by `self-check`: every table but the left-out three, from one
 * `repeatable read` snapshot, streamed into the store under a dated key. **Never throws**: a failure is
 * an outcome, which `self-check` records as a red reading beside its others. The log line carries the
 * key, size, duration and error class only (12 §7).
 */
export async function runBackup(deps: BackupDeps, now: Date): Promise<BackupOutcome> {
  const key = backupKey(now);
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);

  let client: Awaited<ReturnType<BackupDeps["connect"]>> | undefined;
  try {
    client = await deps.connect();
    await client.query("begin isolation level repeatable read read only");
    const dump = createDump(client, now);
    let bytes = 0;
    const counted = Readable.from((async function* () {
      for await (const chunk of dump.chunks) {
        bytes += chunk.length;
        yield chunk;
      }
    })());
    await deps.store.put(key, counted);
    await client.query("commit");
    const outcome = { ok: true, key, bytes, durationMs: elapsed() } as const;
    log("info", { event: "backup_dump", key, bytes, duration_ms: outcome.durationMs });
    return outcome;
  } catch (error) {
    const outcome = { ok: false, key, errorClass: backupErrorClass(error), durationMs: elapsed() } as const;
    log("error", { event: "backup_dump_failed", key, error_class: outcome.errorClass, duration_ms: outcome.durationMs });
    return outcome;
  } finally {
    // Ending the connection also ends a transaction a failure left open.
    await client?.end().catch(() => undefined);
  }
}

/**
 * Production's dump: `DATABASE_URL_UNPOOLED` (verify-full, `lib/config.ts`) into the bucket's
 * `backups/` with the backup-writer's key. Undefined where that key is not set, which is everywhere
 * but production (12 §2); `self-check` then writes no dump and its backup row is no reading.
 */
export function configuredBackup(config: Config): ((now: Date) => Promise<BackupOutcome>) | undefined {
  const { BACKUP_AWS_ACCESS_KEY_ID: accessKeyId, BACKUP_AWS_SECRET_ACCESS_KEY: secretAccessKey } = config;
  if (accessKeyId === undefined || secretAccessKey === undefined) return undefined;
  const deps: BackupDeps = {
    connect: async () => {
      const client = new Client({ connectionString: config.DATABASE_URL_UNPOOLED });
      await client.connect();
      return client;
    },
    store: s3BackupStore({ region: config.AWS_REGION, bucket: config.S3_BUCKET, accessKeyId, secretAccessKey }),
  };
  return (now) => runBackup(deps, now);
}
