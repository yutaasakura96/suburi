import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { expect, test, type Page } from "@playwright/test";
import * as s from "../db/schema";
import { seedSyntheticCv } from "../db/seed-cv";
import { seedRubrics, seedSetPieces, seedSyntheticQuestions } from "../db/seed-questions";
import { createAuth } from "../lib/auth/auth";
import { mintSessionCookie } from "../lib/auth/test/session";
import { getConfig } from "../lib/config";
import { E2E_URL } from "./database";
import { generatedQuestions, silentPcm, startMockOpenAi, type MockOpenAi } from "./mock-openai";
import { startMockS3, type MockS3 } from "./mock-s3";

// 11 §4, `English help in practice` (#106, #123, #124): a Japanese practice round's pill shows the
// question's stored English under the Japanese without moving it, across the record frames and the
// per-answer frame, starts from the setting, and a reload returns to the setting; a question with no
// English says so. With it on, the frames' chrome is English — the record frames, a failure, the
// correction screen and the per-answer frame — and pressing it again turns it back, while what was
// asked and said stays Japanese. A Japanese realistic round has no pill and no English on screens
// 3–7. Against the production build, with S3 and OpenAI mocked (11 §2).

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

const HEARD = "前職では、請求処理の移行を担当しました。";
const FOLLOW_UP = "その移行で、ご自身が担った部分はどこですか。";
const DIMENSIONS = ["structure", "evidence", "relevance", "fluency", "accuracy", "length_pacing", "keigo"];
const NONE = "No English for this question yet.";
const JUSTIFICATION = "結論から先に述べている。";

let s3: MockS3;
let openAi: MockOpenAi;
/** Set while a spec needs the transcription to fail: the catalogue's `transcription_failed` follows. */
let transcriptionFails = false;

function formatOf(body: Record<string, unknown>) {
  return ((body.text as { format?: { name?: string } } | undefined)?.format?.name ?? "") as string;
}

test.beforeAll(async () => {
  const userId = await seededUserId();
  await withDb(async (db) => {
    await db.transaction((tx) => seedSyntheticCv(tx, userId, "ja"));
    await seedRubrics(db);
    await seedSetPieces(db, userId);
    await seedSyntheticQuestions(db, userId);
  });
  s3 = await startMockS3();
  openAi = await startMockOpenAi(
    (body) => {
      if (formatOf(body) === "answer_scores") {
        return {
          scores: DIMENSIONS.map((dimension) => ({ dimension, value: 3, justification: JUSTIFICATION })),
          citations: [],
          unsupported: [],
          answered_language: "ja",
        };
      }
      if (formatOf(body) === "follow_up") return { follow_up: FOLLOW_UP };
      if (formatOf(body) === "generated_questions") return generatedQuestions(body);
      return { fail: 400 };
    },
    { transcription: () => (transcriptionFails ? { fail: 400 } : { text: HEARD, seconds: 12 }), speech: silentPcm },
  );
});

test.afterAll(async () => {
  await openAi?.close();
  await s3?.close();
  await setting(false);
});

/** The user's English help setting, as `/settings` stores it (04 `user_settings`). */
function setting(englishHelp: boolean) {
  return withDb(async (db) => {
    const userId = await seededUserId();
    await db
      .insert(s.userSettings)
      .values({ userId, englishHelp })
      .onConflictDoUpdate({ target: s.userSettings.userId, set: { englishHelp } });
  });
}

// A realistic round here is technical: it has no set piece, so it leaves the HR set pieces unseen for
// the round specs that ask them first (07 §5.4).
async function startRound(page: Page, mode: "practice" | "realistic", roundType: "hr" | "technical" = "hr") {
  const context = await page.request.post("/api/role-contexts", { data: { kind: "general" } });
  expect(context.ok()).toBe(true);
  const round = await page.request.post("/api/rounds", {
    data: { round_type: roundType, language: "ja", mode, length: 3, role_context_id: (await context.json()).id },
  });
  expect(round.status()).toBe(201);
  return (await round.json()).round.id as string;
}

const askedOf = (roundId: string) =>
  withDb(async (db) =>
    (
      await db
        .select({ id: s.roundQuestions.questionId })
        .from(s.roundQuestions)
        .where(eq(s.roundQuestions.roundId, roundId))
        .orderBy(asc(s.roundQuestions.position))
    ).map((row) => row.id),
  );

/** A question's English, written as the script writes one (04 `question_translations`). */
function storeEnglish(questionId: string, body: string) {
  return withDb(async (db) => {
    await db.insert(s.questionTranslations).values({
      questionId,
      userId: await seededUserId(),
      language: "en",
      body,
      source: "translated",
      modelId: "e2e-translate-2026-01-01",
      promptVersion: "translate-question-en-e2e",
    });
  });
}

/** One answer through the API — slot, PUT, transcribe, and submit unless told not to. */
async function answerByApi(page: Page, roundId: string, { submit = true } = {}) {
  const opened = await page.request.post(`/api/rounds/${roundId}/answers`, { data: { content_type: "audio/webm", expected_bytes: 4 } });
  const slot = await opened.json();
  const put = await page.request.put(slot.upload.url, { headers: slot.upload.headers, data: Buffer.from([1, 2, 3, 4]) });
  expect(put.ok()).toBe(true);
  expect((await page.request.post(`/api/answers/${slot.answer_id}/transcribe`, { data: {} })).ok()).toBe(true);
  if (!submit) return slot.answer_id as string;
  const submitted = await page.request.post(`/api/answers/${slot.answer_id}/submit`, { data: { transcript_corrected: HEARD } });
  expect(submitted.ok()).toBe(true);
  return slot.answer_id as string;
}

test("a Japanese practice round's pill shows the question's English under it, from the setting, until a reload", async ({ page }) => {
  test.setTimeout(120_000);
  await setting(false);
  await signIn(page);
  const roundId = await startRound(page, "practice");
  const [first] = await askedOf(roundId);
  const ENGLISH = "Tell us about a time you disagreed with your manager, and what you did.";
  await storeEnglish(first, ENGLISH);

  await page.goto(`/round/${roundId}`);
  const pill = page.getByTestId("english-help-pill");
  const question = page.getByTestId("round-question");
  // The setting is off: the pill names the language it switches to, and no English is shown.
  await expect(pill).toHaveText("English");
  await expect(pill).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTestId("prompt-english")).toHaveCount(0);
  const before = await question.boundingBox();

  await pill.click();
  await expect(pill).toHaveText("日本語");
  await expect(pill).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("prompt-english")).toHaveText(ENGLISH);
  await expect(page.getByTestId("prompt-english")).toHaveAttribute("lang", "en");
  // The Japanese stays at its size and in its place.
  expect(await question.boundingBox()).toEqual(before);
  await page.screenshot({ path: test.info().outputPath("english-help-record.png"), fullPage: true });

  // It stays on across the record frames, the correction screen and the per-answer frame.
  await page.getByRole("button", { name: "Start recording" }).click();
  await expect(page.getByTestId("waveform").locator("span > span").nth(1)).toBeAttached({ timeout: 5_000 });
  await page.getByRole("button", { name: "Stop recording" }).click();
  await expect(page.getByTestId("take-held")).toBeVisible();
  await expect(page.getByTestId("prompt-english")).toHaveText(ENGLISH);
  await page.getByRole("button", { name: "Transcribe this take" }).click();
  await expect(page.getByTestId("raw-transcript")).toHaveText(HEARD);
  await expect(page.getByTestId("prompt-english")).toHaveText(ENGLISH);
  await page.getByRole("button", { name: "Correct the transcript" }).click();
  await expect(pill).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Send this answer" }).click();
  await expect(page.getByTestId("answered-frame")).toBeVisible();
  await expect(pill).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("answered-frame").getByTestId("prompt-english")).toHaveText(ENGLISH);
  // The follow-up `Next` names has no English yet (#125), and says so.
  await expect(page.getByTestId("next-follow-up")).toContainText(FOLLOW_UP);
  await expect(page.getByTestId("next-follow-up").getByTestId("prompt-english-none")).toHaveText(NONE);
  await page.screenshot({ path: test.info().outputPath("english-help-answered.png"), fullPage: true });

  // Page state, never the setting: a reload starts from the setting again.
  await page.reload();
  await expect(page.getByTestId("answered-frame")).toBeVisible();
  await expect(pill).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTestId("prompt-english")).toHaveCount(0);
  await expect(page.getByTestId("prompt-english-none")).toHaveCount(0);
  const stored = await withDb((db) => db.select().from(s.userSettings));
  expect(stored.map((row) => row.englishHelp)).toEqual([false]);

  // A prompt with no stored English says so, and nothing is generated for it.
  await pill.click();
  await page.getByRole("button", { name: "Answer the follow-up" }).click();
  await expect(question).toHaveText(FOLLOW_UP);
  await expect(page.getByTestId("prompt-english-none")).toHaveText(NONE);
  expect(openAi.requests.filter((request) => formatOf(request.body) === "question_english")).toHaveLength(0);
});

test("the pill turns a Japanese practice round's chrome English across its frames, and back", async ({ page }) => {
  test.setTimeout(120_000);
  await setting(false);
  await signIn(page);
  const roundId = await startRound(page, "practice");
  await page.goto(`/round/${roundId}`);
  const pill = page.getByTestId("english-help-pill");
  const round = page.getByRole("region", { name: /HR|人事面接/u });
  const header = page.locator("header").filter({ has: pill });
  const step = page.getByTestId("round-step");
  const question = page.getByTestId("round-question");
  const japaneseQuestion = await question.textContent();

  // Screen 3 in Japanese, then in English: header, step, tab title, controls, captions and footer.
  await expect(page).toHaveTitle("ラウンド — Suburi");
  await expect(header).toContainText("日本語・練習・3問");
  await pill.click();
  await expect(page).toHaveTitle("Round — Suburi");
  await expect(round).toHaveAttribute("lang", "en");
  await expect(header.locator("h1")).toHaveText("HR");
  await expect(header).toContainText("Japanese · Practice · 3 questions");
  await expect(step).toHaveText("Question 1 / 3");
  await expect(page.getByRole("button", { name: "Start recording" })).toBeVisible();
  await expect(page.getByText("You can record again until the take is transcribed.")).toBeVisible();
  await expect(page.getByText("Each answer's scores appear once it is scored. The round's feedback comes at the end.")).toBeVisible();
  // What was asked does not change, and says which language it is in.
  await expect(question).toHaveText(japaneseQuestion!);
  await expect(question).toHaveAttribute("lang", "ja");
  await expect(round).not.toContainText("録音を開始");
  await page.screenshot({ path: test.info().outputPath("english-chrome-asked.png"), fullPage: true });

  // Back, and on again: it switches both ways.
  await pill.click();
  await expect(page).toHaveTitle("ラウンド — Suburi");
  await expect(round).toHaveAttribute("lang", "ja");
  await expect(step).toHaveText("第1問 / 3問");
  await expect(page.getByRole("button", { name: "録音を開始" })).toBeVisible();
  await pill.click();

  // Recording, and the take held.
  await page.getByRole("button", { name: "Start recording" }).click();
  await expect(page.getByTestId("speaker-line")).toHaveText("Recording");
  await expect(page.getByTestId("waveform").locator("span > span").nth(1)).toBeAttached({ timeout: 5_000 });
  await page.getByRole("button", { name: "Stop recording" }).click();
  await expect(page.getByTestId("take-held")).toHaveText("Take recorded — not transcribed yet");
  await expect(page.getByText("Once it is transcribed, the take is final and cannot be recorded again.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Record again" })).toBeVisible();
  await expect(page.getByText("Recording again replaces this take.")).toBeVisible();

  // A failure is the catalogue's English sentence, and follows the pill after it is shown.
  transcriptionFails = true;
  await page.getByRole("button", { name: "Transcribe this take" }).click();
  const notice = page.getByTestId("take-notice");
  await expect(notice).toHaveText("Transcription failed. The take is kept — retry it, or type your answer instead.");
  await expect(page.getByRole("button", { name: "Type the answer instead" })).toBeVisible();
  await pill.click();
  await expect(notice).toHaveText("文字起こしに失敗しました。録音は残っています。もう一度試すか、回答を入力してください。");
  await expect(page.getByRole("button", { name: "回答を入力する" })).toBeVisible();
  await pill.click();
  transcriptionFails = false;
  await page.getByRole("button", { name: "Try again" }).click();

  // Screen 5: the label, the figures in characters, and the transcript as heard.
  await expect(page.getByTestId("raw-transcript")).toHaveText(HEARD);
  await expect(page.getByTestId("raw-transcript")).toHaveAttribute("lang", "ja");
  await expect(page.getByText("Raw transcript — uncorrected")).toBeVisible();
  await expect(page.getByTestId("take-figures")).toHaveText(/^0:12 · about \d+ chars\/min · \d+ chars$/u);
  await expect(page.getByText("Correct it to what you said, then send. The amount rewritten is recorded but never scored.")).toBeVisible();
  await page.getByRole("button", { name: "Correct the transcript" }).click();

  // Screen 6: labels, the meter's words, the caption, and the editor and RAW in Japanese.
  const editor = page.getByLabel("Your answer — edit freely");
  await expect(editor).toHaveValue(HEARD);
  await expect(editor).toHaveAttribute("lang", "ja");
  await expect(page.getByTestId("raw-kept")).toHaveText(HEARD);
  await expect(page.getByTestId("raw-kept")).toHaveAttribute("lang", "ja");
  await expect(page.getByText("Raw — kept, never replaced")).toBeVisible();
  await expect(page.getByText("of the characters changed from the uncorrected transcript")).toBeVisible();
  const chars = [...HEARD].length;
  await expect(page.getByTestId("word-change")).toHaveText(`${chars} chars → ${chars} chars`);
  await expect(page.getByText("Sending writes one follow-up question from the text you just corrected.")).toBeVisible();
  await expect(round).not.toContainText("文字起こしを直");
  await page.screenshot({ path: test.info().outputPath("english-chrome-correction.png"), fullPage: true });
  await pill.click();
  await expect(page.getByLabel("あなたの回答 — 自由に直せます")).toHaveValue(HEARD);
  await expect(page.getByTestId("word-change")).toHaveText(`${chars}字 → ${chars}字`);
  await pill.click();
  await page.getByRole("button", { name: "Send this answer" }).click();

  // The per-answer frame: the rubric's `label_en`, the figures, `Next`, and the scorer's own words.
  const frame = page.getByTestId("answered-frame");
  await expect(frame).toHaveAttribute("data-scoring", "ok", { timeout: 15_000 });
  await expect(frame.getByTestId("score-row")).toHaveCount(DIMENSIONS.length);
  for (const label of ["Structure", "Evidence", "Relevance", "Fluency", "Accuracy", "Length and pacing", "Keigo (register)"]) {
    await expect(frame.locator(`[data-dimension="${label}"]`)).toHaveCount(1);
  }
  await expect(frame.getByTestId("answer-figures")).toHaveText(/^0 min 12 s · about \d+ chars\/min · rewrite 0%$/u);
  await expect(frame.getByTestId("answered-question")).toHaveAttribute("lang", "ja");
  await expect(frame.getByText("Next", { exact: true })).toBeVisible();
  await expect(page.getByTestId("next-follow-up")).toContainText("└ Follow-up");
  await expect(page.getByTestId("next-follow-up").getByText(FOLLOW_UP)).toHaveAttribute("lang", "ja");
  await expect(page.getByRole("button", { name: "Answer the follow-up" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Answer again" })).toBeVisible();
  await expect(frame).toContainText("A new answer beside this one, scored on its own, with no follow-up. This one stays as it is.");
  await frame.locator('[data-dimension="Structure"]').hover();
  const tooltip = page.getByTestId("score-justification");
  await expect(tooltip).toHaveText(JUSTIFICATION);
  await expect(tooltip).toHaveAttribute("lang", "ja");
  await page.screenshot({ path: test.info().outputPath("english-chrome-answered.png"), fullPage: true });
  await page.mouse.move(0, 0);
  await pill.click();
  await expect(frame.locator('[data-dimension="構成"]')).toHaveCount(1);
  await expect(page.getByRole("button", { name: "深掘りに答える" })).toBeVisible();
  await pill.click();

  // The follow-up names itself in the step.
  await page.getByRole("button", { name: "Answer the follow-up" }).click();
  await expect(question).toHaveText(FOLLOW_UP);
  await expect(step).toHaveText("Question 1 / 3 · follow-up");
  await expect(page.getByRole("button", { name: "Start recording" })).toBeVisible();
});

test("English help saved on /settings is the next practice round's starting state", async ({ page }) => {
  await setting(false);
  await signIn(page);
  await page.goto("/settings");
  const checkbox = page.getByRole("checkbox", {
    name: "Start Japanese practice rounds, and the feedback of every Japanese round, with English shown.",
  });
  await expect(checkbox).not.toBeChecked();
  await checkbox.check();
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();

  const roundId = await startRound(page, "practice");
  // Practice asks seen questions first, so this one may carry the first spec's English: a newer row
  // beside it is what is shown (04 §5).
  const [first] = await askedOf(roundId);
  await storeEnglish(first, "The newest English of this question.");
  await page.goto(`/round/${roundId}`);
  const pill = page.getByTestId("english-help-pill");
  await expect(pill).toHaveAttribute("aria-pressed", "true");
  await expect(pill).toHaveText("日本語");
  await expect(page.getByTestId("prompt-english")).toHaveText("The newest English of this question.");
  // Off for this round only: the setting stays on.
  await pill.click();
  await expect(page.getByTestId("prompt-english")).toHaveCount(0);
  await page.reload();
  await expect(pill).toHaveAttribute("aria-pressed", "true");
});

test("a Japanese realistic round has no pill and no English on screens 3–7, with the setting on", async ({ page }) => {
  test.setTimeout(120_000);
  await setting(true);
  await signIn(page);
  const roundId = await startRound(page, "realistic", "technical");
  const ENGLISH = "REALISTIC-ENGLISH-SENTINEL";
  for (const questionId of await askedOf(roundId)) await storeEnglish(questionId, `${ENGLISH} ${questionId}`);

  const noEnglish = async () => {
    await expect(page.getByTestId("english-help-pill")).toHaveCount(0);
    await expect(page.getByTestId("prompt-english")).toHaveCount(0);
    await expect(page.getByTestId("prompt-english-none")).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText(ENGLISH);
  };

  // Screen 3, asked.
  await page.goto(`/round/${roundId}`);
  await expect(page.getByTestId("round-question")).toBeVisible();
  await noEnglish();

  // Screen 5, the transcript back.
  const answerId = await answerByApi(page, roundId, { submit: false });
  await page.reload();
  await expect(page.getByTestId("raw-transcript")).toHaveText(HEARD);
  await noEnglish();
  expect((await page.request.post(`/api/answers/${answerId}/submit`, { data: { transcript_corrected: HEARD } })).ok()).toBe(true);

  // Screen 7, felt pressure, once every prompt is answered.
  for (let answer = 2; answer <= 6; answer += 1) await answerByApi(page, roundId);
  await page.reload();
  await expect(page.getByRole("radiogroup")).toBeVisible();
  await noEnglish();
});
