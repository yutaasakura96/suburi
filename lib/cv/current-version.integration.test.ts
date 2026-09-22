import { afterAll, describe, expect, it } from "vitest";
import * as s from "../../db/schema";
import { closePool, inRolledBackTransaction, type TestDb } from "../../db/test/database";
import { insertUser } from "../../db/test/fixtures";
import { currentCvVersion, cvVersionById, cvVersionHistory } from "./current-version";

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
      expect(current?.claims).toMatchObject([{ textNormalised: "Invented", start: 0, end: 8 }]);
      expect(await currentCvVersion(db, userId, "ja")).toBeNull();
    }));

  it("never returns another user's version", () =>
    inRolledBackTransaction(async (db) => {
      const other = await insertUser(db);
      await insertVersion(db, other, "CV v1", "2026-09-01T00:00:00Z");
      expect(await currentCvVersion(db, await insertUser(db), "en")).toBeNull();
    }));
});

describe("cvVersionById", () => {
  it("reads any of the user's versions, current or not", () =>
    inRolledBackTransaction(async (db) => {
      const userId = await insertUser(db);
      const older = await insertVersion(db, userId, "CV v1", "2026-08-01T00:00:00Z");
      await insertVersion(db, userId, "CV v2", "2026-09-01T00:00:00Z");
      const read = await cvVersionById(db, userId, older);
      expect(read?.version.versionLabel).toBe("CV v1");
      expect(read?.documents).toHaveLength(1);
    }));

  it("is null for another user's version and for an id that is not a uuid", () =>
    inRolledBackTransaction(async (db) => {
      const other = await insertUser(db);
      const theirs = await insertVersion(db, other, "CV v1", "2026-09-01T00:00:00Z");
      const userId = await insertUser(db);
      expect(await cvVersionById(db, userId, theirs)).toBeNull();
      expect(await cvVersionById(db, userId, "not-a-uuid")).toBeNull();
    }));
});

describe("cvVersionHistory", () => {
  it("lists every version but the current one, newest first, with claim counts", () =>
    inRolledBackTransaction(async (db) => {
      const userId = await insertUser(db);
      await insertVersion(db, userId, "CV v1", "2026-07-01T00:00:00Z");
      const v2 = await insertVersion(db, userId, "CV v2", "2026-08-01T00:00:00Z");
      await db.insert(s.cvClaims).values({ cvVersionId: v2, userId, textNormalised: "CV", spanStart: 9, spanEnd: 11 });
      await insertVersion(db, userId, "CV v3", "2026-09-01T00:00:00Z");
      await insertVersion(db, await insertUser(db), "CV v9", "2026-09-02T00:00:00Z");

      const history = await cvVersionHistory(db, userId, "en");
      expect(history.map(({ versionLabel, claimCount }) => ({ versionLabel, claimCount }))).toEqual([
        { versionLabel: "CV v2", claimCount: 2 },
        { versionLabel: "CV v1", claimCount: 1 },
      ]);
      expect(await cvVersionHistory(db, userId, "ja")).toEqual([]);
    }));
});
