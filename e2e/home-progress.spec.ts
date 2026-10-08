import { and, eq, isNotNull, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { expect, test, type Locator, type Page } from "@playwright/test";
import * as s from "../db/schema";
import { seedSyntheticCv } from "../db/seed-cv";
import { seedRubrics, seedSetPieces, seedSyntheticQuestions } from "../db/seed-questions";
import { SYNTHETIC_PROGRESS_ROUNDS, seedSyntheticRounds, syntheticId } from "../db/seed-rounds";
import { createAuth } from "../lib/auth/auth";
import { mintSessionCookie } from "../lib/auth/test/session";
import { getConfig } from "../lib/config";
import { E2E_URL } from "./database";

// Home, Setup's defaults and Progress (#51), end to end against the production build: first with no
// round ever started, then over the synthetic rounds `develop` is seeded with (12 §1). No model and
// no bucket is called — every screen here reads stored rows (07 §1).

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

let userId: string;
const id = (name: string) => syntheticId(userId, name);

// history.spec.ts runs before this and leaves no round behind; practice.spec.ts runs after and counts
// on the same. A throwaway database, emptied by hand: nothing in the app deletes.
async function emptyRounds() {
  await withDb(async (db) => {
    await db.delete(s.scores);
    await db.delete(s.answerFlags);
    await db.delete(s.claimCitations);
    await db.delete(s.scoringAttempts);
    await db.delete(s.followUps);
    await db.delete(s.roundFeedback);
    await db.delete(s.answers).where(or(isNotNull(s.answers.retryOfAnswerId), isNotNull(s.answers.parentAnswerId)));
    await db.delete(s.answers);
    await db.delete(s.roundQuestions);
    await db.delete(s.rounds);
  });
}

test.beforeAll(async () => {
  userId = await seededUserId();
  await withDb(async (db) => {
    await db.transaction((tx) => seedSyntheticCv(tx, userId, "en"));
    await db.transaction((tx) => seedSyntheticCv(tx, userId, "ja"));
    await seedRubrics(db);
    await seedSetPieces(db, userId);
    await seedSyntheticQuestions(db, userId);
  });
  await emptyRounds();
});

const POSTING_COMPANY = "Invented Haulage e2e";

// setup.spec.ts starts with no posting saved, as a first visit does: the one made here goes with its round.
test.afterAll(async () => {
  await emptyRounds();
  await withDb((db) => db.delete(s.roleContexts).where(and(eq(s.roleContexts.userId, userId), eq(s.roleContexts.companyName, POSTING_COMPANY))));
});

const JAPANESE = /[぀-ヿ一-鿿]/u;

const dueRows = (page: Page) => page.getByTestId("due-row");
const count = (page: Page, language: "ja" | "en") => page.locator(`[data-testid="first-attempt-count"][data-language="${language}"]`);
const panel = (page: Page, language: "ja" | "en") => page.locator(`[data-testid="progress-panel"][data-language="${language}"]`);
const plotRows = (panel: Locator) => panel.getByTestId("progress-row");
const checked = (page: Page, name: string | RegExp) => page.getByRole("radio", { name, exact: typeof name === "string", checked: true });

/** A phrase that would name a figure combining dimensions, languages or round types (refusal #1). */
const COMPOSITE = /\b(overall|average|total|mean|composite)\b/i;

test("/progress without a session lands on /sign-in", async ({ page }) => {
  await page.goto("/progress");
  await expect(page).toHaveURL("/sign-in");
});

test("with no round ever started, Home lists the four round types as never practised and counts nothing", async ({ page }) => {
  await signIn(page);
  await page.goto("/");

  await expect(page.getByTestId("due-caption")).toHaveText("Suggestion only — start anything");
  await expect(page.getByTestId("due-list")).toHaveAttribute("data-empty", "true");
  await expect(dueRows(page)).toHaveText(["BehaviouralNever", "TechnicalNever", "HRNever", "CEO / finalNever"]);
  await expect(page.getByTestId("due-bar")).toHaveCount(0);
  await expect(count(page, "ja")).toContainText("0 / 30");
  await expect(count(page, "en")).toContainText("0 / 30");
  await expect(page.getByTestId("home-defaults")).toHaveText("Defaults to Behavioural · Japanese · realistic · 5. All four overridable.");

  // English app chrome (10 §0): the wordmark is the one thing on Home written in Japanese.
  const text = (await page.getByRole("region", { name: "Home" }).innerText()).replace("素振り", "");
  expect(text).not.toMatch(JAPANESE);
  expect(text).not.toMatch(COMPOSITE);
  await page.screenshot({ path: test.info().outputPath("home-empty.png"), fullPage: true });
});

test("with no round ever started, Setup opens on the starting defaults and says nothing is due", async ({ page }) => {
  await signIn(page);
  await page.goto("/");
  await page.getByRole("link", { name: "Start a round" }).click();
  await expect(page).toHaveURL("/round/new");

  for (const name of ["Behavioural", "Japanese", "5 questions", "Realistic"]) await expect(checked(page, name)).toBeVisible();
  await expect(page.getByTestId("setup-why")).toContainText(
    "No realistic round has been completed yet, so nothing is due. These are the starting defaults.",
  );
  await expect(page.getByTestId("setup-estimate")).toContainText("5 questions + 5 follow-ups · up to about 40 min");
});

test("with no first attempt, Progress shows the rows it will plot in both languages and the count needed", async ({ page }) => {
  await signIn(page);
  await page.goto("/progress");
  await expect(page).toHaveTitle("Progress — Suburi");

  await expect(page.getByTestId("progress-count")).toHaveText(["Japanese 0 / 30", "English 0 / 30"]);
  for (const language of ["ja", "en"] as const) {
    await expect(panel(page, language).getByTestId("panel-status")).toHaveText("No first attempts yet — 5 for a trend line");
    await expect(plotRows(panel(page, language))).toHaveCount(7);
  }
  await expect(page.getByTestId("plot-dot")).toHaveCount(0);
  await expect(page.getByTestId("plot-trend")).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath("progress-empty.png"), fullPage: true });
});

test.describe("over the seeded rounds", () => {
  test.beforeAll(async () => {
    await withDb(async (db) => {
      expect(await db.transaction((tx) => seedSyntheticRounds(tx, userId))).toBe(4);
      expect(await db.transaction((tx) => seedSyntheticRounds(tx, userId, SYNTHETIC_PROGRESS_ROUNDS))).toBe(3);
      // One round pitched at a role, so the two context groups each hold something (US-2).
      const [posting] = await db
        .insert(s.roleContexts)
        .values({ userId, kind: "posting", companyName: POSTING_COMPANY, roleTitle: "Backend Engineer", body: "An invented posting." })
        .returning({ id: s.roleContexts.id });
      await db.update(s.rounds).set({ roleContextId: posting.id }).where(eq(s.rounds.id, id("progress-hr-en-1")));
    });
  });

  test("Home lists what is due: never practised first and without a bar, then the most overdue first", async ({ page }) => {
    await signIn(page);
    await page.goto("/");

    await expect(page.getByTestId("due-list")).not.toHaveAttribute("data-empty");
    // The abandoned round was Behavioural in English: an abandoned round is not a sitting (PRD §7).
    const pairs = await dueRows(page).evaluateAll((rows) => rows.map((row) => [...row.children].slice(1, 3).map((cell) => cell.textContent).join(" · ")));
    expect(pairs).toEqual([
      "Behavioural · English",
      "Technical · Japanese",
      "CEO / final · Japanese",
      "CEO / final · English",
      "Technical · English",
      "Behavioural · Japanese",
      "HR · Japanese",
      "HR · English",
    ]);

    const urgency = await dueRows(page).evaluateAll((rows) => rows.map((row) => row.getAttribute("data-urgency")));
    expect(urgency.slice(0, 3)).toEqual(["never", "never", "never"]);
    expect(urgency[3]).toBe("most");
    expect(urgency.slice(3)).not.toContain("never");
    for (let row = 0; row < 3; row += 1) {
      await expect(dueRows(page).nth(row).getByTestId("due-interval")).toHaveText("Never");
      await expect(dueRows(page).nth(row).getByTestId("due-bar")).toHaveCount(0);
    }

    // The intervals grow with the clock; their order and the longest one's full bar do not.
    const days = (await dueRows(page).getByTestId("due-interval").allTextContents()).slice(3).map((text) => Number(/^(\d+)d$/u.exec(text)?.[1]));
    expect(days.every((interval) => Number.isInteger(interval))).toBe(true);
    expect(days).toEqual([...days].sort((a, b) => b - a));
    const widths = await page.getByTestId("due-bar").evaluateAll((bars) => bars.map((bar) => bar.getBoundingClientRect().width));
    expect(widths).toHaveLength(5);
    expect(widths).toEqual([...widths].sort((a, b) => b - a));
    const track = await dueRows(page).nth(3).getByTestId("due-bar").evaluate((bar) => bar.parentElement!.getBoundingClientRect().width);
    expect(widths[0]).toBeCloseTo(track, 0);

    // First attempts Progress plots: not the pending, the failed or the abandoned round's (11 §3.5).
    await expect(count(page, "ja")).toContainText("11 / 30");
    await expect(count(page, "en")).toContainText("7 / 30");
    await expect(page.getByTestId("home-defaults")).toHaveText("Defaults to Behavioural · English · realistic · 5. All four overridable.");
    await page.screenshot({ path: test.info().outputPath("home.png"), fullPage: true });
  });

  test("Setup's defaults come from the top of the Due list, say why, and every one can be changed", async ({ page }) => {
    await signIn(page);
    await page.goto("/round/new");

    for (const name of ["Behavioural", "English", "5 questions", "Realistic"]) await expect(checked(page, name)).toBeVisible();
    await expect(page.getByTestId("setup-why")).toHaveText(
      "Why these defaults" +
        "Behavioural in English has not been practised in a realistic round yet. The defaults come from that." +
        "A suggestion. All four can be changed.",
    );
    expect(await page.getByTestId("setup-why").innerText()).not.toMatch(JAPANESE);

    for (const name of ["CEO / final", "Japanese", "7 questions", "Practice"]) {
      await page.getByRole("radio", { name, exact: true }).click();
      await expect(checked(page, name)).toBeVisible();
    }
    // The reason is where the defaults came from, so overriding them does not rewrite it.
    await expect(page.getByTestId("setup-why")).toContainText("Behavioural in English has not been practised");
    await page.screenshot({ path: test.info().outputPath("setup.png"), fullPage: true });
  });

  test("Progress plots one row per dimension and language, with no trend line under five and a boundary at a stamp change", async ({ page }) => {
    await signIn(page);
    await page.goto("/");
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Progress" }).click();
    await expect(page).toHaveURL("/progress");
    await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Progress" })).toHaveAttribute("aria-current", "page");

    await page.getByRole("navigation", { name: "Round type" }).getByRole("link", { name: "HR" }).click();
    await page.getByRole("navigation", { name: "Role context" }).getByRole("link", { name: "General practice" }).click();
    await expect(page).toHaveURL("/progress?type=hr&context=general");
    await expect(page.getByTestId("progress-count")).toHaveText(["Japanese 11 / 30", "English 7 / 30"]);

    // Japanese: five under one scoring prompt, then three under the next.
    const ja = panel(page, "ja");
    await expect(ja.getByTestId("panel-status")).toHaveText("8 first attempts · 3 since the change — 2 more for a trend line");
    await expect(ja.getByTestId("boundary-label")).toHaveText(["synthetic-score-ja-1.1"]);
    await expect(plotRows(ja)).toHaveCount(7);
    await expect(plotRows(ja).locator("> span:first-child")).toHaveText(["構成", "根拠", "関連性", "流暢さ", "正確さ", "長さ・配分", "敬語"]);
    for (let row = 0; row < 7; row += 1) {
      await expect(plotRows(ja).nth(row).getByTestId("plot-dot")).toHaveCount(8);
      await expect(plotRows(ja).nth(row).getByTestId("plot-boundary")).toHaveCount(1);
      // One trend line, and it stops short of the boundary (11 §3.6).
      await expect(plotRows(ja).nth(row).getByTestId("plot-trend")).toHaveCount(1);
    }
    const [trendEnd, boundary] = await plotRows(ja)
      .first()
      .evaluate((row) => [
        Number(row.querySelector('[data-testid="plot-trend"]')!.getAttribute("x2")),
        Number(row.querySelector('[data-testid="plot-boundary"]')!.getAttribute("x1")),
      ]);
    expect(trendEnd).toBeLessThan(boundary);
    // The numeral column is the newest first attempt's score, dimension by dimension.
    await expect(ja.getByTestId("row-latest")).toHaveText(["4", "4", "4", "4", "5", "4", "4"]);

    // English general practice holds no HR round: the one there is was pitched at a role.
    const en = panel(page, "en");
    await expect(en.getByTestId("panel-status")).toHaveText("No first attempts yet — 5 for a trend line");
    await expect(en.getByTestId("plot-dot")).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath("progress-hr-general.png"), fullPage: true });

    // US-2: rounds pitched at a role are grouped apart from General practice.
    await page.getByRole("navigation", { name: "Role context" }).getByRole("link", { name: "Pitched at a role" }).click();
    await expect(page).toHaveURL("/progress?type=hr&context=role");
    await expect(en.getByTestId("panel-status")).toHaveText("3 first attempts — 2 more for a trend line");
    await expect(en.getByTestId("plot-trend")).toHaveCount(0);
    await expect(en.getByTestId("plot-boundary")).toHaveCount(0);
    await expect(plotRows(en)).toHaveCount(7);
    for (let row = 0; row < 6; row += 1) await expect(plotRows(en).nth(row).getByTestId("plot-dot")).toHaveCount(3);
    await expect(en.getByTestId("row-latest")).toHaveText(["4", "4", "4", "3", "5", "3"]);
    // Keigo is kept in English as a row that says it is not scored (10 §9): the absence is data.
    const keigo = plotRows(en).nth(6);
    await expect(keigo).toHaveAttribute("data-dimension", "keigo");
    await expect(keigo).toHaveText("Keigo (register)Not scored in English—");
    await expect(keigo.getByTestId("dot-plot")).toHaveCount(0);
    await expect(ja.getByTestId("panel-status")).toHaveText("No first attempts yet — 5 for a trend line");
    // The counts are each language's, whatever is on screen.
    await expect(page.getByTestId("progress-count")).toHaveText(["Japanese 11 / 30", "English 7 / 30"]);
    await page.screenshot({ path: test.info().outputPath("progress-hr-role.png"), fullPage: true });

    // English chrome (10 §0): outside the Japanese panel's own data and the wordmark, nothing is Japanese.
    const footer = await page.getByTestId("progress-footer").innerText();
    for (const excluded of ["Practice rounds", "retries", "follow-ups", "typed answers", "wrong language", "abandoned rounds", "pending or failed"]) {
      expect(footer).toContain(excluded);
    }
    expect(await en.innerText()).not.toMatch(JAPANESE);
    expect(footer).not.toMatch(JAPANESE);
    expect(await page.getByRole("region", { name: "Progress" }).innerText()).not.toMatch(COMPOSITE);
  });

  test("Progress leaves out follow-ups, the pending and the failed score, and the abandoned round", async ({ page }) => {
    await signIn(page);

    // The completed Japanese round: three questions and two scored follow-ups. Three dots, not five.
    await page.goto("/progress?type=behavioural&context=general");
    await expect(page.getByRole("navigation", { name: "Round type" }).getByRole("link", { name: "Behavioural" })).toHaveAttribute("aria-current", "true");
    await expect(panel(page, "ja").getByTestId("panel-status")).toHaveText("3 first attempts — 2 more for a trend line");
    await expect(plotRows(panel(page, "ja")).first().getByTestId("plot-dot")).toHaveCount(3);
    // The abandoned round was Behavioural in English, and had a scored answer.
    await expect(panel(page, "en").getByTestId("panel-status")).toHaveText("No first attempts yet — 5 for a trend line");

    // A pending score is no measurement, not a zero (11 §3.5): two dots of the round's three.
    await page.getByRole("navigation", { name: "Round type" }).getByRole("link", { name: "Technical" }).click();
    await expect(page).toHaveURL("/progress?type=technical&context=general");
    await expect(panel(page, "en").getByTestId("panel-status")).toHaveText("2 first attempts — 3 more for a trend line");
    await expect(plotRows(panel(page, "en")).first().getByTestId("plot-dot")).toHaveCount(2);

    // And so is a failed one.
    await page.getByRole("navigation", { name: "Round type" }).getByRole("link", { name: "CEO / final" }).click();
    await expect(page).toHaveURL("/progress?type=ceo&context=general");
    await expect(panel(page, "en").getByTestId("panel-status")).toHaveText("2 first attempts — 3 more for a trend line");
    await expect(plotRows(panel(page, "en")).first().getByTestId("plot-dot")).toHaveCount(2);
  });

  test("a dot's date and question are read by the keyboard as well as by hovering", async ({ page }) => {
    await signIn(page);
    await page.goto("/progress?type=hr&context=general");
    const row = plotRows(panel(page, "ja")).first().getByTestId("dot-plot");
    const tooltip = page.getByTestId("plot-tooltip");
    await expect(tooltip).toHaveCount(0);

    // Reached with Tab alone (05 §7): the row is the stop, and focus opens the newest dot.
    for (let presses = 0; presses < 40; presses += 1) {
      if (await row.evaluate((element) => element === document.activeElement)) break;
      await page.keyboard.press("Tab");
    }
    await expect(row).toBeFocused();
    await expect(tooltip).toHaveText("2026-09-20 · 構成 4 · Q3");
    await page.keyboard.press("ArrowLeft");
    await expect(tooltip).toHaveText("2026-09-20 · 構成 4 · Q2");
    await page.keyboard.press("Home");
    await expect(tooltip).toHaveText("2026-08-25 · 構成 2 · Q1");
    await page.keyboard.press("End");
    await expect(tooltip).toHaveText("2026-09-20 · 構成 4 · Q3");
    await expect(row.locator("[data-active]")).toHaveCount(1);
    await page.screenshot({ path: test.info().outputPath("progress-keyboard-tooltip.png"), fullPage: true });
    await page.keyboard.press("Escape");
    await expect(tooltip).toHaveCount(0);

    await row.blur();
    await row.locator("circle[fill='transparent']").first().hover();
    await expect(tooltip).toHaveText("2026-08-25 · 構成 2 · Q1");
  });

  test("a score row's justification opens on keyboard focus, and on hover", async ({ page }) => {
    await signIn(page);
    await page.goto(`/round/${id("complete-ja")}/feedback`);
    const rows = page.getByTestId("score-row");
    const justification = page.locator('[data-testid="score-justification"][data-open]');
    await expect(rows).toHaveCount(7);
    await expect(justification).toHaveCount(0);

    // Reached with Tab alone (05 §7), not by a pointer.
    for (let presses = 0; presses < 40; presses += 1) {
      if (await rows.first().evaluate((element) => element === document.activeElement)) break;
      await page.keyboard.press("Tab");
    }
    await expect(rows.first()).toBeFocused();
    await expect(justification).toHaveText("Synthetic fixture: the seed set structure to 4. No scorer read this answer.");
    // The same words are the row's description, for a reader that cannot see the tooltip.
    await expect(rows.first()).toHaveAccessibleDescription("Synthetic fixture: the seed set structure to 4. No scorer read this answer.");
    await page.screenshot({ path: test.info().outputPath("score-row-justification.png"), fullPage: true });

    await page.keyboard.press("Tab");
    await expect(rows.nth(1)).toBeFocused();
    await expect(justification).toHaveText("Synthetic fixture: the seed set evidence to 3. No scorer read this answer.");
    await page.keyboard.press("Escape");
    await expect(justification).toHaveCount(0);

    await rows.nth(1).blur();
    await rows.nth(5).hover();
    await expect(justification).toHaveText("Synthetic fixture: the seed set length_pacing to 2. No scorer read this answer.");
  });

  test("the app header reaches Home, Progress, History and the CV from each other", async ({ page }) => {
    await signIn(page);
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Main" });
    const current = () => nav.locator('[aria-current="page"]');

    await expect(current()).toHaveText("Home");
    await nav.getByRole("link", { name: "History" }).click();
    await expect(page).toHaveURL(/\/history\/[0-9a-f-]{36}$/);
    await expect(current()).toHaveText("History");
    await nav.getByRole("link", { name: "CV" }).click();
    await expect(page).toHaveURL("/cv");
    await expect(current()).toHaveText("CV");
    await nav.getByRole("link", { name: "Progress" }).click();
    await expect(page).toHaveURL("/progress");
    await expect(current()).toHaveText("Progress");
    await nav.getByRole("link", { name: "Home" }).click();
    await expect(page).toHaveURL("/");
    await expect(current()).toHaveText("Home");
  });

  test("a late stamp label ends beside its boundary and stays inside the Japanese panel", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await withDb(async (db) => {
      const [answer] = await db
        .select({ id: s.answers.id })
        .from(s.answers)
        .where(and(eq(s.answers.roundId, id("progress-hr-ja-2")), eq(s.answers.position, 3)));
      await db
        .update(s.scoringAttempts)
        .set({ scoringPromptVersion: "synthetic-score-ja-late-version-2026-10-08" })
        .where(eq(s.scoringAttempts.answerId, answer.id));
    });
    await signIn(page);
    await page.goto("/progress?type=hr&context=general");

    const ja = panel(page, "ja");
    const label = ja.getByTestId("boundary-label").last();
    await expect(label).toHaveText("synthetic-score-ja-late-version-2026-10-08");
    const line = plotRows(ja).first().getByTestId("plot-boundary").last();
    const { right, lineX, panelRight } = await ja.evaluate((element) => {
      const label = [...element.querySelectorAll<HTMLElement>('[data-testid="boundary-label"]')].at(-1)!;
      const line = [...element.querySelectorAll<SVGLineElement>('[data-testid="plot-boundary"]')].at(1)!;
      const svg = line.ownerSVGElement!;
      return {
        right: label.getBoundingClientRect().right,
        lineX: svg.getBoundingClientRect().left + Number(line.getAttribute("x1")),
        panelRight: svg.getBoundingClientRect().right,
      };
    });
    await expect(line).toHaveAttribute("x1", /318\.8/u);
    expect(lineX - right).toBeCloseTo(5, 0);
    expect(right).toBeLessThan(panelRight);
    await page.screenshot({ path: test.info().outputPath("progress-late-boundary.png"), fullPage: true });
    expect(errors).toEqual([]);
  });

  test("Progress drops retry, practised-first, wrong-language, typed and practice answers", async ({ page }) => {
    await signIn(page);
    await page.goto("/progress?type=hr&context=general");
    const dots = plotRows(panel(page, "ja")).first().getByTestId("plot-dot");
    await expect(dots).toHaveCount(8);

    const answer = async (round: string, position: number) =>
      withDb(async (db) => {
        const [row] = await db
          .select({ id: s.answers.id })
          .from(s.answers)
          .where(and(eq(s.answers.roundId, id(round)), eq(s.answers.position, position)));
        return row.id;
      });
    const refreshCount = async (expected: number) => {
      await page.reload();
      await expect(dots).toHaveCount(expected);
    };

    const earlier = await answer("progress-hr-ja-1", 1);
    const retry = await answer("progress-hr-ja-1", 5);
    const practisedFirst = await answer("progress-hr-ja-1", 4);
    const wrongLanguage = await answer("progress-hr-ja-2", 3);
    const typed = await answer("progress-hr-ja-2", 2);
    await withDb((db) => db.update(s.answers).set({ retryOfAnswerId: earlier }).where(eq(s.answers.id, retry)));
    await refreshCount(7);
    await withDb((db) => db.update(s.answers).set({ isFirstAttempt: false }).where(eq(s.answers.id, practisedFirst)));
    await refreshCount(6);
    await withDb((db) => db.update(s.scoringAttempts).set({ answeredLanguage: "en" }).where(eq(s.scoringAttempts.answerId, wrongLanguage)));
    await refreshCount(5);
    await withDb((db) => db.update(s.answers).set({ transcriberModelId: null }).where(eq(s.answers.id, typed)));
    await refreshCount(4);
    await withDb((db) => db.update(s.rounds).set({ mode: "practice", perAnswerCapSeconds: 900, feltPressure: null }).where(eq(s.rounds.id, id("progress-hr-ja-2"))));
    await refreshCount(3);
    await expect(page.getByTestId("progress-count")).toHaveText(["Japanese 6 / 30", "English 7 / 30"]);
  });
});
