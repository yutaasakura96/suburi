import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { expect, test, type Page } from "@playwright/test";
import * as s from "../db/schema";
import { seedSyntheticCv } from "../db/seed-cv";
import { seedRubrics, seedSetPieces, seedSyntheticQuestions } from "../db/seed-questions";
import { createAuth } from "../lib/auth/auth";
import { mintSessionCookie } from "../lib/auth/test/session";
import { getConfig } from "../lib/config";
import { E2E_URL } from "./database";
import { startMockOpenAi, type MockOpenAi } from "./mock-openai";
import { startMockS3, type MockS3 } from "./mock-s3";

// The round loop, end to end against the production build: a realistic round from Setup to feedback,
// in English (#42) and in Japanese (#43). The microphone is Chromium's fake device; S3 and OpenAI are
// the local mocks, so nothing leaves the machine and no test calls OpenAI (11 §2).

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

async function seededUserId() {
  return withDb(async (db) => {
    const [user] = await db.select({ id: s.users.id }).from(s.users).where(eq(s.users.email, getConfig().ALLOWED_EMAIL));
    return user.id;
  });
}

async function signIn(page: Page) {
  await withDb(async (db) => {
    const cookie = await mintSessionCookie(createAuth({ db, transaction: true }), await seededUserId());
    await page.context().addCookies([
      { name: cookie.name, value: cookie.value, domain: "localhost", path: "/", httpOnly: true, secure: true, sameSite: "Lax" },
    ]);
  });
}

// What the fake transcriber hears: an ASR slip ("pay mints") the correction screen exists to fix.
const RAW = "I led the pay mints migration, um, over six months and cut the failure rate by half.";
const CORRECTED = "I led the payments migration over six months and cut the failure rate by half.";

const HEARD_EN = { text: RAW, seconds: 18 };

// A Japanese take, as 10 §5 draws it: 800 characters in 3:12 is 250 字/分, with an ASR slip (決済期版
// for 決済基盤) the correction screen exists to fix.
const RAW_JA = "えー、前職では決済期版の移行を担当しておりまして、半年で完了いたしました。".repeat(22).slice(0, 800);
const CORRECTED_JA = RAW_JA.replaceAll("決済期版", "決済基盤");
const HEARD_JA = { text: RAW_JA, seconds: 192 };

const DIMENSIONS = ["structure", "evidence", "relevance", "fluency", "accuracy", "length_pacing"];
// 10 §8's sample row: 構成 4 · 根拠 3 · 関連性 4 · 流暢さ 3 · 正確さ 4 · 長さ・配分 2 · 敬語 3.
const SCORES = { structure: 4, evidence: 3, relevance: 4, fluency: 3, accuracy: 4, length_pacing: 2, keigo: 3 } as const;
const FINDINGS = {
  to_fix: [
    { title: "Lead with the result", body: "In answer 1, the outcome arrives last." },
    { title: "Name the number", body: "In answer 2, the scale of the change stays vague." },
  ],
  what_worked: "In answer 3, the example was concrete and your own.",
};
// What the Japanese feedback prompt returns: the findings, and the same findings in English.
const FINDINGS_JA = {
  to_fix: [
    { title: "結論を最初の一文に置く", body: "第1問で、結論が最後に出てくる。" },
    { title: "数値を一つ挙げる", body: "第2問で、成果が抽象的なままである。" },
  ],
  what_worked: "第3問で、具体的な場面を挙げて説明できている。",
  translated: {
    to_fix: [
      { title: "Put the conclusion first", body: "In answer 1, the conclusion arrives last." },
      { title: "Name one number", body: "In answer 2, the outcome stays abstract." },
    ],
    what_worked: "In answer 3, you explained with a concrete situation.",
  },
};

let s3: MockS3;
let openAi: MockOpenAi;
let feedbackFails = false;
// What the fake transcriber hears next: the mock sees a multipart body, not the round's language.
let heard = HEARD_EN;
// Scoring fails, past its retries, for an answer whose text carries UNSCORABLE — or for every answer.
const UNSCORABLE = "zebra-unscorable-sentinel";
let scoringFails = false;

function formatOf(body: Record<string, unknown>) {
  return ((body.text as { format?: { name?: string } } | undefined)?.format?.name ?? "") as string;
}

/** Whether a model call is for a Japanese round: every round-loop input opens with its rubric. */
function japanese(body: Record<string, unknown>) {
  return String(body.input).startsWith("=== rubric ja ");
}

test.beforeAll(async () => {
  // Seeded here, not in global setup, so the CV screen's empty state stays real for cv.spec.ts; that
  // spec runs first (one worker, file order), and a CV it already saved is left as it is.
  const userId = await seededUserId();
  await withDb(async (db) => {
    await db.transaction((tx) => seedSyntheticCv(tx, userId, "en"));
    await db.transaction((tx) => seedSyntheticCv(tx, userId, "ja"));
    await seedRubrics(db);
    await seedSetPieces(db, userId);
    await seedSyntheticQuestions(db, userId);
  });
  s3 = await startMockS3();
  openAi = await startMockOpenAi(
    (body) => {
      if (formatOf(body) === "answer_scores") {
        if (scoringFails || JSON.stringify(body).includes(UNSCORABLE)) return { fail: 500 };
        const dimensions = japanese(body) ? [...DIMENSIONS, "keigo"] : DIMENSIONS;
        return { scores: dimensions.map((dimension) => ({ dimension, value: SCORES[dimension as keyof typeof SCORES], justification: "e2e" })) };
      }
      if (formatOf(body) === "round_feedback") return feedbackFails ? { fail: 500 } : japanese(body) ? FINDINGS_JA : FINDINGS;
      return { fail: 400 };
    },
    { transcription: () => heard },
  );
});

test.afterAll(async () => {
  await openAi?.close();
  await s3?.close();
});

test.beforeEach(() => {
  feedbackFails = false;
  scoringFails = false;
  heard = HEARD_EN;
});

/** Starts a round through the API, as Setup does. */
async function startRound(page: Page, language: "ja" | "en" = "en") {
  const context = await page.request.post("/api/role-contexts", { data: { kind: "general" } });
  expect(context.ok()).toBe(true);
  const round = await page.request.post("/api/rounds", {
    data: { round_type: "hr", language, mode: "realistic", length: 3, role_context_id: (await context.json()).id },
  });
  expect(round.status()).toBe(201);
  return (await round.json()).round.id as string;
}

/** One answer through the API — slot, PUT, transcribe, submit — for specs about what comes after. */
async function answerByApi(page: Page, roundId: string, corrected = CORRECTED) {
  const opened = await page.request.post(`/api/rounds/${roundId}/answers`, {
    data: { content_type: "audio/webm", expected_bytes: 4 },
  });
  const slot = await opened.json();
  const put = await page.request.put(slot.upload.url, { headers: slot.upload.headers, data: Buffer.from([1, 2, 3, 4]) });
  expect(put.ok()).toBe(true);
  expect((await page.request.post(`/api/answers/${slot.answer_id}/transcribe`, { data: {} })).ok()).toBe(true);
  const submitted = await page.request.post(`/api/answers/${slot.answer_id}/submit`, { data: { transcript_corrected: corrected } });
  expect(submitted.ok()).toBe(true);
}

test("a realistic English round: Setup → record → correct → pressure → feedback, all six rows", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page);
  const userId = await seededUserId();

  await page.goto("/");
  await page.getByRole("link", { name: "Start a round" }).click();
  await expect(page).toHaveURL("/round/new");
  // v1 seeded here, or a later version cv.spec.ts saved: whichever is current.
  await expect(page.getByTestId("setup-cv")).toContainText(/^CV v\d+/);
  await expect(page.getByTestId("setup-estimate")).toContainText("3 questions · up to about 12 min");
  await page.getByRole("button", { name: "Start this round" }).click();
  await expect(page).toHaveURL(/\/round\/[0-9a-f-]{36}$/);
  const roundId = page.url().split("/").at(-1)!;

  for (let position = 1; position <= 3; position += 1) {
    await expect(page.getByTestId("round-step")).toHaveText(`Question ${position} / 3`);
    // Realistic asks one unseen set piece first (07 §5.4).
    if (position === 1) await expect(page.getByTestId("round-question")).toHaveText("Could you start by introducing yourself?");
    await expect(page.getByText("The feedback comes together when the round ends. Nothing is shown along the way.")).toBeVisible();

    const asked = await page.getByTestId("round-question").boundingBox();
    await page.getByRole("button", { name: "Start recording" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Recording" })).toBeVisible();
    // The question does not shrink or move when recording starts (10 §4).
    expect(await page.getByTestId("round-question").boundingBox()).toEqual(asked);
    await expect(page.getByTestId("record-timer")).toHaveText("0:01", { timeout: 5_000 });
    await page.getByRole("button", { name: "Stop and transcribe" }).click();

    // Screen 5: the raw transcript with its slip intact, and figures that agree with each other.
    await expect(page.getByTestId("raw-transcript")).toHaveText(RAW);
    await expect(page.getByTestId("take-figures")).toHaveText("0:18 · ~57 wpm · 17 words");
    await page.getByRole("button", { name: "Correct the transcript" }).click();

    // Screen 6: the raw text stays beside the editor, and the meter moves as the text does.
    await expect(page.getByTestId("rewrite-percent")).toHaveText("0%");
    await page.getByRole("textbox").fill(CORRECTED);
    await expect(page.getByTestId("rewrite-percent")).not.toHaveText("0%");
    await expect(page.getByTestId("raw-kept")).toHaveText(RAW);
    await page.getByRole("button", { name: "Send this answer" }).click();
  }

  // Screen 7: not skippable — inert until a rating is picked, and no way round it.
  await expect(page.getByText("How tense did this round feel?")).toBeVisible();
  const toFeedback = page.getByRole("button", { name: "Go to the feedback" });
  await expect(toFeedback).toBeDisabled();
  await expect(page.getByText("Pick one to go on to the feedback.")).toBeVisible();
  await page.getByRole("radio", { name: /Very tense/ }).click();
  await expect(page.getByText("Records pressure 4 for this round.")).toBeVisible();
  await toFeedback.click();

  // Screen 8, rendered from stored rows at once.
  await expect(page).toHaveURL(`/round/${roundId}/feedback`);
  const rows = page.getByTestId("score-row");
  await expect(rows).toHaveCount(6);
  await expect(page.getByTestId("score-value")).toHaveText(["4", "3", "4", "3", "4", "2"]);
  await expect(page.getByTestId("to-fix")).toContainText("To fix 2");
  await expect(page.getByTestId("to-fix")).toContainText("Lead with the result");
  await expect(page.getByTestId("what-worked")).toContainText("What worked 1");
  await expect(page.getByTestId("pressure-stamp")).toHaveText("Pressure 4 recorded before the feedback");
  await expect(page.getByTestId("round-stamp")).toContainText("Rubric v1.0");
  await expect(page.getByTestId("answer-figures")).toContainText("0 min 18 s · ~57 wpm · rewrite");
  // No composite, anywhere on the screen (AGENTS.md invariant 1).
  await expect(page.locator("main")).not.toContainText(/total|average|overall/i);
  await page.getByRole("button", { name: "Question 2" }).click();
  await expect(page.getByTestId("answer-region")).toHaveAttribute("data-position", "2");

  // Three takes under dev/{user}/{round}/, each as the browser recorded it.
  const keys = [...s3.objects.keys()].filter((key) => key.startsWith(`dev/${userId}/${roundId}/`));
  expect(keys).toHaveLength(3);
  for (const key of keys) {
    expect(s3.objects.get(key)!.bytes).toBeGreaterThan(0);
    expect(s3.objects.get(key)!.contentType).toMatch(/^audio\/webm/);
  }
  // The scorer read the corrected text, never the raw one (03 §4).
  const scoring = openAi.requests.filter((request) => formatOf(request.body) === "answer_scores");
  expect(scoring.length).toBeGreaterThanOrEqual(3);
  for (const request of scoring) {
    expect(JSON.stringify(request.body)).toContain("payments migration");
    expect(JSON.stringify(request.body)).not.toContain("pay mints");
  }

  // A completed round's page is its feedback.
  await page.goto(`/round/${roundId}`);
  await expect(page).toHaveURL(`/round/${roundId}/feedback`);
});

test("screen 7 cannot be skipped: the feedback URL sends an unrated round back to it", async ({ page }) => {
  await signIn(page);
  const roundId = await startRound(page);
  for (let position = 1; position <= 3; position += 1) await answerByApi(page, roundId);

  await page.goto(`/round/${roundId}/feedback`);
  await expect(page).toHaveURL(`/round/${roundId}`);
  await expect(page.getByText("How tense did this round feel?")).toBeVisible();
  await expect(page.getByRole("button", { name: "Go to the feedback" })).toBeDisabled();
  // Nothing on the screen leads out of the round.
  await expect(page.getByRole("link")).toHaveCount(0);
  // Nor does the API close it without a rating.
  const refused = await page.request.post(`/api/rounds/${roundId}/complete`, { data: {} });
  expect(refused.status()).toBe(422);
  expect((await refused.json()).error.code).toBe("pressure_required");
});

test("feedback not ready: the scores render, one sentence says so, and the retry writes the findings", async ({ page }) => {
  await signIn(page);
  const roundId = await startRound(page);
  for (let position = 1; position <= 3; position += 1) await answerByApi(page, roundId);

  feedbackFails = true;
  await page.goto(`/round/${roundId}`);
  await page.getByRole("radio", { name: /Fairly tense/ }).click();
  await page.getByRole("button", { name: "Go to the feedback" }).click();

  await expect(page).toHaveURL(`/round/${roundId}/feedback`);
  await expect(page.getByTestId("findings-not-ready")).toContainText("The findings for this round are not ready.");
  await expect(page.getByTestId("score-row")).toHaveCount(6);
  await expect(page.getByTestId("pressure-stamp")).toHaveText("Pressure 3 recorded before the feedback");
  await expect(page.getByTestId("to-fix")).toHaveCount(0);

  feedbackFails = false;
  await page.getByRole("button", { name: "Write the findings" }).click();
  await expect(page.getByTestId("to-fix")).toContainText("Lead with the result");
  await expect(page.getByTestId("findings-not-ready")).toHaveCount(0);
});

/** Waits until every answer of the round has a finished latest scoring attempt. */
async function scoringSettled(roundId: string) {
  await expect
    .poll(
      () =>
        withDb(async (db) => {
          const rows = await db
            .select({ status: s.scoringAttempts.status })
            .from(s.scoringAttempts)
            .innerJoin(s.answers, eq(s.answers.id, s.scoringAttempts.answerId))
            .where(eq(s.answers.roundId, roundId));
          return rows.length >= 3 && rows.every((row) => row.status !== "pending");
        }),
      { timeout: 60_000, intervals: [1_000] },
    )
    .toBe(true);
}

test("an answer whose scoring failed never reaches the feedback generator", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page);
  const roundId = await startRound(page);
  await answerByApi(page, roundId);
  await answerByApi(page, roundId, `I could not be scored ${UNSCORABLE}.`);
  await answerByApi(page, roundId);
  await scoringSettled(roundId);

  const before = openAi.requests.length;
  await page.goto(`/round/${roundId}`);
  await page.getByRole("radio", { name: /Fairly tense/ }).click();
  await page.getByRole("button", { name: "Go to the feedback" }).click();
  await expect(page).toHaveURL(`/round/${roundId}/feedback`);
  await expect(page.getByTestId("to-fix")).toContainText("Lead with the result");

  const feedbackCalls = openAi.requests.slice(before).filter((request) => formatOf(request.body) === "round_feedback");
  expect(feedbackCalls).toHaveLength(1);
  const sent = JSON.stringify(feedbackCalls[0].body);
  expect(sent).not.toContain(UNSCORABLE);
  expect(sent).toContain("=== answer 1 ===");
  expect(sent).not.toContain("=== answer 2 ===");
  expect(sent).toContain("=== answer 3 ===");
  await page.screenshot({ path: test.info().outputPath("screen8-one-failed.png"), fullPage: true });
});

test("no answer scored: screen 8 says so, offers no retry, and the API refuses as no_scores", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page);
  const roundId = await startRound(page);
  scoringFails = true;
  for (let position = 1; position <= 3; position += 1) await answerByApi(page, roundId);
  await scoringSettled(roundId);

  const before = openAi.requests.length;
  await page.goto(`/round/${roundId}`);
  await page.getByRole("radio", { name: /Fairly tense/ }).click();
  await page.getByRole("button", { name: "Go to the feedback" }).click();
  await expect(page).toHaveURL(`/round/${roundId}/feedback`);
  await expect(page.getByTestId("findings-unavailable")).toHaveText(
    "No answer in this round could be scored, so there are no findings for this round. The round is complete and its rating is recorded.",
  );
  await expect(page.getByRole("button", { name: "Write the findings" })).toHaveCount(0);
  await expect(page.getByTestId("findings-not-ready")).toHaveCount(0);
  await expect(page.getByTestId("pressure-stamp")).toHaveText("Pressure 3 recorded before the feedback");
  await page.screenshot({ path: test.info().outputPath("screen8-no-scores.png"), fullPage: true });

  const retried = await page.request.post(`/api/rounds/${roundId}/feedback`, { data: {} });
  expect(retried.status()).toBe(502);
  const error = (await retried.json()).error;
  expect(error).toMatchObject({ code: "feedback_generation_failed", detail: { error_class: "no_scores" } });
  expect(openAi.requests.slice(before).filter((request) => formatOf(request.body) === "round_feedback")).toHaveLength(0);
  await page.reload();
  await expect(page.getByTestId("findings-unavailable")).toBeVisible();
});

// The English chrome's own words: none of them may appear on a Japanese round's screens (10 §0).
const ENGLISH_CHROME = /Question|Record|Rewrite|Raw|transcript|feedback|Send|Start|Stop|Correct|tense|Pressure|Rubric|wpm|words|Home|scored/i;

test("a realistic Japanese round: Japanese throughout, seven rows, and the feedback read in English", async ({ page }) => {
  test.setTimeout(180_000);
  heard = HEARD_JA;
  await signIn(page);
  const shot = (name: string) => page.screenshot({ path: test.info().outputPath(`ja-${name}.png`), fullPage: true });

  // Setup is app-level and English (10 §0); the stored label keeps its own language.
  await page.goto("/round/new");
  await page.getByRole("radio", { name: "Japanese" }).click();
  await expect(page.getByTestId("setup-cv")).toContainText(/^応募書類 v\d+/);
  await expect(page.getByTestId("setup-estimate")).toContainText("Rubric v1.0");
  await shot("2-setup");
  await page.getByRole("button", { name: "Start this round" }).click();
  await expect(page).toHaveURL(/\/round\/[0-9a-f-]{36}$/);
  const roundId = page.url().split("/").at(-1)!;
  const main = page.locator("main");
  await expect(main).toHaveAttribute("lang", "ja");
  await expect(page).toHaveTitle("ラウンド — Suburi");

  for (let position = 1; position <= 3; position += 1) {
    // Screen 3: the round header and the asked frame.
    await expect(page.getByTestId("round-step")).toHaveText(`第${position}問 / 3問`);
    await expect(page.getByText("日本語・実戦・3問")).toBeVisible();
    if (position === 1) await expect(page.getByTestId("round-question")).toHaveText("まず、簡単に自己紹介をお願いします。");
    await expect(page.getByText("講評はラウンドが終わってからまとめて出ます。途中では何も出ません。")).toBeVisible();
    await expect(page.getByText("一発勝負です。録り直しはできません。")).toBeVisible();
    await expect(page.getByText("最長 4分")).toBeVisible();
    await expect(page.getByTestId("round-stamp")).toContainText("・応募書類 v");
    await expect(main).not.toContainText(ENGLISH_CHROME);
    if (position === 1) await shot("3-asked");

    // Screen 4.
    await page.getByRole("button", { name: "録音を開始" }).click();
    await expect(page.getByRole("status").filter({ hasText: "録音中" })).toBeVisible();
    await expect(page.getByText("4分で自動的に止まります。そこまでの録音は残ります。")).toBeVisible();
    await expect(page.getByTestId("record-timer")).toHaveText("0:01", { timeout: 5_000 });
    await expect(main).not.toContainText(ENGLISH_CHROME);
    if (position === 1) await shot("4-recording");
    await page.getByRole("button", { name: "停止して文字起こし" }).click();

    // Screen 5: 10 §5's three figures, consistent with each other, in 字.
    await expect(page.getByTestId("raw-transcript")).toHaveText(RAW_JA);
    await expect(page.getByTestId("take-figures")).toHaveText("3:12・約250字/分・800字");
    await expect(page.getByText("文字起こし — 未修正")).toBeVisible();
    await expect(page.getByText("この先も続きます。全文は次の画面で直せます。音声も未修正の文字起こしも消えません。")).toBeVisible();
    await expect(main).not.toContainText(ENGLISH_CHROME);
    if (position === 1) await shot("5-transcript");
    await page.getByRole("button", { name: "文字起こしを直す" }).click();

    // Screen 6: the Latin section labels are Japanese, and the count is in 字.
    await expect(page.getByText("あなたの回答 — 自由に直せます")).toBeVisible();
    await expect(page.getByText("未修正の文字起こし — 置き換えずに残します")).toBeVisible();
    await expect(page.getByTestId("word-change")).toHaveText("800字 → 800字");
    await expect(page.getByTestId("rewrite-percent")).toHaveText("0%");
    await page.getByRole("textbox").fill(CORRECTED_JA);
    await expect(page.getByTestId("rewrite-percent")).not.toHaveText("0%");
    await expect(page.getByTestId("raw-kept")).toHaveText(RAW_JA);
    await expect(main).not.toContainText(ENGLISH_CHROME);
    if (position === 1) await shot("6-correction");
    await page.getByRole("button", { name: "この回答を送る" }).click();
  }

  // Screen 7.
  await expect(page.getByText("いまのラウンド、どのくらい緊張しましたか。")).toBeVisible();
  await expect(page.getByText("講評の前に", { exact: true })).toBeVisible();
  const toFeedback = page.getByRole("button", { name: "講評に進む" });
  await expect(toFeedback).toBeDisabled();
  await expect(page.getByText("1つ選ぶと講評に進めます。")).toBeVisible();
  await page.getByRole("radio", { name: /かなり緊張した/ }).click();
  await expect(page.getByText("緊張度 4 をこのラウンドに記録します。")).toBeVisible();
  await expect(page.getByTestId("round-stamp")).toContainText("評価基準 v1.0・");
  await expect(main).not.toContainText(ENGLISH_CHROME);
  await shot("7-pressure");
  await toFeedback.click();

  // Screen 8, in Japanese: seven rows, 敬語 last.
  await expect(page).toHaveURL(`/round/${roundId}/feedback`);
  await expect(page).toHaveTitle("講評 — Suburi");
  await expect(main).toHaveAttribute("lang", "ja");
  const rows = page.getByTestId("score-row");
  await expect(rows).toHaveCount(7);
  const labels = () => rows.evaluateAll((elements) => elements.map((element) => element.getAttribute("data-dimension")));
  expect(await labels()).toEqual(["構成", "根拠", "関連性", "流暢さ", "正確さ", "長さ・配分", "敬語"]);
  await expect(page.getByTestId("score-value")).toHaveText(["4", "3", "4", "3", "4", "2", "3"]);
  await expect(page.getByTestId("answer-region")).toContainText("第1問 / 3問");
  await expect(page.getByTestId("answer-figures")).toHaveText(/^3分12秒・約250字\/分・書き直し \d+%$/);
  await expect(page.getByTestId("to-fix")).toContainText("直すところ 2件");
  await expect(page.getByTestId("to-fix")).toContainText("結論を最初の一文に置く");
  await expect(page.getByTestId("what-worked")).toContainText("良かったところ 1件");
  await expect(page.getByTestId("what-worked")).toContainText("第3問で、具体的な場面を挙げて説明できている。");
  await expect(page.getByTestId("pressure-stamp")).toHaveText("緊張度 4 を講評前に記録");
  await expect(page.getByTestId("round-stamp")).toContainText(/^評価基準 v1\.0・.*・応募書類 v\d+/);
  await expect(main).not.toContainText(/total|average|overall|合計|平均|総合/i);
  // The pill is the one Latin word on the screen, and it names the language it switches to.
  const pill = page.getByTestId("feedback-language");
  await expect(pill).toHaveText("English");
  await expect(page.getByTestId("findings")).not.toContainText(ENGLISH_CHROME);
  await shot("8-feedback");

  // The toggle changes the feedback — the dimension names and the findings — and nothing else.
  await pill.click();
  await expect(pill).toHaveText("日本語");
  expect(await labels()).toEqual(["Structure", "Evidence", "Relevance", "Fluency", "Accuracy", "Length and pacing", "Keigo (register)"]);
  await expect(page.getByTestId("score-value")).toHaveText(["4", "3", "4", "3", "4", "2", "3"]);
  await expect(page.getByTestId("to-fix")).toContainText("To fix 2");
  await expect(page.getByTestId("to-fix")).toContainText("Put the conclusion first");
  await expect(page.getByTestId("to-fix")).not.toContainText("結論を最初の一文に置く");
  await expect(page.getByTestId("what-worked")).toContainText("What worked 1");
  await expect(page.getByTestId("what-worked")).toContainText("In answer 3, you explained with a concrete situation.");
  await expect(page.getByTestId("findings")).toHaveAttribute("lang", "en");
  await expect(page.getByText("日本語・実戦・3問")).toBeVisible();
  await expect(page.getByTestId("answer-region")).toContainText("第1問 / 3問");
  await expect(page.getByTestId("pressure-stamp")).toHaveText("緊張度 4 を講評前に記録");
  await shot("8-feedback-english");
  await pill.click();
  await expect(pill).toHaveText("English");
  await expect(page.getByTestId("to-fix")).toContainText("結論を最初の一文に置く");
  await page.getByRole("button", { name: "第2問" }).click();
  await expect(page.getByTestId("answer-region")).toHaveAttribute("data-position", "2");

  // The translation is stored with the feedback, once (04 `body_translated`).
  const [stored] = await withDb((db) => db.select().from(s.roundFeedback).where(eq(s.roundFeedback.roundId, roundId)));
  expect(stored.language).toBe("ja");
  expect(stored.bodyTranslated).toEqual({ language: "en", ...FINDINGS_JA.translated });
  expect(stored.promptVersion).toBe("feedback-ja-1.0");

  // The scorer read the Japanese rubric and the corrected text, never the raw one (03 §4).
  const scoring = openAi.requests.filter((request) => formatOf(request.body) === "answer_scores" && japanese(request.body));
  expect(scoring.length).toBeGreaterThanOrEqual(3);
  for (const request of scoring) {
    const sent = JSON.stringify(request.body);
    expect(sent).toContain("- keigo (敬語): ");
    expect(sent).toContain("pace: 250 characters per minute");
    expect(sent).toContain("決済基盤");
    expect(sent).not.toContain("決済期版");
  }
  // The pace is stored in characters per minute of the raw transcript (04 `answers`).
  const answers = await withDb((db) => db.select().from(s.answers).where(eq(s.answers.roundId, roundId)));
  expect(answers).toHaveLength(3);
  for (const answer of answers) expect(answer.wordsPerMinute).toBe(250);

  // A stored Japanese finding without an English translation must never offer the toggle.
  await withDb((db) => db.update(s.roundFeedback).set({ bodyTranslated: null }).where(eq(s.roundFeedback.roundId, roundId)));
  await page.reload();
  await expect(page.getByTestId("feedback-language")).toHaveCount(0);
  await expect(page.getByTestId("to-fix")).toContainText("結論を最初の一文に置く");
  await expect(page.getByTestId("what-worked")).toContainText("第3問で、具体的な場面を挙げて説明できている。");
  await page.screenshot({ path: test.info().outputPath("ja-8-no-translation.png"), fullPage: true });
});

test("a Japanese round whose findings are not ready says so in Japanese, and the retry writes them", async ({ page }) => {
  heard = HEARD_JA;
  await signIn(page);
  const roundId = await startRound(page, "ja");
  for (let position = 1; position <= 3; position += 1) await answerByApi(page, roundId, CORRECTED_JA);

  feedbackFails = true;
  await page.goto(`/round/${roundId}`);
  await page.getByRole("radio", { name: /それなりに緊張した/ }).click();
  await page.getByRole("button", { name: "講評に進む" }).click();

  await expect(page).toHaveURL(`/round/${roundId}/feedback`);
  await expect(page.getByTestId("findings-not-ready")).toContainText("このラウンドの講評はまだできていません。");
  await expect(page.getByTestId("score-row")).toHaveCount(7);
  await expect(page.getByTestId("pressure-stamp")).toHaveText("緊張度 3 を講評前に記録");
  await expect(page.locator("main")).not.toContainText(ENGLISH_CHROME);
  await page.screenshot({ path: test.info().outputPath("ja-8-not-ready.png"), fullPage: true });

  // The retry fails once more: the catalogue's sentence, in the round's language.
  await page.getByRole("button", { name: "講評をまとめる" }).click();
  await expect(page.getByTestId("findings-not-ready").getByRole("alert")).toHaveText("講評をまとめられませんでした。ラウンドは終了し、採点は残っています。もう一度お試しください。");

  feedbackFails = false;
  await page.getByRole("button", { name: "講評をまとめる" }).click();
  await expect(page.getByTestId("to-fix")).toContainText("結論を最初の一文に置く");
  await expect(page.getByTestId("findings-not-ready")).toHaveCount(0);
});
