import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { Pool } from "pg";
import { expect, it } from "vitest";
import * as s from "../../db/schema";
import { TEST_URL } from "../../db/test/database";
import { pgErrorClass } from "./http";
import { lockRoundUser } from "./state";

it("serializes writes for one user across database transactions", async () => {
  const pool = new Pool({ connectionString: TEST_URL, max: 2 });
  const userId = randomUUID();
  const db = drizzle(pool);
  await db.insert(s.users).values({ id: userId, name: "round-lock-test", email: `${userId}@example.test` });
  const first = await pool.connect();
  const second = await pool.connect();
  try {
    await first.query("begin");
    await lockRoundUser(drizzle(first), userId);
    await second.query("begin");
    await second.query("set local lock_timeout = '100ms'");
    let error: unknown;
    try {
      await lockRoundUser(drizzle(second), userId);
    } catch (caught) {
      error = caught;
    }
    expect(pgErrorClass(error)).toBe("pg_55P03");
    await second.query("rollback");
    await first.query("commit");
    await second.query("begin");
    await lockRoundUser(drizzle(second), userId);
  } finally {
    await Promise.all([first.query("rollback"), second.query("rollback")]);
    first.release();
    second.release();
    await db.delete(s.users).where(eq(s.users.id, userId));
    await pool.end();
  }
});
