import { and, eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import * as s from "../../db/schema";
import { closePool, inRolledBackTransaction, type TestDb } from "../../db/test/database";
import { insertUser } from "../../db/test/fixtures";
import { RATE_LIMITS, takeRateLimit } from "./rate-limit";

// 07 §1 rule 5, against the migrated test database: the window is Postgres's, so it holds across
// serverless instances only if it holds here.

afterAll(closePool);

const { limit, windowSeconds } = RATE_LIMITS["cv-versions"];

async function burst(db: TestDb, userId: string, sessionId: string, n: number) {
  const waits: (number | null)[] = [];
  for (let i = 0; i < n; i++) {
    waits.push(await takeRateLimit(db, { userId, sessionId, route: "cv-versions" }));
  }
  return waits;
}

describe("takeRateLimit", () => {
  it("is 6 per 10 minutes on cv-versions (06, #18)", () => {
    expect(RATE_LIMITS["cv-versions"]).toEqual({ limit: 6, windowSeconds: 600 });
  });

  it("allows the limit, then refuses with the rest of the window as the wait", () =>
    inRolledBackTransaction(async (db) => {
      const userId = await insertUser(db);
      const waits = await burst(db, userId, "session-a", limit + 2);

      expect(waits.slice(0, limit)).toEqual(Array(limit).fill(null));
      for (const wait of waits.slice(limit)) {
        expect(wait).toBeGreaterThan(windowSeconds - 5);
        expect(wait).toBeLessThanOrEqual(windowSeconds);
      }
    }));

  it("leaves a different session's bucket untouched", () =>
    inRolledBackTransaction(async (db) => {
      const userId = await insertUser(db);
      await burst(db, userId, "session-a", limit + 1);

      expect(await burst(db, userId, "session-b", limit)).toEqual(Array(limit).fill(null));
    }));

  it("reports the remainder of the window, not the whole window", () =>
    inRolledBackTransaction(async (db) => {
      const userId = await insertUser(db);
      await burst(db, userId, "session-a", limit);
      await db.execute(
        sql`update rate_limit_windows set window_started_at = now() - interval '590 seconds'`,
      );

      const wait = await takeRateLimit(db, { userId, sessionId: "session-a", route: "cv-versions" });
      expect(wait).toBeGreaterThan(5);
      expect(wait).toBeLessThanOrEqual(10);
    }));

  it("starts a fresh window, counting from one, once the old one has lapsed", () =>
    inRolledBackTransaction(async (db) => {
      const userId = await insertUser(db);
      await burst(db, userId, "session-a", limit + 3);
      await db.execute(
        sql`update rate_limit_windows set window_started_at = now() - make_interval(secs => ${windowSeconds})`,
      );

      expect(await burst(db, userId, "session-a", limit)).toEqual(Array(limit).fill(null));
      const [row] = await db
        .select({ count: s.rateLimitWindows.count })
        .from(s.rateLimitWindows)
        .where(
          and(
            eq(s.rateLimitWindows.sessionId, "session-a"),
            eq(s.rateLimitWindows.route, "cv-versions"),
          ),
        );
      expect(row.count).toBe(limit);
    }));

  it("keeps one row per session and route, updated in place", () =>
    inRolledBackTransaction(async (db) => {
      const userId = await insertUser(db);
      await burst(db, userId, "session-a", limit + 2);
      await burst(db, userId, "session-b", 1);

      const rows = await db
        .select({ sessionId: s.rateLimitWindows.sessionId, count: s.rateLimitWindows.count })
        .from(s.rateLimitWindows)
        .where(eq(s.rateLimitWindows.userId, userId))
        .orderBy(s.rateLimitWindows.sessionId);
      expect(rows).toEqual([
        { sessionId: "session-a", count: limit + 2 },
        { sessionId: "session-b", count: 1 },
      ]);
    }));
});
