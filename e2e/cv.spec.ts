import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { expect, test, type Page } from "@playwright/test";
import * as s from "../db/schema";
import { createAuth } from "../lib/auth/auth";
import { mintSessionCookie } from "../lib/auth/test/session";
import { getConfig } from "../lib/config";
import { E2E_URL } from "./database";
import { startMockOpenAi } from "./mock-openai";

// The CV screen (10 §13), against the production build. No test calls OpenAI (11 §2): the server's
// model call goes to e2e/mock-openai.ts, which answers with CLAIMS.

const CV = [
  "Jordan Example",
  "Led a team of 5 at Invented Logistics.",
  "Cut invoicing time by 40%.",
  "BSc Computer Science, Invented University, 2016.",
].join("\n");

const CLAIMS = [
  { document: 0, quote: "Led a team of 5 at Invented Logistics.", start_hint: 15 },
  { document: 0, quote: "Cut invoicing time by 40%.", start_hint: 54 },
  // Not in the text: dropped and counted, never shown.
  { document: 0, quote: "Cut invoicing time by 50%.", start_hint: 54 },
];

// A real session for the seeded user, in the browser the way sign-in would leave it.
async function signIn(page: Page) {
  const db = drizzle(E2E_URL);
  try {
    const [user] = await db
      .select({ id: s.users.id })
      .from(s.users)
      .where(eq(s.users.email, getConfig().ALLOWED_EMAIL));
    const cookie = await mintSessionCookie(createAuth({ db, transaction: true }), user.id);
    await page.context().addCookies([
      {
        name: cookie.name,
        value: cookie.value,
        domain: "localhost",
        path: "/",
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
      },
    ]);
  } finally {
    await db.$client.end();
  }
}

test("/cv without a session lands on /sign-in", async ({ page }) => {
  await page.goto("/cv");
  await expect(page).toHaveURL("/sign-in");
});

test("empty panel → paste → save shows CV v1, its underlined claims and the counts", async ({
  page,
}) => {
  await signIn(page);
  const openAi = await startMockOpenAi({ claims: CLAIMS });
  try {
    await page.goto("/cv");
    const panel = page.getByRole("region", { name: "CV" });
    await expect(
      panel.getByText("One CV document is required. You can add up to five supporting documents."),
    ).toBeVisible();

    await panel.getByRole("button", { name: "Add your CV" }).click();
    await panel.getByRole("textbox").fill(CV);
    await panel.getByRole("button", { name: "Save this version" }).click();

    await expect(panel.getByTestId("cv-version-label")).toHaveText("CV v1");
    await expect(panel.getByTestId("cv-claim-count")).toHaveText("2 claims");
    await expect(
      panel.getByText("2 claims extracted — 0 carried forward, 2 new. 1 dropped."),
    ).toBeVisible();
    await expect(
      panel.getByText("1 claim was dropped — their quotes did not match your text."),
    ).toBeVisible();
    await expect(panel.locator("[data-claim]")).toHaveText([
      "Led a team of 5 at Invented Logistics.",
      "Cut invoicing time by 40%.",
    ]);
    await expect(panel.getByText("BSc Computer Science", { exact: false })).toBeVisible();

    // The real extractor's request: the pinned model, the key, the document.
    expect(openAi.requests).toHaveLength(1);
    expect(openAi.requests[0].authorization).toBe("Bearer e2e-not-a-real-key");
    expect(openAi.requests[0].body.model).toBe("gpt-5.6-sol");
    expect(String(openAi.requests[0].body.input)).toContain("Cut invoicing time by 40%.");

    // A reload reads the saved version back from Postgres, not from the form's state.
    await page.reload();
    await expect(panel.locator("[data-claim]")).toHaveCount(2);
  } finally {
    await openAi.close();
  }
});
