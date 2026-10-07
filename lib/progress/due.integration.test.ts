import { afterAll, describe, expect, it } from "vitest";
import * as s from "../../db/schema";
import { closePool, inRolledBackTransaction } from "../../db/test/database";
import { insertUser, insertWorld, roundValues } from "../../db/test/fixtures";
import { dueList, lastPractised } from "./due";

// What the Due list is computed from (US-14, 10 §1), against the migrated test database.

afterAll(closePool);

const at = (day: string) => new Date(`${day}T01:00:00.000Z`);
const done = (day: string) => ({ startedAt: at(day), completedAt: new Date(at(day).getTime() + 1_800_000) });

describe("when each pair was last practised", () => {
  it("is the newest completed realistic round of the pair, and nothing for a pair with none", () =>
    inRolledBackTransaction(async (db) => {
      const world = await insertWorld(db);
      await db.insert(s.rounds).values([
        roundValues(world, { roundType: "behavioural", language: "ja", ...done("2026-09-01") }),
        roundValues(world, { roundType: "behavioural", language: "ja", ...done("2026-09-10") }),
        roundValues(world, { roundType: "hr", language: "en", ...done("2026-09-20") }),
      ]);

      const last = await lastPractised(db, world.userId);
      expect([...last].sort((a, b) => a.roundType.localeCompare(b.roundType))).toEqual([
        { roundType: "behavioural", language: "ja", startedAt: at("2026-09-10") },
        { roundType: "hr", language: "en", startedAt: at("2026-09-20") },
      ]);
    }));

  it("ignores a practice round and a round that was never completed", () =>
    inRolledBackTransaction(async (db) => {
      const world = await insertWorld(db);
      await db.insert(s.rounds).values([
        roundValues(world, { roundType: "technical", language: "ja", ...done("2026-09-01") }),
        // US-14: the interval is since the last realistic round, so practising does not reset it.
        roundValues(world, { roundType: "technical", language: "ja", mode: "practice", perAnswerCapSeconds: 900, ...done("2026-09-20") }),
        // PRD §7: an abandoned round is not a sitting.
        roundValues(world, { roundType: "technical", language: "ja", startedAt: at("2026-09-25"), completedAt: null }),
        roundValues(world, { roundType: "ceo", language: "en", startedAt: at("2026-09-26"), completedAt: null }),
      ]);

      expect(await lastPractised(db, world.userId)).toEqual([{ roundType: "technical", language: "ja", startedAt: at("2026-09-01") }]);
    }));

  it("reads one user's rounds only", () =>
    inRolledBackTransaction(async (db) => {
      const world = await insertWorld(db);
      await db.insert(s.rounds).values(roundValues(world, { roundType: "hr", language: "ja", ...done("2026-09-01") }));
      const other = await insertUser(db);

      expect(await lastPractised(db, other)).toEqual([]);
      expect(dueList(await lastPractised(db, other), at("2026-10-01")).every((row) => row.days === null)).toBe(true);
    }));
});
