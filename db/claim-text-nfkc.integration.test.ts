import { readFileSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { assembleBody } from "../lib/cv/body";
import { saveCvVersion } from "../lib/cv/save-cv-version";
import { normaliseClaimText } from "../lib/cv/spans";
import * as s from "./schema";
import { closePool, inRolledBackTransaction, type TestDb } from "./test/database";
import { insertCvVersion, insertUser } from "./test/fixtures";

// #28: 0004 rewrites every stored `text_normalised` to what `normaliseClaimText` now returns. The
// global setup has already applied it to an empty database, so each test writes pre-#28 rows and runs
// the file's SQL again over them.

afterAll(closePool);

const MIGRATION = readFileSync("db/migrations/0004_claim-text-nfkc.sql", "utf8");

async function migrate(db: TestDb) {
  for (const statement of MIGRATION.split("--> statement-breakpoint")) {
    await db.execute(sql.raw(statement));
  }
}

/** `normaliseClaimText` before #28: whitespace only. */
const beforeNfkc = (text: string) => text.replace(/\s+/gu, " ").trim();

// Each one differs between the two normalisers, except the last, which must be left alone.
const ORIGINALS = [
  "請求処理を　４０％\n\n短縮 ",
  "普通自動車第一種運転免許（AT限定）",
  "ＡＷＳ 認定",
  "ｼｽﾃﾑ開発でｶﾞｲﾄﾞを作成",
  "㈱テストで①を担当",
  "A ¨ B",
  "x y　﻿z",
  "Led AWS migration.",
];

describe("0004_claim-text-nfkc", () => {
  it("rewrites every stored key to what normaliseClaimText now returns, and nothing else", () =>
    inRolledBackTransaction(async (db) => {
      const userId = await insertUser(db);
      const cvVersionId = await insertCvVersion(db, userId);
      const [{ body }] = await db.select({ body: s.cvVersions.body }).from(s.cvVersions).where(eq(s.cvVersions.id, cvVersionId));
      const inserted = await db
        .insert(s.cvClaims)
        .values(ORIGINALS.map((text, index) => ({ cvVersionId, userId, textNormalised: beforeNfkc(text), spanStart: index, spanEnd: index + 1 })))
        .returning();

      await migrate(db);

      const rows = await db.select().from(s.cvClaims).where(eq(s.cvClaims.cvVersionId, cvVersionId));
      const byId = new Map(rows.map((row) => [row.id, row]));
      expect(rows).toHaveLength(ORIGINALS.length);
      inserted.forEach((before, index) => {
        const after = byId.get(before.id)!;
        expect(after.textNormalised).toBe(normaliseClaimText(ORIGINALS[index]));
        expect({ ...after, textNormalised: before.textNormalised }).toEqual(before);
      });
      const [{ body: bodyAfter }] = await db.select({ body: s.cvVersions.body }).from(s.cvVersions).where(eq(s.cvVersions.id, cvVersionId));
      expect(bodyAfter).toBe(body);
    }));

  it("lets the first version saved after it carry forward from a version saved before it", () =>
    inRolledBackTransaction(async (db) => {
      const userId = await insertUser(db);
      const save = (text: string, normalise: (text: string) => string) => {
        const { body, ranges } = assembleBody([text]);
        return saveCvVersion(db, {
          userId,
          language: "ja",
          documents: [{ kind: "rirekisho", title: null, sourceFilename: null, text }],
          body,
          ranges,
          claims: [{ span: ranges[0], textNormalised: normalise(text) }],
          extractorModelId: "fake-extractor",
          extractorPromptVersion: "cv-extract-ja-fake",
        });
      };

      const v1 = await save("普通自動車第一種運転免許（AT限定）", beforeNfkc);
      await migrate(db);
      const v2 = await save("普通自動車第一種運転免許(AT限定)", normaliseClaimText);

      expect(v1.unchanged).toBe(false);
      expect(v2).toMatchObject({ unchanged: false, carriedForward: 1 });
    }));
});
