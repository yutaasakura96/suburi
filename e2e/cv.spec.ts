import { and, asc, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { expect, test, type Locator, type Page } from "@playwright/test";
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

// #17: import. Continues from the 応募書類 v1 the Japanese test saved. The fixtures are written by
// scripts/make-import-fixtures.mts; rirekisho.pdf's font is not embedded, so its text comes through
// only if the pdf.js CMaps are served from /pdfjs/cmaps/.

const IMPORTED_SHOKUMU = [
  "職務経歴書",
  "職務要約",
  "架空物流株式会社にて経理システムの刷新を主導し、請求処理を40%短縮しました。",
  "活かせる経験",
  "チーム5名の統括、要件定義から運用までの一貫した担当。",
].join("\n\n");
const IMPORTED_RIREKISHO = RIREKISHO; // the PDF holds the same three lines
const EDITED_RIREKISHO = IMPORTED_RIREKISHO.replace("基本情報技術者試験", "応用情報技術者試験");

async function importInto(page: Page, group: Locator, label: string, file: string) {
  const chooser = page.waitForEvent("filechooser");
  await group.getByRole("button", { name: label }).click();
  await (await chooser).setFiles(file);
}

async function importBuffer(page: Page, group: Locator, label: string, name: string, buffer: Buffer) {
  const chooser = page.waitForEvent("filechooser");
  await group.getByRole("button", { name: label }).click();
  await (await chooser).setFiles({ name, mimeType: "application/octet-stream", buffer });
}

test("import a Japanese .docx and .pdf, edit a line, save: the saved body is the edited text", async ({
  page,
}) => {
  await signIn(page);
  const openAi = await startMockOpenAi({
    claims: [
      { document: 0, quote: "応用情報技術者試験 合格", start_hint: 30 },
      { document: 1, quote: "請求処理を40%短縮しました。", start_hint: 40 },
    ],
  });
  // Every request the page sends that is not a plain read: the file's bytes must go nowhere.
  const writes: { url: string; contentType: string | null; body: string | null }[] = [];
  page.on("request", (request) => {
    if (request.method() === "GET") return;
    writes.push({ url: request.url(), contentType: request.headers()["content-type"] ?? null, body: request.postData() });
  });
  try {
    await page.goto("/cv");
    const ja = page.getByRole("region", { name: "応募書類" });
    await expect(ja.getByTestId("cv-version-label")).toHaveText("応募書類 v1");
    await ja.getByRole("button", { name: "新しいバージョンをつくる" }).click();

    const shokumu = ja.getByRole("group", { name: "職務経歴書" });
    await importInto(page, shokumu, "ファイルから読み込む", "e2e/fixtures/shokumu.docx");
    // Replaces the prefilled text; blank paragraphs collapse to one blank line.
    await expect(shokumu.getByRole("textbox", { name: "職務経歴書" })).toHaveValue(IMPORTED_SHOKUMU);
    await expect(
      shokumu.getByText("読み込んだ文を確認して、必要なら直してください。保存した文がそのまま評価に使われます。"),
    ).toBeVisible();

    const rirekisho = ja.getByRole("group", { name: "履歴書" });
    const box = rirekisho.getByRole("textbox", { name: "履歴書" });
    await box.fill("");
    await importInto(page, rirekisho, "ファイルから読み込む", "e2e/fixtures/rirekisho.pdf");
    await expect(box).toHaveValue(IMPORTED_RIREKISHO);
    // The box stays editable, and what is saved is what is left in it.
    await box.fill(EDITED_RIREKISHO);

    await ja.getByRole("button", { name: "このバージョンを保存する" }).click();
    await expect(ja.getByTestId("cv-version-label")).toHaveText("応募書類 v2");

    // One write, #14's JSON shape: text and filenames, never the file.
    expect(writes).toHaveLength(1);
    expect(writes[0].url).toMatch(/\/api\/cv-versions$/);
    expect(writes[0].contentType).toBe("application/json");
    const sent = JSON.parse(writes[0].body ?? "{}");
    expect(sent.documents.map((d: { kind: string }) => d.kind)).toEqual(["rirekisho", "shokumu_keirekisho", "additional"]);
    expect(sent.documents[0]).toEqual({ kind: "rirekisho", source_filename: "rirekisho.pdf", text: EDITED_RIREKISHO });
    expect(sent.documents[1]).toEqual({ kind: "shokumu_keirekisho", source_filename: "shokumu.docx", text: IMPORTED_SHOKUMU });
    expect(writes[0].body).not.toContain("%PDF");

    // Read back from Postgres: the edit is in the immutable body, each filename on its document.
    const db = drizzle(E2E_URL);
    try {
      const [version] = await db
        .select({ id: s.cvVersions.id, body: s.cvVersions.body })
        .from(s.cvVersions)
        .where(and(eq(s.cvVersions.language, "ja"), eq(s.cvVersions.versionLabel, "応募書類 v2")))
        .orderBy(desc(s.cvVersions.createdAt));
      expect(version.body).toContain("応用情報技術者試験 合格");
      expect(version.body).not.toContain("基本情報技術者試験");
      const documents = await db
        .select({ kind: s.cvDocuments.kind, sourceFilename: s.cvDocuments.sourceFilename })
        .from(s.cvDocuments)
        .where(eq(s.cvDocuments.cvVersionId, version.id))
        .orderBy(asc(s.cvDocuments.position));
      expect(documents).toEqual([
        { kind: "rirekisho", sourceFilename: "rirekisho.pdf" },
        { kind: "shokumu_keirekisho", sourceFilename: "shokumu.docx" },
        { kind: "additional", sourceFilename: null },
      ]);
    } finally {
      await db.$client.end();
    }
  } finally {
    await openAi.close();
  }
});

test("a file with no text, or one that cannot be opened, says so and leaves the box as it was", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/cv");
  const en = page.getByRole("region", { name: "CV", exact: true });
  await en.getByRole("button", { name: "Create a new version" }).click();
  const document = en.getByRole("group", { name: "CV" });
  const box = document.getByRole("textbox", { name: "CV" });
  const before = await box.inputValue();

  await importInto(page, document, "Import from a file", "e2e/fixtures/blank.pdf");
  await expect(
    document.getByText("No text could be read from this file. A scanned file has none — paste the text instead."),
  ).toBeVisible();
  await expect(box).toHaveValue(before);

  // A legacy Word file renamed to .docx: an OLE header, not a zip.
  await importBuffer(page, document, "Import from a file", "cv.docx", Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1]));
  await expect(
    document.getByText("This file could not be opened. It may be damaged or password-protected — paste the text instead."),
  ).toBeVisible();
  await expect(box).toHaveValue(before);
});
