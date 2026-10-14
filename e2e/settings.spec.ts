import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { expect, test, type Page } from "@playwright/test";
import * as s from "../db/schema";
import { createAuth } from "../lib/auth/auth";
import { mintSessionCookie } from "../lib/auth/test/session";
import { getConfig } from "../lib/config";
import { E2E_URL } from "./database";

// 11 §4, the Settings row, for the name (#122): the header's name leads to /settings and is current
// there, a saved name changes the header at once, and the save button waits for a change and refuses a
// blank name. English help's part of the row — saved on, the next practice round's starting state —
// is in e2e/practice.english-help.spec.ts (#123).

test.describe.configure({ mode: "serial" });

const open = () => drizzle(E2E_URL);

async function withDb<T>(work: (db: ReturnType<typeof open>) => Promise<T>) {
  const db = open();
  try {
    return await work(db);
  } finally {
    await db.$client.end();
  }
}

const byEmail = eq(s.users.email, getConfig().ALLOWED_EMAIL);

async function storedName() {
  return withDb(async (db) => (await db.select({ name: s.users.name }).from(s.users).where(byEmail))[0].name);
}

async function signIn(page: Page) {
  await withDb(async (db) => {
    const [user] = await db.select({ id: s.users.id }).from(s.users).where(byEmail);
    const cookie = await mintSessionCookie(createAuth({ db, transaction: true }), user.id);
    await page.context().addCookies([
      { name: cookie.name, value: cookie.value, domain: "localhost", path: "/", httpOnly: true, secure: true, sameSite: "Lax" },
    ]);
  });
}

let seededName: string;

test.beforeAll(async () => {
  seededName = await storedName();
});

// The other specs read the seeded name nowhere, but leave the row as the seed wrote it.
test.afterAll(async () => {
  await withDb((db) => db.update(s.users).set({ name: seededName }).where(byEmail));
});

test("the header's name leads to /settings, which marks it current and is not a nav item", async ({ page }) => {
  await signIn(page);
  await page.goto("/");
  const header = page.locator("header");
  const name = header.getByRole("link", { name: seededName });
  await expect(name).not.toHaveAttribute("aria-current");
  await expect(header.getByRole("navigation", { name: "Main" }).getByRole("link")).toHaveCount(4);

  await name.click();
  await expect(page).toHaveURL("/settings");
  await expect(header.getByRole("link", { name: seededName })).toHaveAttribute("aria-current", "page");
  await expect(header.getByRole("navigation", { name: "Main" }).locator("[aria-current]")).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Settings");
  await expect(page.getByRole("textbox", { name: "Name" })).toHaveValue(seededName);
  await expect(page.getByText(getConfig().ALLOWED_EMAIL)).toBeVisible();
});

test("the save button waits for a change and refuses a blank name; a save changes the header at once", async ({ page }) => {
  await signIn(page);
  await page.goto("/settings");
  const input = page.getByRole("textbox", { name: "Name" });
  const save = page.getByRole("button", { name: "Save settings" });

  await expect(save).toBeDisabled();
  await expect(page.getByText("Nothing has changed since the last save.")).toBeVisible();

  await input.fill("   ");
  await expect(save).toBeDisabled();
  await expect(page.getByText("The name cannot be blank.")).toBeVisible();

  await input.fill("a".repeat(81));
  await expect(save).toBeDisabled();
  await expect(page.getByText("The name is over 80 characters.")).toBeVisible();

  await input.fill("  Jordan Example  ");
  await expect(save).toBeEnabled();
  let releaseSave!: () => void;
  const saveHeld = new Promise<void>((resolve) => { releaseSave = resolve; });
  let requestSeen!: () => void;
  const requestStarted = new Promise<void>((resolve) => { requestSeen = resolve; });
  await page.route("**/api/settings", async (route) => {
    requestSeen();
    await saveHeld;
    await route.continue();
  });
  await save.click();
  await requestStarted;
  await expect(input).toBeDisabled();
  await expect(save).toBeDisabled();
  releaseSave();

  await expect(page.getByText("Saved.")).toBeVisible();
  await expect(page.locator("header").getByRole("link", { name: "Jordan Example" })).toHaveAttribute("aria-current", "page");
  await expect(input).toHaveValue("Jordan Example");
  await expect(save).toBeDisabled();
  expect(await storedName()).toBe("Jordan Example");

  await page.goto("/history");
  await expect(page.locator("header").getByRole("link", { name: "Jordan Example" })).toHaveAttribute("href", "/settings");
});

test("the page has no delete, export or share control, and no career or personal field", async ({ page }) => {
  await signIn(page);
  await page.goto("/settings");
  const form = page.locator("form");
  await expect(form.getByRole("textbox")).toHaveCount(1);
  await expect(form.getByRole("checkbox")).toHaveCount(1);
  await expect(form.getByRole("button")).toHaveCount(1);
  await expect(page.getByRole("main")).not.toContainText(/delete|export|share|download/i);
});

test("the running API rejects unauthorized and invalid writes without changing the saved name", async ({ page, request }) => {
  const original = await storedName();
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/sign-in/);
  const unauthorized = await request.put("/api/settings", { data: { display_name: "Stranger", english_help: false } });
  expect(unauthorized.status()).toBe(401);
  expect((await unauthorized.json()).error.code).toBe("unauthenticated");

  await signIn(page);
  await page.goto("/settings");
  for (const displayName of ["   ", "a".repeat(81)]) {
    const response = await page.request.put("/api/settings", { data: { display_name: displayName, english_help: false } });
    expect(response.status()).toBe(400);
    expect((await response.json()).error.detail.fields).toContain("display_name");
  }
  const extraField = await page.request.put("/api/settings", {
    data: { display_name: "Stranger", english_help: false, email: "changed@example.test" },
  });
  expect(extraField.status()).toBe(400);
  expect((await extraField.json()).error.detail.fields).toContain("email");
  expect(await storedName()).toBe(original);

  const maxName = "𠮷".repeat(80);
  const accepted = await page.request.put("/api/settings", { data: { display_name: `  ${maxName}  `, english_help: false } });
  expect(accepted.status()).toBe(200);
  expect((await accepted.json()).settings.display_name).toBe(maxName);
  expect(await storedName()).toBe(maxName);
});

test("a database refusal leaves the typed name intact and shows the save failure", async ({ page }) => {
  await signIn(page);
  await page.goto("/settings");
  const original = await storedName();
  await withDb((db) => db.execute(sql`alter table users add constraint settings_refusal_check check (name <> 'Refused')`));
  try {
    await page.getByRole("textbox", { name: "Name" }).fill("Refused");
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(page.getByText("The save failed, and nothing was written. Try the same step again.")).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Name" })).toHaveValue("Refused");
    expect(await storedName()).toBe(original);
  } finally {
    await withDb((db) => db.execute(sql`alter table users drop constraint settings_refusal_check`));
  }
});
