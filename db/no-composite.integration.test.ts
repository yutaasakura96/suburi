import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { closePool, inRolledBackTransaction } from "./test/database";

// docs/11-testing-plan.md §3.2 check 1. Invariant 1 is an absence, so it is tested as one. If a
// future session wants "just a quick overall", this fails on purpose.

afterAll(closePool);

describe("no composite score in the schema", () => {
  it("no column is named like a composite", () =>
    inRolledBackTransaction(async (db) => {
      const { rows } = await db.execute<{ column: string }>(sql`
        select table_name || '.' || column_name as column
        from information_schema.columns
        where table_schema = 'public'
          and column_name ~* '(total|average|avg|overall|composite|sum|score_sum)'`);
      expect(rows).toEqual([]);
    }));

  it("there are no views", () =>
    inRolledBackTransaction(async (db) => {
      const { rows } = await db.execute<{ table_name: string }>(sql`
        select table_name from information_schema.views where table_schema = 'public'`);
      expect(rows).toEqual([]);
    }));

  it("there are no materialised views", () =>
    inRolledBackTransaction(async (db) => {
      const { rows } = await db.execute<{ matviewname: string }>(sql`
        select matviewname from pg_matviews where schemaname = 'public'`);
      expect(rows).toEqual([]);
    }));
});
