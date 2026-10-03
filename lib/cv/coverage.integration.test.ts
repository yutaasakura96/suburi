import { afterAll, describe, expect, it } from "vitest";
import * as s from "../../db/schema";
import { closePool, inRolledBackTransaction, type TestDb } from "../../db/test/database";
import { insertAnswer, insertRound, insertWorld, type World } from "../../db/test/fixtures";
import { citedClaimIds } from "./coverage";

// Coverage (CONTEXT.md, 04 `cv_claims`, 11 §3.8): inherited down the carry-forward chain, and nowhere
// else. Synthetic rows only.

afterAll(closePool);

async function version(db: TestDb, world: World, label: string) {
  const [row] = await db
    .insert(s.cvVersions)
    .values({ userId: world.userId, versionLabel: label, language: "en", body: "Led a team. Cut costs. Shipped it." })
    .returning({ id: s.cvVersions.id });
  return row.id;
}

async function claim(db: TestDb, world: World, cvVersionId: string, text: string, supersedes: string | null = null) {
  const [row] = await db
    .insert(s.cvClaims)
    .values({ cvVersionId, userId: world.userId, textNormalised: text, spanStart: 0, spanEnd: 4, supersedesClaimId: supersedes })
    .returning({ id: s.cvClaims.id });
  return row.id;
}

async function cite(db: TestDb, world: World, cvClaimId: string, relation: "supported_by" | "contradicted_by" = "supported_by") {
  const answer = await insertAnswer(db, world, await insertRound(db, world));
  await db.insert(s.claimCitations).values({ answerId: answer, cvClaimId, relation });
}

describe("which claims of a CV version have been cited", () => {
  it("is none before any answer cites one", () =>
    inRolledBackTransaction(async (db) => {
      const world = await insertWorld(db);
      const v1 = await version(db, world, "CV v1");
      await claim(db, world, v1, "Led a team.");
      expect(await citedClaimIds(db, v1)).toEqual(new Set());
    }));

  it("follows a chain of three versions: a citation of the first reads as used in the third", () =>
    inRolledBackTransaction(async (db) => {
      const world = await insertWorld(db);
      const [v1, v2, v3] = [await version(db, world, "CV v1"), await version(db, world, "CV v2"), await version(db, world, "CV v3")];
      const led1 = await claim(db, world, v1, "Led a team.");
      const led2 = await claim(db, world, v2, "Led a team.", led1);
      const led3 = await claim(db, world, v3, "Led a team.", led2);
      const cut3 = await claim(db, world, v3, "Cut costs.");
      await cite(db, world, led1);

      expect(await citedClaimIds(db, v1)).toEqual(new Set([led1]));
      expect(await citedClaimIds(db, v2)).toEqual(new Set([led2]));
      expect(await citedClaimIds(db, v3)).toEqual(new Set([led3]));
      expect((await citedClaimIds(db, v3)).has(cut3)).toBe(false);
    }));

  it("does not flow backwards: a citation of a later version leaves the earlier claim unused", () =>
    inRolledBackTransaction(async (db) => {
      const world = await insertWorld(db);
      const [v1, v2] = [await version(db, world, "CV v1"), await version(db, world, "CV v2")];
      const led1 = await claim(db, world, v1, "Led a team.");
      const led2 = await claim(db, world, v2, "Led a team.", led1);
      await cite(db, world, led2);

      expect(await citedClaimIds(db, v1)).toEqual(new Set());
      expect(await citedClaimIds(db, v2)).toEqual(new Set([led2]));
    }));

  it("reads a forked lineage the same either way: two claims carried from one both inherit its citation", () =>
    inRolledBackTransaction(async (db) => {
      const world = await insertWorld(db);
      const [v1, v2] = [await version(db, world, "CV v1"), await version(db, world, "CV v2")];
      const shipped1 = await claim(db, world, v1, "Shipped it.");
      const inCv = await claim(db, world, v2, "Shipped it.", shipped1);
      const inPortfolio = await claim(db, world, v2, "Shipped it.", shipped1);
      await cite(db, world, shipped1);

      expect(await citedClaimIds(db, v2)).toEqual(new Set([inCv, inPortfolio]));
    }));

  it("counts a contradicted claim as cited, and a reworded claim as new", () =>
    inRolledBackTransaction(async (db) => {
      const world = await insertWorld(db);
      const [v1, v2] = [await version(db, world, "CV v1"), await version(db, world, "CV v2")];
      const cut1 = await claim(db, world, v1, "Cut costs.");
      // One character different: no carry-forward, so no inherited coverage (04).
      const reworded = await claim(db, world, v2, "Cut costs!");
      await cite(db, world, cut1, "contradicted_by");

      expect(await citedClaimIds(db, v1)).toEqual(new Set([cut1]));
      expect((await citedClaimIds(db, v2)).has(reworded)).toBe(false);
    }));
});
