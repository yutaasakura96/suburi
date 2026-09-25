import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import nextEnv from "@next/env";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { users } from "../db/schema.ts";
import { seedUser } from "../db/seed.ts";
import { createAuth } from "../lib/auth/auth.ts";
import { mintSessionCookie } from "../lib/auth/test/session.ts";
import { getConfig } from "../lib/config.ts";
import { devSessionRefusals } from "./dev-session-guard.ts";

// Hand-run: `npm run dev:session`. A signed-in browser session for the locally running app, so an
// agent can check a signed-in screen by hand (06, 2026-09-25). Nothing in the app imports this: the
// session is minted by the same lib/auth/test/session.ts the end-to-end tests use, for the seeded
// ALLOWED_EMAIL user, and the session hook still refuses anyone else.

const { values } = parseArgs({
  options: { out: { type: "string", default: ".playwright/dev-session.json" } },
});

// The env files `next dev` loads, in its order, so the cookie is signed with the secret the dev
// server verifies it with. The real environment wins over every file, as it does for `next dev`.
nextEnv.loadEnvConfig(process.cwd(), true, {
  info: () => {},
  error: console.error,
});

const refusals = devSessionRefusals(process.env);
if (refusals.length > 0) {
  console.error("dev:session refused. It only runs against a local database with local secrets:");
  for (const reason of refusals) console.error(`  - ${reason}`);
  process.exit(1);
}

const config = getConfig();
const appUrl = new URL(config.BETTER_AUTH_URL);
const db = drizzle(config.DATABASE_URL_UNPOOLED);

// Creates the local user row if it is missing, reuses it if not. Logs no email, like db:seed.
async function mint() {
  try {
    await seedUser(db, config.ALLOWED_EMAIL);
    const [user] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, config.ALLOWED_EMAIL));
    return await mintSessionCookie(createAuth({ db, transaction: true }), user.id);
  } finally {
    await db.$client.end();
  }
}

let cookie: Awaited<ReturnType<typeof mintSessionCookie>>;
try {
  cookie = await mint();
} catch (error) {
  const { code, cause } = error as { code?: string; cause?: { code?: string } };
  const pgCode = code ?? cause?.code;
  // 42P01, undefined table: the database is up but has never been migrated.
  if (pgCode === "42P01") {
    console.error("dev:session: the local database has no tables. Run `npm run db:migrate`.");
  } else {
    console.error(`dev:session failed: ${(error as Error).name}${pgCode ? ` (${pgCode})` : ""}`);
  }
  process.exit(1);
}

// Playwright's storageState shape. httpOnly, secure and Lax, as lib/auth/auth.ts sets it.
const browserCookie = {
  name: cookie.name,
  value: cookie.value,
  domain: appUrl.hostname,
  path: "/",
  expires: Math.floor(cookie.expires.getTime() / 1000),
  httpOnly: true,
  secure: true,
  sameSite: "Lax" as const,
};
const out = resolve(values.out);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify({ cookies: [browserCookie], origins: [] }, null, 2)}\n`);

const origin = appUrl.origin;
const maxAge = browserCookie.expires - Math.floor(Date.now() / 1000);
console.log(`Signed-in session for ${origin}, valid until ${cookie.expires.toISOString()}.

cookie   ${browserCookie.name}=${browserCookie.value}
         domain=${browserCookie.domain} path=/ httpOnly secure sameSite=Lax (any port on this host)
state    ${out}  (Playwright storageState)

Playwright MCP, browser_run_code_unsafe:
  async (page) => { await page.context().addCookies(${JSON.stringify([browserCookie])}); await page.goto(${JSON.stringify(`${origin}/`)}); }

chrome-devtools-axi:
  chrome-devtools-axi open ${origin}/sign-in
  chrome-devtools-axi eval '${`document.cookie = ${JSON.stringify(`${browserCookie.name}=${browserCookie.value}; path=/; max-age=${maxAge}; secure; samesite=lax`)}`}'
  chrome-devtools-axi open ${origin}/`);
