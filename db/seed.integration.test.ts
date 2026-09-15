import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import * as s from "./schema";
import { seedUser } from "./seed";
import { closePool, inRolledBackTransaction } from "./test/database";

afterAll(closePool);

describe("the user seed", () => {
  it("is idempotent and leaves one verified row", () =>
    inRolledBackTransaction(async (db) => {
      const email = "seed-fixture@example.test";

      expect(await seedUser(db, email)).toBe(true);
      expect(await seedUser(db, email)).toBe(false);

      const rows = await db
        .select({ name: s.users.name, emailVerified: s.users.emailVerified })
        .from(s.users)
        .where(eq(s.users.email, email));
      expect(rows).toEqual([{ name: "seed-fixture", emailVerified: true }]);
    }));
});
