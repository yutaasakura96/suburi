import { readFileSync } from "node:fs";
import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import * as s from "./schema";

// `db/schema.ts` is docs/04-database-schema.md in code, and they change together (AGENTS.md). For the
// tables whose column table lists one column a row, the two are read side by side.

const DOC = readFileSync(new URL("../docs/04-database-schema.md", import.meta.url), "utf8");

/** `{ column: nullable }`, from the table under 04's `### \`<table>\`` heading. */
function documented(table: string) {
  const section = DOC.split(`### \`${table}\``)[1]?.split(/\n#{2,3} /u)[0] ?? "";
  return Object.fromEntries([...section.matchAll(/^\| `([a-z_0-9]+)` \| [^|]+ \| (yes|no) \|/gmu)].map(([, column, nullable]) => [column, nullable === "yes"]));
}

function coded(table: Parameters<typeof getTableColumns>[0]) {
  return Object.fromEntries(Object.values(getTableColumns(table)).map((column) => [column.name, !column.notNull]));
}

describe("04 and db/schema.ts agree", () => {
  it("on role_contexts: every column, and which are nullable", () => {
    expect(documented("role_contexts")).toEqual(coded(s.roleContexts));
    expect(documented("role_contexts")).toHaveProperty("research_draft", true);
  });
});
