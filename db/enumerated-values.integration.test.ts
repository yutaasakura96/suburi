import { sql } from "drizzle-orm";
import { afterAll, describe, it } from "vitest";
import * as s from "./schema";
import { closePool, expectRefused, inRolledBackTransaction, type TestDb } from "./test/database";
import { insertAnswer, insertAttempt, insertRound, insertWorld } from "./test/fixtures";

// docs/11-testing-plan.md §3.1 "Enumerated values", over docs/04-database-schema.md §0's list.

afterAll(closePool);

const ENUMERATED = [
  ["cv_versions", "language"],
  ["role_contexts", "kind"],
  ["rubric_versions", "language"],
  ["questions", "language"],
  ["questions", "round_type"],
  ["questions", "origin"],
  ["rounds", "round_type"],
  ["rounds", "language"],
  ["rounds", "mode"],
  ["answers", "language"],
  ["scoring_attempts", "status"],
  ["round_feedback", "language"],
  ["claim_citations", "relation"],
  ["cv_documents", "kind"],
] as const;

// One valid row in every table that has an enumerated column.
async function insertOneOfEach(db: TestDb) {
  const world = await insertWorld(db);
  const round = await insertRound(db, world);
  const answer = await insertAnswer(db, world, round);
  await insertAttempt(db, world, answer);
  await db.insert(s.roundFeedback).values({
    roundId: round,
    toFix: [],
    whatWorked: "fixture",
    language: "ja",
    modelId: "fixture-model-2026-01-01",
    promptVersion: "feedback-fixture",
  });
  await db.insert(s.cvDocuments).values({
    cvVersionId: world.cvVersionId,
    userId: world.userId,
    kind: "rirekisho",
    position: 0,
    start: 0,
    end: 18,
  });
  const [claim] = await db
    .insert(s.cvClaims)
    .values({
      cvVersionId: world.cvVersionId,
      userId: world.userId,
      textNormalised: "請求処理を40%短縮",
      spanStart: 8,
      spanEnd: 17,
    })
    .returning({ id: s.cvClaims.id });
  await db
    .insert(s.claimCitations)
    .values({ answerId: answer, cvClaimId: claim.id, relation: "supported_by" });
}

describe("an enumerated column refuses a value outside its list", () => {
  it.each(ENUMERATED)("%s.%s", (table, column) =>
    inRolledBackTransaction(async (db) => {
      await insertOneOfEach(db);

      await expectRefused(
        db,
        () =>
          db.execute(
            sql`update ${sql.identifier(table)} set ${sql.identifier(column)} = 'not-a-listed-value'`,
          ),
        { kind: "check", constraint: `${table}_${column}_check` },
      );
    }),
  );
});
