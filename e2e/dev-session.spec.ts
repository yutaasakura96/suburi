import { execFileSync } from "node:child_process";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { expect, test } from "@playwright/test";
import * as s from "../db/schema";
import { getConfig } from "../lib/config";
import { E2E_URL } from "./database";

// `npm run dev:session` (06, 2026-09-25), run as an agent runs it, against this run's database: the
// storageState it writes must be a session the app accepts.

function devSession(out: string) {
  execFileSync(
    "node",
    [
      "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
      "--import",
      "./scripts/resolve-ts.mts",
      "scripts/dev-session.mts",
      "--out",
      out,
    ],
    // The database the server under test is booted against.
    {
      env: {
        ...process.env,
        DATABASE_URL: E2E_URL,
        DATABASE_URL_UNPOOLED: E2E_URL,
      },
      stdio: "pipe",
    },
  );
}

test("dev:session's storageState opens a signed-in page, reusing the one user", async ({
  browser,
}, testInfo) => {
  const first = testInfo.outputPath("first.json");
  const second = testInfo.outputPath("second.json");
  devSession(first);
  devSession(second);

  for (const storageState of [first, second]) {
    const context = await browser.newContext({ storageState });
    try {
      const page = await context.newPage();
      await page.goto("/cv");
      await expect(page).toHaveURL("/cv");
      await expect(page.getByRole("region", { name: "CV" })).toBeVisible();
    } finally {
      await context.close();
    }
  }

  const db = drizzle(E2E_URL);
  try {
    const rows = await db
      .select({ id: s.users.id })
      .from(s.users)
      .where(eq(s.users.email, getConfig().ALLOWED_EMAIL));
    expect(rows).toHaveLength(1);
  } finally {
    await db.$client.end();
  }
});
