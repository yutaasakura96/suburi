import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import * as s from "../../db/schema";
import { TEST_URL } from "../../db/test/database";
import { insertUser } from "../../db/test/fixtures";
import { assembleBody } from "./body";
import { saveCvVersion } from "./save-cv-version";
import { normaliseClaimText } from "./spans";

// Two real connections and real commits: a lock cannot be observed inside one rolled-back
// transaction. The rows are under a fresh user in a database rebuilt every run (global-setup.ts).

const pool = new Pool({ connectionString: TEST_URL, max: 2 });
afterAll(() => pool.end());

// A CV document and, optionally, one supporting document; each document's whole text is one claim.
function input(userId: string, text: string, supporting?: string) {
  const texts = supporting ? [text, supporting] : [text];
  const { body, ranges } = assembleBody(texts);
  return {
    userId,
    language: "en" as const,
    documents: texts.map((part, index) =>
      index === 0
        ? { kind: "cv" as const, title: null, sourceFilename: null, text: part }
        : { kind: "additional" as const, title: "Certificates", sourceFilename: null, text: part },
    ),
    body,
    ranges,
    claims: texts.map((part, index) => ({ span: ranges[index], textNormalised: normaliseClaimText(part) })),
    extractorModelId: "fake-extractor",
    extractorPromptVersion: "cv-extract-en-fake",
  };
}

async function begin() {
  const client = await pool.connect();
  await client.query("begin");
  // Pins this transaction's now() here, before the other one starts.
  await client.query("select now()");
  return client;
}

async function commit(client: PoolClient) {
  await client.query("commit");
  client.release();
}

const pending = Symbol("pending");

describe("saveCvVersion across two connections", () => {
  it("serialises saves in a language: the second waits, becomes v2, carries forward, and is dated after v1", async () => {
    const userId = await insertUser(drizzle(pool));

    // B's transaction starts first, so its now() is the earlier one; A takes the lock first.
    const b = await begin();
    const a = await begin();
    const first = await saveCvVersion(drizzle(a), input(userId, "Led a team of 5."));

    const second = saveCvVersion(drizzle(b), input(userId, "Led a team of 5.", "AWS certified."));
    const early = await Promise.race([second, new Promise((resolve) => setTimeout(() => resolve(pending), 300))]);
    expect(early, "B wrote while A held the lock").toBe(pending);

    await commit(a);
    const saved = await second;
    await commit(b);

    expect(first).toMatchObject({ unchanged: false, version: { versionLabel: "CV v1" } });
    expect(saved).toMatchObject({ unchanged: false, version: { versionLabel: "CV v2" }, carriedForward: 1 });

    const versions = await drizzle(pool).select().from(s.cvVersions).where(eq(s.cvVersions.userId, userId));
    const [v1, v2] = versions.sort((x, y) => x.versionLabel.localeCompare(y.versionLabel));
    expect(v2.createdAt.getTime()).toBeGreaterThan(v1.createdAt.getTime());
  });

  it("refuses the second of two identical saves as unchanged once the first commits", async () => {
    const userId = await insertUser(drizzle(pool));
    const a = await begin();
    const b = await begin();
    await saveCvVersion(drizzle(a), input(userId, "Led a team of 5."));
    const second = saveCvVersion(drizzle(b), input(userId, "Led a team of 5."));
    await commit(a);
    expect(await second).toEqual({ unchanged: true, versionLabel: "CV v1" });
    await commit(b);

    const versions = await drizzle(pool).select().from(s.cvVersions).where(eq(s.cvVersions.userId, userId));
    expect(versions).toHaveLength(1);
  });
});
