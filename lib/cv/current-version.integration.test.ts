import { afterAll, describe, expect, it } from "vitest";
import * as s from "../../db/schema";
import { closePool, inRolledBackTransaction, type TestDb } from "../../db/test/database";
import { insertUser } from "../../db/test/fixtures";
import { currentCvVersion } from "./current-version";

afterAll(closePool);

async function insertVersion(db: TestDb, userId: string, label: string, createdAt: string) {
  const [row] = await db
    .insert(s.cvVersions)
    .values({ userId, versionLabel: label, language: "en", body: "Invented CV text.", createdAt: new Date(createdAt) })
    .returning({ id: s.cvVersions.id });
  await db.insert(s.cvDocuments).values({ cvVersionId: row.id, userId, kind: "cv", position: 0, start: 0, end: 17 });
  await db.insert(s.cvClaims).values({ cvVersionId: row.id, userId, textNormalised: "Invented", spanStart: 0, spanEnd: 8 });
  return row.id;
}

describe("currentCvVersion", () => {
  it("is the newest version in that language, with its documents and claim spans", () =>
    inRolledBackTransaction(async (db) => {
      const userId = await insertUser(db);
      await insertVersion(db, userId, "CV v1", "2026-08-01T00:00:00Z");
      const newest = await insertVersion(db, userId, "CV v2", "2026-09-01T00:00:00Z");

      const current = await currentCvVersion(db, userId, "en");
      expect(current?.version).toMatchObject({ id: newest, versionLabel: "CV v2" });
      expect(current?.documents).toMatchObject([{ kind: "cv", start: 0, end: 17 }]);
      expect(current?.claims).toEqual([{ start: 0, end: 8 }]);
      expect(await currentCvVersion(db, userId, "ja")).toBeNull();
    }));

  it("never returns another user's version", () =>
    inRolledBackTransaction(async (db) => {
      const other = await insertUser(db);
      await insertVersion(db, other, "CV v1", "2026-09-01T00:00:00Z");
      expect(await currentCvVersion(db, await insertUser(db), "en")).toBeNull();
    }));
});
