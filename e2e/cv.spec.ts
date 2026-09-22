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

// #15: a Japanese set of all three kinds, in a panel whose chrome is Japanese beside one whose chrome
// stays English.

const RIREKISHO = ["氏名 山田 花子", "2016年3月 架空大学 情報学部 卒業", "基本情報技術者試験 合格"].join("\n");
const SHOKUMU = "経理システムの刷新を主導し、請求処理を40%短縮。チーム5名を統括。";
const PORTFOLIO = "Built an interview simulator in Next.js.";

const JA_CLAIMS = [
  { document: 0, quote: "2016年3月 架空大学 情報学部 卒業", start_hint: 9 },
  { document: 1, quote: "請求処理を40%短縮。", start_hint: 14 },
  { document: 2, quote: PORTFOLIO, start_hint: 0 },
];

test("each panel's chrome is in its own language", async ({ page }) => {
  await signIn(page);
  await page.goto("/cv");
  const ja = page.getByRole("region", { name: "応募書類" });
  const en = page.getByRole("region", { name: "CV", exact: true });

  await expect(ja).toHaveAttribute("lang", "ja");
  await expect(en).toHaveAttribute("lang", "en");
  await ja.getByRole("button", { name: "応募書類を追加する" }).click();
  await expect(ja.getByRole("button", { name: "このバージョンを保存する" })).toBeVisible();
  await expect(ja.getByRole("button", { name: "職務経歴書を追加" })).toBeVisible();
  await expect(ja.getByRole("button", { name: "補足資料を追加" })).toBeVisible();
  await expect(
    ja.getByText("生年月日・住所・電話番号・顔写真・家族の情報は省いてかまいません。評価には使いません。"),
  ).toBeVisible();
  // No English chrome in the Japanese panel. `CV` is excluded: it is the English panel's name, not
  // a string the Japanese panel may show, so its absence is covered by the same check.
  await expect(ja).not.toContainText(/[A-Za-z]/);

  const english = await en.innerText();
  expect(english).not.toMatch(/[぀-ヿ一-鿿]/);
});

test("a 応募書類 with a 履歴書, a 職務経歴書 and an additional document saves as 応募書類 v1", async ({
  page,
}) => {
  await signIn(page);
  const openAi = await startMockOpenAi({ claims: JA_CLAIMS });
  try {
    await page.goto("/cv");
    const ja = page.getByRole("region", { name: "応募書類" });

    await ja.getByRole("button", { name: "応募書類を追加する" }).click();
    await ja.getByRole("textbox", { name: "履歴書" }).fill(RIREKISHO);
    await ja.getByRole("button", { name: "補足資料を追加" }).click();
    // Added after the additional document, the 職務経歴書 still takes its place after the 履歴書.
    await ja.getByRole("button", { name: "職務経歴書を追加" }).click();
    await expect(ja.getByRole("button", { name: "職務経歴書を追加" })).toHaveCount(0);
    await ja.getByRole("textbox", { name: "職務経歴書" }).fill(SHOKUMU);
    const supporting = ja.getByRole("group", { name: "補足資料" });
    await supporting.getByRole("textbox", { name: "資料名" }).fill("ポートフォリオ");
    await supporting.getByRole("textbox", { name: "本文" }).fill(PORTFOLIO);
    await ja.getByRole("button", { name: "このバージョンを保存する" }).click();

    await expect(ja.getByTestId("cv-version-label")).toHaveText("応募書類 v1");
    await expect(ja.getByTestId("cv-claim-count")).toHaveText("記載事項 3件");
    await expect(ja.getByText("3件を抽出。0件は前のバージョンから引き継ぎ、3件が新規。0件を除外。")).toBeVisible();
    await expect(ja.getByRole("heading", { level: 3 })).toHaveText(["履歴書", "職務経歴書", "ポートフォリオ"]);
    await expect(ja.locator("[data-claim]")).toHaveText(JA_CLAIMS.map((claim) => claim.quote));

    // The Japanese prompt, and each document headed by its kind.
    expect(openAi.requests).toHaveLength(1);
    const input = String(openAi.requests[0].body.input);
    expect(input).toContain("=== document 0: rirekisho ===");
    expect(input).toContain("=== document 1: shokumu_keirekisho ===");
    expect(input).toContain("=== document 2: additional, titled: ポートフォリオ ===");
    expect(String(openAi.requests[0].body.instructions)).toContain("応募書類");

    // A reload reads it back from Postgres, and the English panel shows none of it.
    await page.reload();
    await expect(ja.locator("[data-claim]")).toHaveCount(3);
    await expect(page.getByRole("region", { name: "CV", exact: true })).not.toContainText("応募書類");
  } finally {
    await openAi.close();
  }
});

// #16: the next version. Continues from the CV v1 the first English test saved — tests in a file run
// in order, on one worker, against one database.

test("prefilled form → edit → CV v2 with carry-forward counts; an unchanged save is refused; v1 stays readable", async ({
  page,
}) => {
  await signIn(page);
  const openAi = await startMockOpenAi({
    claims: [...CLAIMS, { document: 0, quote: "AWS Solutions Architect, 2025.", start_hint: 160 }],
  });
  try {
    await page.goto("/cv");
    const panel = page.getByRole("region", { name: "CV", exact: true });
    await expect(panel.getByTestId("cv-version-label")).toHaveText("CV v1");

    await panel.getByRole("button", { name: "Create a new version" }).click();
    const box = panel.getByRole("textbox", { name: "CV" });
    await expect(box).toHaveValue(CV);
    await box.fill(`${CV}\nAWS Solutions Architect, 2025.`);
    await panel.getByRole("button", { name: "Save this version" }).click();

    await expect(panel.getByTestId("cv-version-label")).toHaveText("CV v2");
    await expect(panel.getByText("3 claims extracted — 2 carried forward, 1 new. 1 dropped.")).toBeVisible();

    // Saving the prefilled form untouched: refused before any model call, nothing written.
    await panel.getByRole("button", { name: "Create a new version" }).click();
    await panel.getByRole("button", { name: "Save this version" }).click();
    await expect(panel.getByText("Nothing in the CV has changed. No new version was created.")).toBeVisible();
    expect(openAi.requests).toHaveLength(1);

    // History: v1 below the current version, readable at its own page, with no way to make it current.
    await page.goto("/cv");
    const history = panel.getByTestId("cv-version-history");
    await expect(history.getByRole("link")).toHaveCount(1);
    await history.getByRole("link", { name: /CV v1/ }).click();
    await expect(page).toHaveURL(/\/cv\/versions\/[0-9a-f-]{36}$/);
    await expect(page.getByTestId("cv-version-label")).toHaveText("CV v1");
    await expect(page.locator("[data-claim]")).toHaveCount(2);
    await expect(page.getByRole("button")).toHaveCount(0);
  } finally {
    await openAi.close();
  }
});

test("a version id that is not the user's is a 404", async ({ page }) => {
  await signIn(page);
  const response = await page.goto("/cv/versions/00000000-0000-4000-8000-000000000000");
  expect(response?.status()).toBe(404);
  expect((await page.goto("/cv/versions/not-a-uuid"))?.status()).toBe(404);
});
