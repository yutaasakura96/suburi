import { and, eq, isNotNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { expect, test, type Page } from "@playwright/test";
import * as s from "../db/schema";
import { seedSyntheticCv } from "../db/seed-cv";
import { seedRubrics, seedSetPieces, seedSyntheticQuestions } from "../db/seed-questions";
import { createAuth } from "../lib/auth/auth";
import { mintSessionCookie } from "../lib/auth/test/session";
import { getConfig } from "../lib/config";
import { E2E_URL } from "./database";
import { TTS_MODEL, TTS_VOICE } from "../lib/ai/models";
import { generatedQuestions, silentMp3, startMockOpenAi, type MockOpenAi } from "./mock-openai";
import { startMockS3, type MockS3 } from "./mock-s3";

// The round loop, end to end against the production build: a realistic round from Setup to feedback,
// in English (#42) and in Japanese (#43), each answer with its follow-up (#44). The microphone is
// Chromium's fake device; S3 and OpenAI are the local mocks, so nothing leaves the machine and no
// test calls OpenAI (11 §2).

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

// What the fake generator asks after every answer.
const FOLLOW_UP = "What did you measure to know the failure rate had halved?";
const FOLLOW_UP_JA = "その移行で、障害率はどのように測りましたか。";
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

// The CV check (#46), as the mock's scorer and feedback call answer it. Each returns one thing the
// server can verify and one it cannot: the invented ones must never reach the screen.
const UNSUPPORTED = "cut the failure rate by half";
const INVENTED_QUOTE = "doubled the company's revenue";
const INVENTED_CLAIM = 999;
// An answer given in Japanese to an English round (PRD §7). Synthetic.
const JAPANESE = "決済基盤の移行を担当し、障害率を半分にしました。";
const UNUSED_HEADING = "=== CV claims no answer in this round used ===";

// The model answer (#74), as the mock writes it for every question and follow-up. It quotes one part
// the server can find in its own answer and one it cannot: only the first is ever underlined.
const MODEL_UNSUPPORTED = "a team of four";
const MODEL_ANSWER = {
  answer: `I led the payments migration over six months and cut the failure rate by half. I planned the cutover with ${MODEL_UNSUPPORTED}.`,
  unsupported: [
    { quote: MODEL_UNSUPPORTED, start_hint: 100 },
    { quote: INVENTED_QUOTE, start_hint: 0 },
  ],
};
const MODEL_UNSUPPORTED_JA = "4名のチーム";
const MODEL_ANSWER_JA = {
  answer: `前職では決済基盤の移行を担当し、半年で完了いたしました。${MODEL_UNSUPPORTED_JA}で切り替えを計画いたしました。`,
  unsupported: [{ quote: MODEL_UNSUPPORTED_JA, start_hint: 28 }],
  translated: {
    answer: `At my previous company I led the payments platform migration and completed it in six months. I planned the cutover with ${MODEL_UNSUPPORTED}.`,
    unsupported: [{ quote: MODEL_UNSUPPORTED, start_hint: 118 }],
  },
};

/** The claims a call was shown under `heading`, by the number it was shown them with. */
function claimsShown(body: Record<string, unknown>, heading: string) {
  const block = String(body.input).split(heading)[1]?.split("\n\n")[0] ?? "";
  return new Map([...block.matchAll(/^\[(\d+)\] (.+)$/gm)].map((match) => [Number(match[1]), match[2]]));
}

let s3: MockS3;
let openAi: MockOpenAi;
let feedbackFails = false;
// What the fake transcriber hears next: the mock sees a multipart body, not the round's language.
let heard = HEARD_EN;
// Scoring fails, past its retries, for an answer whose text carries UNSCORABLE — or for every answer.
const UNSCORABLE = "zebra-unscorable-sentinel";
let scoringFails = false;
let followUpFails = false;
let followUpMalformed = false;
let modelAnswerFails = false;

function formatOf(body: Record<string, unknown>) {
  return ((body.text as { format?: { name?: string } } | undefined)?.format?.name ?? "") as string;
}

/** Whether a model call is for a Japanese round: every round-loop input opens with its rubric. */
function japanese(body: Record<string, unknown>) {
  return String(body.input).startsWith("=== rubric ja ");
}

/** Whether a follow-up call is for a Japanese round: its input carries no rubric, its prompt names the 深掘り. */
function japaneseFollowUp(body: Record<string, unknown>) {
  return String(body.instructions).includes("深掘り");
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
        const answeredJapanese = japanese(body) || String(body.input).includes(JAPANESE);
        return {
          scores: dimensions.map((dimension) => ({ dimension, value: SCORES[dimension as keyof typeof SCORES], justification: "e2e" })),
          citations: [
            { claim: 1, relation: "supported_by" },
            { claim: INVENTED_CLAIM, relation: "contradicted_by" },
          ],
          unsupported: answeredJapanese
            ? []
            : [
                { quote: UNSUPPORTED, start_hint: 50 },
                { quote: INVENTED_QUOTE, start_hint: 0 },
              ],
          answered_language: answeredJapanese ? "ja" : "en",
        };
      }
      if (formatOf(body) === "round_feedback") {
        return feedbackFails ? { fail: 500 } : { ...(japanese(body) ? FINDINGS_JA : FINDINGS), untouched: [1, 2, INVENTED_CLAIM] };
      }
      if (formatOf(body) === "follow_up") {
        if (followUpFails) return { fail: 500 };
        if (followUpMalformed) return { follow_up: "What changed? Who approved it?" };
        return { follow_up: japaneseFollowUp(body) ? FOLLOW_UP_JA : FOLLOW_UP };
      }
      if (formatOf(body) === "model_answer") {
        if (modelAnswerFails) return { fail: 500 };
        return String(body.input).includes("=== rubric ja ") ? MODEL_ANSWER_JA : MODEL_ANSWER;
      }
      // Once these specs have answered the seeded questions, a round's are generated (07 §5.4).
      if (formatOf(body) === "generated_questions") return generatedQuestions(body);
      return { fail: 400 };
    },
    { transcription: () => heard, speech: silentMp3 },
  );
});

test.afterAll(async () => {
  await openAi?.close();
  await s3?.close();
});

test.beforeEach(() => {
  feedbackFails = false;
  scoringFails = false;
  followUpFails = false;
  followUpMalformed = false;
  modelAnswerFails = false;
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

/** One answer through the API — slot, PUT, transcribe, submit — to the round's current prompt. */
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
  return (await submitted.json()) as { next: { kind: string } };
}

/** A whole position through the API: the question, then its follow-up — for specs about what comes after. */
async function positionByApi(page: Page, roundId: string, corrected = CORRECTED, followUpCorrected = CORRECTED) {
  const { next } = await answerByApi(page, roundId, corrected);
  expect(next.kind).toBe("follow_up");
  await answerByApi(page, roundId, followUpCorrected);
}

/** Screens 4 to 6 in the browser, for the prompt on screen: record, stop, correct, send. */
async function answerInBrowser(page: Page) {
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

const followUpCalls = () => openAi.requests.filter((request) => formatOf(request.body) === "follow_up");

test("practice asks one follow-up, then moves to the next question", async ({ page }) => {
  await signIn(page);
  const context = await page.request.post("/api/role-contexts", { data: { kind: "general" } });
  expect(context.ok()).toBe(true);
  const created = await page.request.post("/api/rounds", {
    data: { round_type: "hr", language: "en", mode: "practice", length: 3, role_context_id: (await context.json()).id },
  });
  expect(created.status()).toBe(201);
  const roundId = (await created.json()).round.id as string;
  // The mock is shared across this file: count only the calls this round makes.
  const followUpsBefore = followUpCalls().length;

  const first = await answerByApi(page, roundId);
  expect(first.next.kind).toBe("follow_up");
  // A practice round opens on the answer sent last, with the follow-up ready beside it (10 §15).
  await page.goto(`/round/${roundId}`);
  await expect(page.getByTestId("next-follow-up")).toContainText(FOLLOW_UP);
  await page.getByRole("button", { name: "Answer the follow-up" }).click();
  await expect(page.getByTestId("round-step")).toHaveText("Question 1 / 3 · follow-up");
  await expect(page.getByTestId("round-question")).toHaveText(FOLLOW_UP);
  const refusedSpeech = await page.request.get(`/api/rounds/${roundId}/speech?position=1&kind=follow_up`);
  expect(refusedSpeech.status()).toBe(404);
  await page.screenshot({ path: test.info().outputPath("screen4-practice-follow-up.png"), fullPage: true });

  const second = await answerByApi(page, roundId);
  expect(second.next.kind).toBe("question");
  await page.reload();
  await expect(page.getByTestId("round-step")).toHaveText("Question 1 / 3 · follow-up");
  await page.getByRole("button", { name: "Go to the next question" }).click();
  await expect(page.getByTestId("round-step")).toHaveText("Question 2 / 3");
  expect(followUpCalls().slice(followUpsBefore)).toHaveLength(1);
});

test("Japanese practice asks its stored 深掘り at the same position", async ({ page }) => {
  heard = HEARD_JA;
  await signIn(page);
  const context = await page.request.post("/api/role-contexts", { data: { kind: "general" } });
  expect(context.ok()).toBe(true);
  const created = await page.request.post("/api/rounds", {
    data: { round_type: "hr", language: "ja", mode: "practice", length: 3, role_context_id: (await context.json()).id },
  });
  expect(created.status()).toBe(201);
  const roundId = (await created.json()).round.id as string;
  const before = followUpCalls().length;

  const first = await answerByApi(page, roundId, CORRECTED_JA);
  expect(first.next.kind).toBe("follow_up");
  // The per-answer frame, in Japanese (10 §15): the 深掘り is beside the answer, and the same on a reload.
  await page.goto(`/round/${roundId}`);
  await expect(page.getByTestId("round-step")).toHaveText("第1問 / 3問");
  await expect(page.getByText("日本語・練習・3問")).toBeVisible();
  await expect(page.getByTestId("next-follow-up")).toContainText(FOLLOW_UP_JA);
  await expect(page.getByTestId("answered-frame")).toHaveAttribute("data-scoring", "ok", { timeout: 15_000 });
  await expect(page.getByTestId("score-row")).toHaveCount(7);
  await page.screenshot({ path: test.info().outputPath("ja-practice-frame.png"), fullPage: true });
  await page.reload();
  await expect(page.getByTestId("next-follow-up")).toContainText(FOLLOW_UP_JA);
  expect(followUpCalls().slice(before)).toHaveLength(1);
  await page.getByRole("button", { name: "深掘りに答える" }).click();
  await expect(page.getByTestId("round-step")).toHaveText("第1問 / 3問・深掘り");
  await expect(page.getByTestId("round-question")).toHaveText(FOLLOW_UP_JA);
  await expect(page.getByText("回答ごとの採点は、済みしだい出ます。講評はラウンドの最後にまとめて出ます。")).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("ja-practice-follow-up.png"), fullPage: true });

  const second = await answerByApi(page, roundId, CORRECTED_JA);
  expect(second.next.kind).toBe("question");
  await page.reload();
  await page.getByRole("button", { name: "次の質問へ進む" }).click();
  await expect(page.getByTestId("round-step")).toHaveText("第2問 / 3問");
  expect(followUpCalls().slice(before)).toHaveLength(1);
});

test("a realistic English round: Setup → each question and its follow-up → pressure → feedback, all six rows", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page);
  const userId = await seededUserId();
  const speechRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.endsWith("/speech")) speechRequests.push(url.pathname + url.search);
  });
  // The mock is shared across this file: count only the calls this round makes.
  const requestsBefore = openAi.requests.length;
  const followUpsBefore = followUpCalls().length;

  await page.goto("/");
  await page.getByRole("link", { name: "Start a round" }).click();
  await expect(page).toHaveURL("/round/new");
  // v1 seeded here, or a later version cv.spec.ts saved: whichever is current.
  await expect(page.getByTestId("setup-cv")).toContainText(/^CV v\d+/);
  await expect(page.getByTestId("setup-estimate")).toContainText("3 questions + 3 follow-ups · up to about 24 min");
  // A role context is required, and neither card is chosen for the user (10 §2).
  await expect(page.getByRole("button", { name: "Start this round" })).toBeDisabled();
  await page.getByRole("radio", { name: "General practice" }).click();
  await page.getByRole("button", { name: "Start this round" }).click();
  await expect(page).toHaveURL(/\/round\/[0-9a-f-]{36}$/);
  const roundId = page.url().split("/").at(-1)!;
  const questions: string[] = [];

  for (let position = 1; position <= 3; position += 1) {
    await expect(page.getByTestId("round-step")).toHaveText(`Question ${position} / 3`);
    // Realistic asks one unseen set piece first (07 §5.4).
    if (position === 1) await expect(page.getByTestId("round-question")).toHaveText("Could you start by introducing yourself?");
    // …and speaks it (10 §3): the speaker line stands, which a failed or refused playback would replace.
    await expect(page.getByTestId("speaker-line")).toHaveText("Read aloud. The text stays on screen.");
    questions.push((await page.getByTestId("round-question").textContent())!);
    await expect(page.getByText("The feedback comes together when the round ends. Nothing is shown along the way.")).toBeVisible();
    await answerInBrowser(page);

    // The one follow-up, generated from what was just sent, at the same position (07 §5.9).
    await expect(page.getByTestId("round-step")).toHaveText(`Question ${position} / 3 · follow-up`);
    await expect(page.getByTestId("round-question")).toHaveText(FOLLOW_UP);
    // …and spoken too, as its own prompt: it shares its question's position, not its audio.
    await expect(page.getByTestId("speaker-line")).toHaveText("Read aloud. The text stays on screen.");
    if (position === 2) {
      // A reload asks the stored follow-up again; nothing generates it a second time (07 §5.5).
      const generated = followUpCalls().length;
      await page.reload();
      await expect(page.getByTestId("round-step")).toHaveText("Question 2 / 3 · follow-up");
      await expect(page.getByTestId("round-question")).toHaveText(FOLLOW_UP);
      expect(followUpCalls()).toHaveLength(generated);
    }
    await answerInBrowser(page);
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
  // The follow-up is a row under its answer's scores, with no scale of its own (10 §8).
  await expect(page.getByTestId("follow-up-row")).toHaveText(`└ Follow-up${FOLLOW_UP}Scored on 6 dimensions. Not counted in progress.`);
  await expect(page.getByTestId("round-stamp")).toContainText("follow-up-en-1.0");
  // Under the pager (10 §8): what was said beside the model answer stored for it, the question's and
  // then the follow-up's. Only what the server found in the stored answer is underlined.
  await expect(page.getByTestId("answer-texts")).toHaveCount(2);
  await expect(page.getByTestId("own-answer")).toHaveText([CORRECTED, CORRECTED]);
  await expect(page.getByTestId("model-answer")).toHaveText([MODEL_ANSWER.answer, MODEL_ANSWER.answer]);
  await expect(page.getByTestId("model-answer-unsupported")).toHaveText([MODEL_UNSUPPORTED, MODEL_UNSUPPORTED]);
  await expect(page.getByTestId("model-answer-legend").first()).toHaveText(
    /^Written from (CV v\d+) and what you said\. An underline marks what \1 does not back\.$/,
  );
  await expect(page.getByTestId("follow-up-texts")).toContainText("Model answer to the follow-up");
  await expect(page.getByTestId("model-answer-not-written")).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath("screen8-follow-up.png"), fullPage: true });
  // No composite, anywhere on the screen (AGENTS.md invariant 1).
  await expect(page.locator("main")).not.toContainText(/total|average|overall/i);

  // The CV check (10 §8): one flag per answer, quoted from the corrected text by span; one unused
  // claim, quoted from the CV by span. What the mock invented was dropped.
  const feedbackCall = openAi.requests.findLast((request) => formatOf(request.body) === "round_feedback")!;
  const unused = claimsShown(feedbackCall.body, UNUSED_HEADING);
  expect(unused.size).toBeGreaterThan(0);
  const grounding = page.getByTestId("grounding");
  await expect(grounding).toContainText("Checked against your CV");
  await expect(grounding.getByTestId("unsupported")).toHaveText(
    [1, 2, 3].map((position) => new RegExp(`^Unsupported \\(Question ${position}\\) — nothing in CV v\\d+ backs “${UNSUPPORTED}”\\.$`)),
  );
  await expect(grounding.getByTestId("untouched")).toHaveText(`Unused — “${unused.get(1)}” “${unused.get(2)}”`);
  await expect(grounding).not.toContainText(INVENTED_QUOTE);
  // Every answer was in English: no answer carries the wrong-language line.
  await expect(page.getByTestId("wrong-language")).toHaveCount(0);
  const stored = await withDb(async (db) => ({
    attempts: await db.select({ status: s.scoringAttempts.status, prompt: s.scoringAttempts.scoringPromptVersion, language: s.scoringAttempts.answeredLanguage })
      .from(s.scoringAttempts).innerJoin(s.answers, eq(s.answers.id, s.scoringAttempts.answerId))
      .where(eq(s.answers.roundId, roundId)),
    citations: await db.select({ relation: s.claimCitations.relation }).from(s.claimCitations)
      .innerJoin(s.answers, eq(s.answers.id, s.claimCitations.answerId))
      .where(eq(s.answers.roundId, roundId)),
    flags: await db.select({ start: s.answerFlags.spanStart, end: s.answerFlags.spanEnd, corrected: s.answers.transcriptCorrected })
      .from(s.answerFlags).innerJoin(s.answers, eq(s.answers.id, s.answerFlags.answerId))
      .where(eq(s.answers.roundId, roundId)),
    feedback: await db.select({ ids: s.roundFeedback.untouchedClaimIds }).from(s.roundFeedback)
      .where(eq(s.roundFeedback.roundId, roundId)),
    modelAnswers: await db.select({ body: s.modelAnswers.body, spans: s.modelAnswers.unsupportedSpans, translated: s.modelAnswers.bodyTranslated, prompt: s.modelAnswers.promptVersion })
      .from(s.modelAnswers).innerJoin(s.answers, eq(s.answers.id, s.modelAnswers.answerId))
      .where(eq(s.answers.roundId, roundId)),
  }));
  // One model answer per question asked, follow-ups included, each with the one span the server
  // found in its own body (04 `model_answers`).
  const markStart = MODEL_ANSWER.answer.indexOf(MODEL_UNSUPPORTED);
  expect(stored.modelAnswers).toHaveLength(6);
  for (const modelAnswer of stored.modelAnswers) {
    expect(modelAnswer).toEqual({
      body: MODEL_ANSWER.answer,
      spans: [{ start: markStart, end: markStart + MODEL_UNSUPPORTED.length }],
      translated: null,
      prompt: "model-answer-en-1.0",
    });
  }
  // Three questions and three follow-ups: a follow-up's answer goes through the same check. Its flag
  // is stored and sent to the feedback call; the region above names the bank questions' only.
  expect(stored.attempts).toHaveLength(6);
  expect(stored.attempts.every((attempt) => attempt.status === "ok" && attempt.prompt === "score-en-1.1" && attempt.language === "en")).toBe(true);
  expect(stored.citations.map((citation) => citation.relation)).toEqual(Array(6).fill("supported_by"));
  expect(stored.flags).toHaveLength(6);
  for (const flag of stored.flags) expect([...flag.corrected!].slice(flag.start, flag.end).join("")).toBe(UNSUPPORTED);
  expect(stored.feedback[0].ids).toHaveLength(2);
  await page.screenshot({ path: test.info().outputPath("screen8-grounding.png"), fullPage: true });

  await page.getByRole("button", { name: "Question 2" }).click();
  await expect(page.getByTestId("answer-region")).toHaveAttribute("data-position", "2");
  await expect(page.getByTestId("wrong-language")).toHaveCount(0);

  // Six takes under dev/{user}/{round}/ — three questions, three follow-ups — each as the browser recorded it.
  const keys = [...s3.objects.keys()].filter((key) => key.startsWith(`dev/${userId}/${roundId}/`));
  expect(keys).toHaveLength(6);
  for (const key of keys) {
    expect(s3.objects.get(key)!.bytes).toBeGreaterThan(0);
    expect(s3.objects.get(key)!.contentType).toMatch(/^audio\/webm/);
  }
  // Each prompt was spoken as it was asked — the question, then its follow-up, and position 2's
  // follow-up again on the reload — by the pinned model and voice, from the text the server holds for
  // that position and kind: the browser named them and sent no text (07 §5.15).
  const speech = openAi.requests.slice(requestsBefore).filter((request) => request.path === "/v1/audio/speech");
  expect(speech.map((request) => request.body.input)).toEqual(
    questions.flatMap((question, index) => [question, ...Array.from({ length: index === 1 ? 2 : 1 }, () => FOLLOW_UP)]),
  );
  for (const request of speech) expect(request.body).toMatchObject({ model: TTS_MODEL, voice: TTS_VOICE, response_format: "mp3" });
  const speechOf = (position: number, kind: string) => `/api/rounds/${roundId}/speech?position=${position}&kind=${kind}`;
  expect(speechRequests).toEqual(
    [1, 2, 3].flatMap((position) => [
      speechOf(position, "question"),
      ...Array.from({ length: position === 2 ? 2 : 1 }, () => speechOf(position, "follow_up")),
    ]),
  );

  // The scorer read the corrected text, never the raw one (03 §4).
  const scoring = openAi.requests.slice(requestsBefore).filter((request) => formatOf(request.body) === "answer_scores");
  expect(scoring.length).toBeGreaterThanOrEqual(6);
  // So did the follow-up generator: one call per question's answer, none for a follow-up's own.
  const generated = followUpCalls().slice(followUpsBefore);
  expect(generated).toHaveLength(3);
  for (const request of [...scoring, ...generated]) {
    expect(JSON.stringify(request.body)).toContain("payments migration");
    expect(JSON.stringify(request.body)).not.toContain("pay mints");
  }

  // A completed round's page is its feedback.
  await page.goto(`/round/${roundId}`);
  await expect(page).toHaveURL(`/round/${roundId}/feedback`);

  // Coverage on /cv (10 §13): the claim the answers cited carries the heavier mark, and the count
  // line says how many are still unused. The scorer was shown the claims in the order /cv draws them.
  const shown = claimsShown(openAi.requests.findLast((request) => formatOf(request.body) === "answer_scores")!.body, "=== CV claims ===");
  await page.goto("/cv");
  const cv = page.getByRole("region", { name: "CV", exact: true });
  await expect(cv.locator('[data-claim="used"]')).toHaveText([shown.get(1)!]);
  await expect(cv.locator('[data-claim="unused"]')).toHaveCount(shown.size - 1);
  await expect(cv.getByTestId("cv-claim-count")).toHaveText(`${shown.size} claims · ${shown.size - 1} never used`);
  await expect(cv.getByTestId("cv-coverage-legend")).toHaveText("A heavier underline marks a claim one of your answers has used.");
  await page.screenshot({ path: test.info().outputPath("cv-coverage.png"), fullPage: true });
});

test("an answer given in Japanese to an English round says so on its own page of the feedback", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page);
  const roundId = await startRound(page);
  await positionByApi(page, roundId);
  await positionByApi(page, roundId, JAPANESE);
  await positionByApi(page, roundId);
  await scoringSettled(roundId);

  await page.goto(`/round/${roundId}`);
  await page.getByRole("radio", { name: /Fairly tense/ }).click();
  await page.getByRole("button", { name: "Go to the feedback" }).click();
  await expect(page).toHaveURL(`/round/${roundId}/feedback`);

  await expect(page.getByTestId("wrong-language")).toHaveCount(0);
  await page.getByRole("button", { name: "Question 2" }).click();
  await expect(page.getByTestId("wrong-language")).toHaveText("This answer was given in Japanese. It is kept out of your English progress.");
  // It was still scored (PRD §7): the rows are there, and nothing was flagged in it.
  await expect(page.getByTestId("score-value")).toHaveText(["4", "3", "4", "3", "4", "2"]);
  await expect(page.getByTestId("grounding").getByTestId("unsupported")).toHaveCount(2);
  await page.screenshot({ path: test.info().outputPath("screen8-wrong-language.png"), fullPage: true });
  await page.getByRole("button", { name: "Question 3" }).click();
  await expect(page.getByTestId("wrong-language")).toHaveCount(0);

  // Stored on the attempt, for Progress to leave it out (04 `scoring_attempts`).
  const languages = await withDb((db) =>
    db
      .select({ position: s.answers.position, answered: s.scoringAttempts.answeredLanguage })
      .from(s.scoringAttempts)
      .innerJoin(s.answers, eq(s.answers.id, s.scoringAttempts.answerId))
      .where(and(eq(s.answers.roundId, roundId), isNotNull(s.answers.questionId)))
      .orderBy(s.answers.position),
  );
  // The bank questions' answers; each follow-up was answered in English.
  expect(languages.map((row) => row.answered)).toEqual(["en", "ja", "en"]);
});

test("two generated questions are recorded as a missing follow-up", async ({ page }) => {
  await signIn(page);
  const roundId = await startRound(page);
  followUpMalformed = true;
  await page.goto(`/round/${roundId}`);
  await answerInBrowser(page);
  await expect(page.getByTestId("follow-up-notice")).toContainText("could not be generated");
  await page.screenshot({ path: test.info().outputPath("screen6-malformed-follow-up.png"), fullPage: true });
  const rows = await withDb((db) =>
    db
      .select({ status: s.followUps.status, errorClass: s.followUps.errorClass })
      .from(s.followUps)
      .innerJoin(s.answers, eq(s.answers.id, s.followUps.parentAnswerId))
      .where(eq(s.answers.roundId, roundId)),
  );
  expect(rows).toEqual([{ status: "missing", errorClass: "malformed_output" }]);
  await page.getByRole("button", { name: "Go on" }).click();
  await expect(page.getByTestId("round-step")).toHaveText("Question 2 / 3");
});

test("screen 7 cannot be skipped: the feedback URL sends an unrated round back to it", async ({ page }) => {
  await signIn(page);
  const roundId = await startRound(page);
  for (let position = 1; position <= 3; position += 1) await positionByApi(page, roundId);

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
  for (let position = 1; position <= 3; position += 1) await positionByApi(page, roundId);

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

test("model answers not written: the feedback renders, the gap is stated, and the retry writes them", async ({ page }) => {
  await signIn(page);
  const roundId = await startRound(page);
  for (let position = 1; position <= 3; position += 1) await positionByApi(page, roundId);

  modelAnswerFails = true;
  await page.goto(`/round/${roundId}`);
  await page.getByRole("radio", { name: /Fairly tense/ }).click();
  await page.getByRole("button", { name: "Go to the feedback" }).click();

  // The round completes and its feedback is whole: a model answer is never a reason to fail either.
  await expect(page).toHaveURL(`/round/${roundId}/feedback`);
  await expect(page.getByTestId("to-fix")).toContainText("Lead with the result");
  await expect(page.getByTestId("score-row")).toHaveCount(6);
  await expect(page.getByTestId("own-answer")).toHaveText([CORRECTED, CORRECTED]);
  await expect(page.getByTestId("model-answer")).toHaveCount(0);
  const gap = page.getByTestId("model-answer-not-written");
  await expect(gap).toHaveCount(2);
  await expect(gap.first()).toContainText("No model answer is written for this question yet.");
  await page.screenshot({ path: test.info().outputPath("screen8-model-answer-not-written.png"), fullPage: true });

  // Still failing: the catalogue's sentence, and the control stays.
  await gap.first().getByRole("button", { name: "Write the model answers" }).click();
  await expect(gap.first()).toContainText("The model answers could not be written.");

  // One call writes every model answer the round lacks, this question's and the others'.
  modelAnswerFails = false;
  await gap.first().getByRole("button", { name: "Write the model answers" }).click();
  await expect(page.getByTestId("model-answer")).toHaveText([MODEL_ANSWER.answer, MODEL_ANSWER.answer]);
  await expect(gap).toHaveCount(0);
  await page.getByRole("button", { name: "Question 3" }).click();
  await expect(page.getByTestId("model-answer")).toHaveCount(2);
  const written = await withDb((db) =>
    db.select({ id: s.modelAnswers.id }).from(s.modelAnswers).innerJoin(s.answers, eq(s.answers.id, s.modelAnswers.answerId))
      .where(eq(s.answers.roundId, roundId)),
  );
  expect(written).toHaveLength(6);
});

test("a follow-up that could not be generated: the answer is saved, the screen says so, and the round goes on", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page);
  const roundId = await startRound(page);

  followUpFails = true;
  await page.goto(`/round/${roundId}`);
  await answerInBrowser(page);
  // Said, not skipped silently (02 US-7): the answer is locked, and one control goes on.
  await expect(page.getByTestId("follow-up-notice")).toHaveText("The follow-up question could not be generated. Your answer is saved.");
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath("screen6-follow-up-missing.png"), fullPage: true });
  await page.getByRole("button", { name: "Go on" }).click();
  await expect(page.getByTestId("round-step")).toHaveText("Question 2 / 3");

  // The hole is a row, with the class of the failure and no text.
  const rows = await withDb((db) =>
    db
      .select({ status: s.followUps.status, promptText: s.followUps.promptText, errorClass: s.followUps.errorClass })
      .from(s.followUps)
      .innerJoin(s.answers, eq(s.answers.id, s.followUps.parentAnswerId))
      .where(eq(s.answers.roundId, roundId)),
  );
  expect(rows).toEqual([{ status: "missing", promptText: null, errorClass: "upstream_500" }]);

  followUpFails = false;
  await positionByApi(page, roundId);
  await positionByApi(page, roundId);
  await page.reload();
  await page.getByRole("radio", { name: /Fairly tense/ }).click();
  await page.getByRole("button", { name: "Go to the feedback" }).click();
  await expect(page).toHaveURL(`/round/${roundId}/feedback`);

  // Screen 8 shows the gap on the answer it belongs to, and the follow-ups that were asked on theirs.
  await expect(page.getByTestId("answer-region")).toHaveAttribute("data-position", "1");
  await expect(page.getByTestId("score-row")).toHaveCount(6);
  await expect(page.getByTestId("follow-up-missing")).toHaveText("The follow-up was not generated. It is recorded as a gap.");
  await page.screenshot({ path: test.info().outputPath("screen8-follow-up-missing.png"), fullPage: true });
  await page.getByRole("button", { name: "Question 2" }).click();
  await expect(page.getByTestId("follow-up-missing")).toHaveCount(0);
  await expect(page.getByTestId("follow-up-row")).toContainText(FOLLOW_UP);
});

test("a reload between an answer's commit and its follow-up: the saved answer, and going on writes the follow-up", async ({ page }) => {
  await signIn(page);
  const roundId = await startRound(page);
  await answerByApi(page, roundId);
  // A submit that died after committing the answer and before storing its follow-up leaves no row.
  // Nothing in the app removes one; this is the throwaway database standing in for that crash.
  await withDb(async (db) => {
    const [parent] = await db.select({ id: s.answers.id }).from(s.answers).where(eq(s.answers.roundId, roundId));
    await db.delete(s.followUps).where(eq(s.followUps.parentAnswerId, parent.id));
  });

  await page.goto(`/round/${roundId}`);
  await expect(page.getByTestId("round-step")).toHaveText("Question 1 / 3");
  await expect(page.getByTestId("follow-up-notice")).toHaveText(
    "Your answer is saved. Its follow-up question had not been written when this page loaded.",
  );
  // The answer is committed: no recorder and no editor, only the way on.
  await expect(page.getByRole("button", { name: "Start recording" })).toHaveCount(0);
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath("screen6-follow-up-not-stored.png"), fullPage: true });

  await page.getByRole("button", { name: "Go on" }).click();
  await expect(page.getByTestId("round-step")).toHaveText("Question 1 / 3 · follow-up");
  await expect(page.getByTestId("round-question")).toHaveText(FOLLOW_UP);
  await page.screenshot({ path: test.info().outputPath("screen4-follow-up.png"), fullPage: true });
  const rows = await withDb((db) =>
    db
      .select({ status: s.followUps.status })
      .from(s.followUps)
      .innerJoin(s.answers, eq(s.answers.id, s.followUps.parentAnswerId))
      .where(eq(s.answers.roundId, roundId)),
  );
  expect(rows).toEqual([{ status: "generated" }]);
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
          return rows.length >= 6 && rows.every((row) => row.status !== "pending");
        }),
      { timeout: 60_000, intervals: [1_000] },
    )
    .toBe(true);
}

test("an answer whose scoring failed never reaches the feedback generator", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page);
  const roundId = await startRound(page);
  await positionByApi(page, roundId);
  await positionByApi(page, roundId, `I could not be scored ${UNSCORABLE}.`);
  await positionByApi(page, roundId);
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
  // Its follow-up's answer was scored on its own, and is sent under the same number.
  expect(sent).toContain("=== answer 2, follow-up ===");
  await page.screenshot({ path: test.info().outputPath("screen8-one-failed.png"), fullPage: true });
});

test("no answer scored: screen 8 says so, offers no retry, and the API refuses as no_scores", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page);
  const roundId = await startRound(page);
  scoringFails = true;
  for (let position = 1; position <= 3; position += 1) await positionByApi(page, roundId);
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
  const requestsBefore = openAi.requests.length;
  const shot = (name: string) => page.screenshot({ path: test.info().outputPath(`ja-${name}.png`), fullPage: true });

  // Setup is app-level and English (10 §0); the stored label keeps its own language.
  await page.goto("/round/new");
  await page.getByRole("radio", { name: "Japanese" }).click();
  await expect(page.getByTestId("setup-cv")).toContainText(/^応募書類 v\d+/);
  await expect(page.getByTestId("setup-estimate")).toContainText("Rubric v1.0");
  await page.getByRole("radio", { name: "General practice" }).click();
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
    await expect(page.getByRole("heading", { name: "人事面接" })).toBeVisible();
    await expect(page.getByText("日本語・実戦・3問")).toBeVisible();
    if (position === 1) await expect(page.getByTestId("round-question")).toHaveText("まず、簡単に自己紹介をお願いします。");
    // The question is spoken, and the speaker line is in the round's language (10 §3).
    await expect(page.getByTestId("speaker-line")).toHaveText("読み上げました。文字は残します。");
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
    await expect(page.getByText("送ると、いま直した文から深掘りが1問つくられます。")).toBeVisible();
    await expect(main).not.toContainText(ENGLISH_CHROME);
    if (position === 1) await shot("6-correction");
    await page.getByRole("button", { name: "この回答を送る" }).click();

    // The 深掘り, asked on the same frame at the same position, in Japanese (10 §3, 07 §5.9).
    await expect(page.getByTestId("round-step")).toHaveText(`第${position}問 / 3問・深掘り`);
    await expect(page.getByTestId("round-question")).toHaveText(FOLLOW_UP_JA);
    await expect(page.getByTestId("speaker-line")).toHaveText("読み上げました。文字は残します。");
    await expect(page.getByTestId("round-stamp")).toContainText("follow-up-ja-1.0・応募書類 v");
    await expect(main).not.toContainText(ENGLISH_CHROME);
    if (position === 1) await shot("3-follow-up");
    await page.getByRole("button", { name: "録音を開始" }).click();
    await expect(page.getByTestId("record-timer")).toHaveText("0:01", { timeout: 5_000 });
    await page.getByRole("button", { name: "停止して文字起こし" }).click();
    await page.getByRole("button", { name: "文字起こしを直す" }).click();
    // A follow-up's own answer makes no follow-up, and the caption does not promise one (10 §6).
    await expect(page.getByText("送ると、先へ進む間にこの回答を採点します。結果はラウンドが終わるまで出ません。")).toBeVisible();
    await page.getByRole("textbox").fill(CORRECTED_JA);
    await page.getByRole("button", { name: "この回答を送る" }).click();
  }

  // Screen 7.
  await expect(page.getByText("いまのラウンド、どのくらい緊張しましたか。")).toBeVisible();
  await expect(page.getByText("講評の前に", { exact: true })).toBeVisible();
  const toFeedback = page.getByRole("button", { name: "講評に進む" });
  await expect(toFeedback).toBeDisabled();
  await expect(page.getByText("1つ選ぶと講評に進めます。")).toBeVisible();
  await page.getByRole("radio", { name: /かなり緊張した/ }).click();
  await expect(page.getByText("緊張度4をこのラウンドに記録します。")).toBeVisible();
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
  // The follow-up is a row under its answer's scores, with no scale of its own (10 §8).
  await expect(page.getByTestId("follow-up-row")).toHaveText(`└ 深掘り${FOLLOW_UP_JA}7項目を採点。進捗には入れません。`);
  await expect(page.getByTestId("to-fix")).toContainText("直すところ 2件");
  await expect(page.getByTestId("to-fix")).toContainText("結論を最初の一文に置く");
  await expect(page.getByTestId("what-worked")).toContainText("良かったところ 1件");
  await expect(page.getByTestId("what-worked")).toContainText("第3問で、具体的な場面を挙げて説明できている。");
  await expect(page.getByTestId("pressure-stamp")).toHaveText("緊張度4を講評前に記録");
  await expect(page.getByTestId("round-stamp")).toContainText(/^評価基準 v1\.0・.*・応募書類 v\d+/);
  // The model answer under the pager is Japanese, with its legend naming 応募書類 (10 §8).
  await expect(page.getByTestId("answer-texts").first()).toContainText("あなたの回答");
  await expect(page.getByTestId("model-answer")).toHaveText([MODEL_ANSWER_JA.answer, MODEL_ANSWER_JA.answer]);
  await expect(page.getByTestId("model-answer-unsupported")).toHaveText([MODEL_UNSUPPORTED_JA, MODEL_UNSUPPORTED_JA]);
  await expect(page.getByTestId("model-answer-legend").first()).toHaveText(
    /^(応募書類 v\d+)とあなたの回答をもとに作成しています。下線は、\1に裏づけのない内容です。$/,
  );
  await expect(page.getByTestId("follow-up-texts")).toContainText("深掘りへの模範回答");
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
  // The model answer is read from the translation stored with it; what was said is never translated.
  await expect(page.getByTestId("model-answer")).toHaveText([MODEL_ANSWER_JA.translated.answer, MODEL_ANSWER_JA.translated.answer]);
  await expect(page.getByTestId("model-answer").first()).toHaveAttribute("lang", "en");
  await expect(page.getByTestId("model-answer-unsupported")).toHaveText([MODEL_UNSUPPORTED, MODEL_UNSUPPORTED]);
  await expect(page.getByTestId("own-answer").first()).toHaveText(CORRECTED_JA);
  await expect(page.getByTestId("answer-texts").first()).toContainText("模範回答");
  await expect(page.getByText("日本語・実戦・3問")).toBeVisible();
  await expect(page.getByTestId("answer-region")).toContainText("第1問 / 3問");
  await expect(page.getByTestId("pressure-stamp")).toHaveText("緊張度4を講評前に記録");
  await shot("8-feedback-english");
  await pill.click();
  await expect(pill).toHaveText("English");
  await expect(page.getByTestId("to-fix")).toContainText("結論を最初の一文に置く");
  await expect(page.getByTestId("model-answer").first()).toHaveText(MODEL_ANSWER_JA.answer);
  await page.getByRole("button", { name: "第2問" }).click();
  await expect(page.getByTestId("answer-region")).toHaveAttribute("data-position", "2");

  // The translation is stored with the feedback, once (04 `body_translated`).
  const [stored] = await withDb((db) => db.select().from(s.roundFeedback).where(eq(s.roundFeedback.roundId, roundId)));
  expect(stored.language).toBe("ja");
  expect(stored.bodyTranslated).toEqual({ language: "en", ...FINDINGS_JA.translated });
  expect(stored.promptVersion).toBe("feedback-ja-1.1");
  // So is each model answer's, with its own span into the English text (04 `model_answers`).
  const modelAnswers = await withDb((db) =>
    db.select({ translated: s.modelAnswers.bodyTranslated, prompt: s.modelAnswers.promptVersion })
      .from(s.modelAnswers).innerJoin(s.answers, eq(s.answers.id, s.modelAnswers.answerId))
      .where(eq(s.answers.roundId, roundId)),
  );
  const translatedStart = MODEL_ANSWER_JA.translated.answer.indexOf(MODEL_UNSUPPORTED);
  expect(modelAnswers).toHaveLength(6);
  expect(modelAnswers[0]).toEqual({
    translated: {
      language: "en",
      body: MODEL_ANSWER_JA.translated.answer,
      unsupported_spans: [{ start: translatedStart, end: translatedStart + MODEL_UNSUPPORTED.length }],
    },
    prompt: "model-answer-ja-1.0",
  });

  // The scorer read the Japanese rubric and the corrected text, never the raw one (03 §4).
  const scoring = openAi.requests.slice(requestsBefore).filter((request) => formatOf(request.body) === "answer_scores");
  expect(scoring.length).toBeGreaterThanOrEqual(6);
  for (const request of scoring) {
    const sent = JSON.stringify(request.body);
    expect(sent).toContain("- keigo (敬語): ");
    expect(sent).toContain("pace: 250 characters per minute");
    expect(sent).toContain("決済基盤");
    expect(sent).not.toContain("決済期版");
  }
  // The pace is stored in characters per minute of the raw transcript (04 `answers`).
  // Three questions and their three 深掘り, each follow-up asked in Japanese and stamped (04 `follow_ups`).
  const answers = await withDb((db) => db.select().from(s.answers).where(eq(s.answers.roundId, roundId)));
  expect(answers).toHaveLength(6);
  for (const answer of answers) expect(answer.wordsPerMinute).toBe(250);
  const followUps = await withDb((db) =>
    db
      .select({ status: s.followUps.status, promptText: s.followUps.promptText, promptVersion: s.followUps.promptVersion })
      .from(s.followUps)
      .innerJoin(s.answers, eq(s.answers.id, s.followUps.parentAnswerId))
      .where(eq(s.answers.roundId, roundId)),
  );
  expect(followUps).toHaveLength(3);
  for (const followUp of followUps) expect(followUp).toEqual({ status: "generated", promptText: FOLLOW_UP_JA, promptVersion: "follow-up-ja-1.0" });
  const spoken = openAi.requests.slice(requestsBefore).filter((request) => request.path === "/v1/audio/speech");
  expect(spoken).toHaveLength(6);
  expect(spoken.filter((_, index) => index % 2 === 1).map((request) => request.body.input)).toEqual([FOLLOW_UP_JA, FOLLOW_UP_JA, FOLLOW_UP_JA]);

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
  for (let position = 1; position <= 3; position += 1) await positionByApi(page, roundId, CORRECTED_JA, CORRECTED_JA);

  feedbackFails = true;
  await page.goto(`/round/${roundId}`);
  await page.getByRole("radio", { name: /それなりに緊張した/ }).click();
  await page.getByRole("button", { name: "講評に進む" }).click();

  await expect(page).toHaveURL(`/round/${roundId}/feedback`);
  await expect(page.getByTestId("findings-not-ready")).toContainText("このラウンドの講評はまだできていません。");
  await expect(page.getByTestId("score-row")).toHaveCount(7);
  await expect(page.getByTestId("pressure-stamp")).toHaveText("緊張度3を講評前に記録");
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
