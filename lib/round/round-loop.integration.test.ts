import { and, eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as s from "../../db/schema";
import { seedUser } from "../../db/seed";
import { seedSyntheticCv } from "../../db/seed-cv";
import { seedRubrics, seedSetPieces, seedSyntheticQuestions } from "../../db/seed-questions";
import { closePool, inRolledBackTransaction, type TestDb } from "../../db/test/database";
import { feedbackScreen, roundFrame } from "../../app/(app)/round/load";
import {
  FIXTURE_FEEDBACK,
  fakeEmbedder,
  FIXTURE_FEEDBACK_JA,
  FIXTURE_FOLLOW_UP,
  FIXTURE_MODEL_ANSWER,
  FIXTURE_MODEL_ANSWER_JA,
  fakeFeedbackGenerator,
  fakeFollowUpGenerator,
  fakeModelAnswerGenerator,
  fakeModelHealth,
  fakeQuestionGenerator,
  fakeScorer,
  fakeTranscriber,
  numberedQuestions,
  uniformScores,
  vectorNear,
} from "../ai/fake-round-ports";
import { ModelCallFailed } from "../ai/upstream";
import { fakeAudioStore } from "../audio/fake-store";
import { createAuth } from "../auth/auth";
import { mintSessionCookie } from "../auth/test/session";
import { getConfig } from "../config";
import { createComplete, createFeedbackRetry } from "./complete";
import { createModelAnswersRetry } from "./model-answers";
import { createOpenAnswer } from "./open-answer";
import { createPostRound } from "./post-round";
import { createPostRoleContext } from "./role-context";
import { createSubmit } from "./submit";
import { answeredBefore, newerRoundExists, promptAt, readRoundStep } from "./state";
import { createTranscribe } from "./transcribe";

// The round loop through its handlers, in both languages (#42, #43) and with its follow-ups (#44),
// against the migrated test database, with a real Better Auth session. Only the model ports and the
// bucket are faked (11 §2).

vi.stubEnv("DATABASE_URL", "postgresql://suburi:suburi@localhost:5433/suburi_test");
vi.stubEnv("DATABASE_URL_UNPOOLED", "postgresql://suburi:suburi@localhost:5433/suburi_test");
vi.stubEnv("BETTER_AUTH_SECRET", "integration-only-secret-not-a-real-one");
vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
vi.stubEnv("GOOGLE_CLIENT_ID", "integration-client-id");
vi.stubEnv("GOOGLE_CLIENT_SECRET", "integration-client-secret");
vi.stubEnv("ALLOWED_EMAIL", "allowed@example.test");
vi.stubEnv("OPENAI_API_KEY", "integration-not-a-real-key");

// Recognisable text that must never reach an envelope or a log line (11 §3.10).
const SENTINEL = "ZEBRA-SENTINEL-4471";
// And a follow-up's: returned to its owner as the next prompt, by design, and logged nowhere.
const FOLLOW_UP_SENTINEL = "OKAPI-SENTINEL-2093";
const FOLLOW_UP_TEXT = `How did you measure the ${FOLLOW_UP_SENTINEL} six months?`;

let logged: string[];

beforeEach(() => {
  logged = [];
  for (const level of ["log", "info", "warn", "error"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(" "));
    });
  }
});

afterEach(() => vi.restoreAllMocks());

afterAll(closePool);

// The handler's transaction, as a savepoint inside the test's rolled-back transaction, so a failed
// write really is undone. `fail` forces a database failure on the next write, for write_failed.
function savepointTransaction(db: TestDb, fail: { next: boolean }, depth: { open: number }) {
  return async <T>(work: (tx: TestDb) => Promise<T>) => {
    await db.execute(sql`savepoint round_write`);
    depth.open += 1;
    try {
      if (fail.next) {
        fail.next = false;
        // What pg raises: a SQLSTATE, and a message that may carry the query's parameters.
        throw Object.assign(new Error(`insert failed: ${SENTINEL}`), { code: "57014" });
      }
      const result = await work(db);
      await db.execute(sql`release savepoint round_write`);
      return result;
    } catch (error) {
      await db.execute(sql`rollback to savepoint round_write`);
      throw error;
    } finally {
      depth.open -= 1;
    }
  };
}

const AUDIO = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4]);

// What the fake transcriber hears in a Japanese round, with a filler and an ASR slip (決済期版).
const HEARD_JA = `えー、${SENTINEL}の決済期版の移行を担当しまして、半年で完了いたしました。`;
const HEARD_JA_CHARACTERS = Array.from(HEARD_JA).length;

async function setUp(db: TestDb, { healthy = true, vectorOf }: { healthy?: boolean; vectorOf?: (text: string) => readonly number[] } = {}) {
  await seedUser(db, getConfig().ALLOWED_EMAIL);
  const [user] = await db.select({ id: s.users.id }).from(s.users).where(eq(s.users.email, getConfig().ALLOWED_EMAIL));
  await seedSyntheticCv(db, user.id, "en");
  await seedSyntheticCv(db, user.id, "ja");
  await seedRubrics(db);
  await seedSetPieces(db, user.id);
  await seedSyntheticQuestions(db, user.id);

  const auth = createAuth({ db, transaction: false });
  const cookie = await mintSessionCookie(auth, user.id);
  const fail = { next: false };
  const depth = { open: 0 };
  const scheduled: (() => Promise<unknown>)[] = [];
  const slept: number[] = [];
  const store = fakeAudioStore();
  const scorer = fakeScorer(uniformScores(3));
  const transcriber = fakeTranscriber(({ language }) => ({
    text: language === "ja" ? HEARD_JA : `I led the migration at ${SENTINEL}, um, in six months.`,
    durationMs: 90_000,
  }));
  const generator = fakeFeedbackGenerator(({ rubric }) => (rubric.language === "ja" ? FIXTURE_FEEDBACK_JA : FIXTURE_FEEDBACK));
  const followUps = fakeFollowUpGenerator(() => ({ ...FIXTURE_FOLLOW_UP, text: FOLLOW_UP_TEXT }));
  const modelAnswers = fakeModelAnswerGenerator(({ rubric }) => (rubric.language === "ja" ? FIXTURE_MODEL_ANSWER_JA : FIXTURE_MODEL_ANSWER));
  const health = fakeModelHealth(healthy);
  const questionGenerator = fakeQuestionGenerator(numberedQuestions());
  const embedder = fakeEmbedder(vectorOf);
  const base = { auth, db, transaction: savepointTransaction(db, fail, depth) };
  const timing = { waitBoundMs: 50, sleep: async () => {} };

  /** `complete` as the route builds it, or with a model-answer wait a test shortens. */
  const completeWith = (overrides: { modelAnswerWaitMs?: number } = {}) =>
    createComplete({
      ...base,
      generator,
      modelAnswerGenerator: modelAnswers,
      after: (work) => void scheduled.push(work),
      ...timing,
      ...overrides,
    });

  const handlers = {
    roleContext: createPostRoleContext(base),
    round: createPostRound({ ...base, health, scorer, questionGenerator, embedder }),
    open: createOpenAnswer({ ...base, store, prefix: "dev/" }),
    transcribe: createTranscribe({ ...base, store, transcriber }),
    submit: createSubmit({
      ...base,
      scorer,
      followUpGenerator: followUps,
      sleep: async (ms) => void slept.push(ms),
      after: (work) => void scheduled.push(work),
      deadline: () => Date.now() + 280_000,
    }),
    complete: completeWith(),
    feedback: createFeedbackRetry({ ...base, generator, ...timing }),
    modelAnswers: createModelAnswersRetry({ ...base, modelAnswerGenerator: modelAnswers }),
  };

  const responses: string[] = [];
  async function call(
    handler: (request: Request, id: string) => Promise<Response>,
    id: string,
    body: unknown,
    { signedIn = true } = {},
  ) {
    const response = await handler(
      new Request("http://localhost:3000/api/x", {
        method: "POST",
        headers: { "content-type": "application/json", ...(signedIn ? { cookie: `${cookie.name}=${cookie.value}` } : {}) },
        body: JSON.stringify(body),
      }),
      id,
    );
    const text = await response.text();
    responses.push(text);
    return { status: response.status, json: JSON.parse(text) };
  }
  const post = (handler: (request: Request) => Promise<Response>, body: unknown, options?: { signedIn?: boolean }) =>
    call((request) => handler(request), "", body, options);

  /** Runs everything `submit` and `complete` scheduled in `after()`, as Vercel's waitUntil would. */
  async function drainAfter() {
    while (scheduled.length > 0) await scheduled.shift()!();
  }

  async function general() {
    return (await post(handlers.roleContext, { kind: "general" })).json.id as string;
  }

  async function startRound(overrides: object = {}) {
    return post(handlers.round, {
      round_type: "hr",
      language: "en",
      mode: "realistic",
      length: 3,
      role_context_id: await general(),
      ...overrides,
    });
  }

  /** Record → open → upload → transcribe → submit, for the round's current prompt: a question or its follow-up. */
  async function answerCurrent(roundId: string, corrected = "I led the migration, um, in six months.") {
    const opened = await call(handlers.open, roundId, { content_type: "audio/webm", expected_bytes: AUDIO.byteLength });
    const key = store.presigned.at(-1)!.key;
    store.put(key, AUDIO);
    await call(handlers.transcribe, opened.json.answer_id, {});
    const submitted = await call(handlers.submit, opened.json.answer_id, { transcript_corrected: corrected });
    return { answerId: opened.json.answer_id as string, opened, submitted };
  }

  /** A whole position: the bank question, then the follow-up `submit` returned, when it returned one. */
  async function answerPosition(roundId: string, corrected?: string) {
    const question = await answerCurrent(roundId, corrected);
    const followUp =
      question.submitted.json.next?.kind === "follow_up" ? await answerCurrent(roundId, "It was my call, um, in the end.") : null;
    return { ...question, followUp };
  }

  return {
    userId: user.id,
    fail,
    /** True while a handler's transaction is open: no model call may run then (11 §3.14). */
    inTransaction: () => depth.open > 0,
    slept,
    store,
    scorer,
    transcriber,
    generator,
    followUps,
    modelAnswers,
    health,
    questionGenerator,
    handlers,
    completeWith,
    call,
    post,
    responses,
    drainAfter,
    general,
    startRound,
    answerCurrent,
    answerPosition,
  };
}

type World = Awaited<ReturnType<typeof setUp>>;

async function playThrough(world: World, overrides: object = {}) {
  const started = await world.startRound(overrides);
  const roundId = started.json.round.id as string;
  const answers = [];
  for (let position = 1; position <= 3; position += 1) answers.push(await world.answerPosition(roundId));
  return { roundId, answers, started };
}

async function count(
  db: TestDb,
  table:
    | typeof s.rounds
    | typeof s.roundQuestions
    | typeof s.roundFeedback
    | typeof s.answers
    | typeof s.followUps
    | typeof s.modelAnswers,
) {
  return (await db.select({ id: table.id }).from(table)).length;
}

describe("POST /api/role-contexts", () => {
  it("is 401 with no session", () =>
    inRolledBackTransaction(async (db) => {
      const { post, handlers } = await setUp(db);
      expect((await post(handlers.roleContext, { kind: "general" }, { signedIn: false })).status).toBe(401);
    }));

  it("creates General practice once, and a repeat returns the same row", () =>
    inRolledBackTransaction(async (db) => {
      const { post, handlers, userId } = await setUp(db);
      const first = await post(handlers.roleContext, { kind: "general" });
      const second = await post(handlers.roleContext, { kind: "general" });
      expect(first.status).toBe(201);
      expect(second.status).toBe(200);
      expect(second.json.id).toBe(first.json.id);
      const rows = await db.select().from(s.roleContexts).where(eq(s.roleContexts.userId, userId));
      expect(rows).toHaveLength(1);
    }));

  it("is 500 write_failed on a failed write, and writes nothing", () =>
    inRolledBackTransaction(async (db) => {
      const { post, handlers, fail, userId } = await setUp(db);
      fail.next = true;
      const { status, json } = await post(handlers.roleContext, { kind: "general" });
      expect(status).toBe(500);
      expect(json.error).toMatchObject({ code: "write_failed", detail: { error_class: "pg_57014" } });
      expect(await db.select().from(s.roleContexts).where(eq(s.roleContexts.userId, userId))).toHaveLength(0);
    }));

  it.each([{ kind: "posting", body: "A posting." }, { kind: "researched" }, { kind: "general", company_name: "Invented" }])(
    "refuses %o with a 400",
    (body) =>
      inRolledBackTransaction(async (db) => {
        const { post, handlers } = await setUp(db);
        const { status, json } = await post(handlers.roleContext, body);
        expect(status).toBe(400);
        expect(json.error.code).toBe("invalid_request");
      }),
  );
});

describe("POST /api/rounds — a round's questions, chosen once (11 §3.13)", () => {
  it("writes the round and exactly `length` round_questions, stamped with the current CV version", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { status, json } = await world.startRound();
      expect(status).toBe(201);
      const round = json.round;
      expect(round).toMatchObject({ round_type: "hr", language: "en", mode: "realistic", length: 3, per_answer_cap_seconds: 240 });
      expect(round.stamps).toEqual({
        cv_version_label: "CV v1",
        rubric_version_label: "v1.0",
        scoring_model_id: world.scorer.modelId,
        scoring_prompt_version: "score-en-fake",
      });
      const rows = await db.select().from(s.roundQuestions).where(eq(s.roundQuestions.roundId, round.id));
      expect(rows.map((row) => row.position).sort()).toEqual([1, 2, 3]);
      expect(json.prompt).toMatchObject({ kind: "question", position: 1, speak: true });
      expect(json.progress).toEqual({ position: 1, of: 3 });
      const [stored] = await db.select().from(s.rounds).where(eq(s.rounds.id, round.id));
      const [cv] = await db.select().from(s.cvVersions).where(and(eq(s.cvVersions.userId, world.userId), eq(s.cvVersions.language, "en")));
      expect(stored.cvVersionId).toBe(cv.id);
    }));

  it("asks one unseen set piece of its type first, then unseen generated questions", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { json } = await world.startRound();
      const chosen = await db
        .select({ position: s.roundQuestions.position, origin: s.questions.origin, roundType: s.questions.roundType })
        .from(s.roundQuestions)
        .innerJoin(s.questions, eq(s.questions.id, s.roundQuestions.questionId))
        .where(eq(s.roundQuestions.roundId, json.round.id))
        .orderBy(s.roundQuestions.position);
      expect(chosen.map((row) => row.origin)).toEqual(["set_piece", "generated", "generated"]);
      expect(chosen.every((row) => row.roundType === "hr")).toBe(true);
    }));

  it("asks the question fixed at each position, however often it is read", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { json } = await world.startRound();
      const fixed = await db
        .select({ position: s.roundQuestions.position, questionId: s.roundQuestions.questionId })
        .from(s.roundQuestions)
        .where(eq(s.roundQuestions.roundId, json.round.id))
        .orderBy(s.roundQuestions.position);
      for (const { position, questionId } of fixed) {
        // A reload reads the same prompt; so does the slot that is opened for it.
        expect((await promptAt(db, json.round.id, position))?.questionId).toBe(questionId);
        expect((await promptAt(db, json.round.id, position))?.questionId).toBe(questionId);
        const { opened } = await world.answerPosition(json.round.id);
        expect(opened.json.question_id).toBe(questionId);
      }
    }));

  it("gives a behavioural round no set piece", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { json } = await world.startRound({ round_type: "behavioural" });
      const chosen = await db
        .select({ origin: s.questions.origin })
        .from(s.roundQuestions)
        .innerJoin(s.questions, eq(s.questions.id, s.roundQuestions.questionId))
        .where(eq(s.roundQuestions.roundId, json.round.id));
      expect(chosen.every((row) => row.origin === "generated")).toBe(true);
    }));

  it("does not spend a set piece that was only chosen: the next round asks it again", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const first = await world.startRound();
      const second = await world.startRound();
      expect(second.json.prompt.question_id).toBe(first.json.prompt.question_id);
    }));

  it("asks the next unseen set piece once the first has an answer", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const first = await world.startRound();
      await world.answerCurrent(first.json.round.id);
      const second = await world.startRound();
      expect(second.json.prompt.question_id).not.toBe(first.json.prompt.question_id);
      const [question] = await db.select().from(s.questions).where(eq(s.questions.id, second.json.prompt.question_id));
      expect(question.origin).toBe("set_piece");
    }));

  it.each([
    [{ cv_version_id: "3f2a91c4-0000-4000-8000-000000000000" }, "cv_version_id"],
    [{ rubric_version_id: "3f2a91c4-0000-4000-8000-000000000000" }, "rubric_version_id"],
    [{ language: "fr" }, "language"],
    [{ length: 4 }, "length"],
  ])("refuses %o with a 400 naming the field, and writes nothing", (overrides, field) =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { status, json } = await world.startRound(overrides);
      expect(status).toBe(400);
      expect(JSON.stringify(json.error.detail)).toContain(field);
      expect(await count(db, s.rounds)).toBe(0);
    }));

  it("is 503 model_unavailable when the preflight fails, and creates nothing", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db, { healthy: false });
      const { status, json } = await world.startRound();
      expect(status).toBe(503);
      expect(json.error.code).toBe("model_unavailable");
      expect(await count(db, s.rounds)).toBe(0);
      expect(await count(db, s.roundQuestions)).toBe(0);
    }));

  it("generates nothing while the unseen pool can fill the round", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      expect((await world.startRound()).status).toBe(201);
      expect(world.questionGenerator.calls).toBe(0);
    }));

  it("is 500 write_failed on a failed write, with nothing half-written", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const contextId = await world.general();
      world.fail.next = true;
      const { status, json } = await world.post(world.handlers.round, {
        round_type: "hr",
        language: "en",
        mode: "realistic",
        length: 3,
        role_context_id: contextId,
      });
      expect(status).toBe(500);
      expect(json.error).toMatchObject({ code: "write_failed", detail: { error_class: "pg_57014" } });
      expect(await count(db, s.rounds)).toBe(0);
      expect(await count(db, s.roundQuestions)).toBe(0);
    }));
});

describe("abandoned, derived (04 `rounds`)", () => {
  it("a lone round is not abandoned, and starting another abandons it", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const first = await world.startRound();
      const [row] = await db.select().from(s.rounds).where(eq(s.rounds.id, first.json.round.id));
      expect(await newerRoundExists(db, row)).toBe(false);
      // One transaction shares one now(): the second round is dated as a later request would date it.
      const second = await world.startRound();
      await db
        .update(s.rounds)
        .set({ startedAt: sql`${s.rounds.startedAt} + interval '1 second'` })
        .where(eq(s.rounds.id, second.json.round.id));
      expect(await newerRoundExists(db, row)).toBe(true);
    }));
});

/** A stale tab's view: a newer round starts, dated as a later request would date it. */
async function abandonBy(world: World, db: TestDb) {
  const newer = await world.startRound();
  await db
    .update(s.rounds)
    .set({ startedAt: sql`${s.rounds.startedAt} + interval '1 second'` })
    .where(eq(s.rounds.id, newer.json.round.id));
}

describe("an abandoned round takes no more writes (07 §5.5, §5.12)", () => {

  it("refuses to open a slot: 409 round_abandoned, and no answer row", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const roundId = (await world.startRound()).json.round.id as string;
      await abandonBy(world, db);
      const before = await count(db, s.answers);

      const { status, json } = await world.call(world.handlers.open, roundId, {
        content_type: "audio/webm",
        expected_bytes: AUDIO.byteLength,
      });
      expect(status).toBe(409);
      expect(json.error.code).toBe("round_abandoned");
      expect(await count(db, s.answers)).toBe(before);
      expect(world.store.presigned).toHaveLength(0);
    }));

  it("refuses to submit: 409 round_abandoned, no corrected text and no scoring attempt", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const roundId = (await world.startRound()).json.round.id as string;
      const opened = await world.call(world.handlers.open, roundId, { content_type: "audio/webm", expected_bytes: AUDIO.byteLength });
      world.store.put(world.store.presigned.at(-1)!.key, AUDIO);
      await world.call(world.handlers.transcribe, opened.json.answer_id, {});
      await abandonBy(world, db);

      const { status, json } = await world.call(world.handlers.submit, opened.json.answer_id, { transcript_corrected: "I led it." });
      expect(status).toBe(409);
      expect(json.error.code).toBe("round_abandoned");
      const [answer] = await db.select().from(s.answers).where(eq(s.answers.id, opened.json.answer_id));
      expect(answer.transcriptCorrected).toBeNull();
      expect(await db.select().from(s.scoringAttempts).where(eq(s.scoringAttempts.answerId, answer.id))).toHaveLength(0);
    }));

  it("refuses to complete: 409 round_abandoned, no rating, no completed_at and no feedback", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { roundId } = await playThrough(world);
      await world.drainAfter();
      await abandonBy(world, db);

      const { status, json } = await world.call(world.handlers.complete, roundId, { felt_pressure: 3 });
      expect(status).toBe(409);
      expect(json.error.code).toBe("round_abandoned");
      const [round] = await db.select().from(s.rounds).where(eq(s.rounds.id, roundId));
      expect(round.completedAt).toBeNull();
      expect(round.feltPressure).toBeNull();
      expect(await count(db, s.roundFeedback)).toBe(0);
      expect(world.generator.calls).toBe(0);
    }));

  it("reloads onto the abandoned screen counting only the answers submitted before it", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const roundId = (await world.startRound()).json.round.id as string;
      await world.answerCurrent(roundId);
      await abandonBy(world, db);

      const [row] = await db.select().from(s.rounds).where(eq(s.rounds.id, roundId));
      const frame = await roundFrame(db, world.userId, row);
      expect(frame).not.toBe("complete");
      expect(frame !== "complete" && frame.start).toEqual({ kind: "abandoned", answered: 1 });
    }));

  it("refuses a round started on an earlier Asia/Tokyo day the same way", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const roundId = (await world.startRound()).json.round.id as string;
      await db
        .update(s.rounds)
        .set({ startedAt: sql`${s.rounds.startedAt} - interval '1 day'` })
        .where(eq(s.rounds.id, roundId));

      const { status, json } = await world.call(world.handlers.open, roundId, {
        content_type: "audio/webm",
        expected_bytes: AUDIO.byteLength,
      });
      expect(status).toBe(409);
      expect(json.error.code).toBe("round_abandoned");
    }));
});

describe("first attempts, computed at slot-open (11 §3.4)", () => {
  async function firstAttemptOf(db: TestDb, answerId: string) {
    const [row] = await db.select({ flag: s.answers.isFirstAttempt }).from(s.answers).where(eq(s.answers.id, answerId));
    return row.flag;
  }

  async function questionOf(db: TestDb, answerId: string) {
    const [row] = await db.select({ questionId: s.answers.questionId }).from(s.answers).where(eq(s.answers.id, answerId));
    return row.questionId!;
  }

  /** Leaves exactly these generated hr questions askable, so the next realistic hr round is known. */
  async function keepGenerated(db: TestDb, keep: readonly string[]) {
    await db
      .update(s.questions)
      .set({ retiredAt: new Date() })
      .where(
        and(
          eq(s.questions.origin, "generated"),
          eq(s.questions.roundType, "hr"),
          sql`${s.questions.id} not in (${sql.join(keep.map((id) => sql`${id}::uuid`), sql`, `)})`,
        ),
      );
  }

  /**
   * With every new candidate embedded as `vectorNear(1)`, giving the answered question that vector
   * makes each candidate its duplicate: the guard maps them to it, and it is asked again as a repeat.
   */
  const duplicatingAnswered = { vectorOf: () => vectorNear(1) };
  async function embedAsDuplicated(db: TestDb, questionId: string) {
    await db.update(s.questions).set({ embedding: vectorNear(1) }).where(eq(s.questions.id, questionId));
  }

  async function roundQuestionIds(db: TestDb, roundId: string) {
    const rows = await db
      .select({ questionId: s.roundQuestions.questionId })
      .from(s.roundQuestions)
      .where(eq(s.roundQuestions.roundId, roundId))
      .orderBy(s.roundQuestions.position);
    return rows.map((row) => row.questionId);
  }

  it("is false in a realistic round for a question answered in practice first", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db, duplicatingAnswered);
      const practice = await world.startRound({ mode: "practice" });
      const { answerId: practised } = await world.answerCurrent(practice.json.round.id);
      expect(await firstAttemptOf(db, practised)).toBe(false);
      const practisedQuestion = await questionOf(db, practised);
      const [, other] = await roundQuestionIds(db, practice.json.round.id);

      // A set piece, then the unseen generated question, then the practised one: the repeat.
      await keepGenerated(db, [practisedQuestion, other]);
      await embedAsDuplicated(db, practisedQuestion);
      const realistic = await world.startRound();
      expect((await roundQuestionIds(db, realistic.json.round.id)).slice(1)).toEqual([other, practisedQuestion]);
      const flags = [];
      for (let position = 1; position <= 3; position += 1) {
        flags.push(await firstAttemptOf(db, (await world.answerPosition(realistic.json.round.id)).answerId));
      }
      expect(flags).toEqual([true, true, false]);
    }));

  it("counts an answer in an abandoned round, but not a question that round only fixed", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db, duplicatingAnswered);
      const abandoned = await world.startRound();
      const [, answeredQuestion, fixedOnly] = await roundQuestionIds(db, abandoned.json.round.id);
      await world.answerPosition(abandoned.json.round.id);
      const { answerId } = await world.answerCurrent(abandoned.json.round.id);
      expect(await firstAttemptOf(db, answerId)).toBe(true);

      // The next round: the next set piece, the question only fixed (unseen), the one answered (seen).
      await keepGenerated(db, [answeredQuestion, fixedOnly]);
      await embedAsDuplicated(db, answeredQuestion);
      const next = await world.startRound();
      expect((await roundQuestionIds(db, next.json.round.id)).slice(1)).toEqual([fixedOnly, answeredQuestion]);
      const flags = [];
      for (let position = 1; position <= 3; position += 1) {
        flags.push(await firstAttemptOf(db, (await world.answerPosition(next.json.round.id)).answerId));
      }
      expect(flags).toEqual([true, true, false]);
    }));

  it("counts an answer in one language only: the same question in the other is still unseen", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { json } = await world.startRound();
      const { answerId } = await world.answerCurrent(json.round.id);
      const question = await questionOf(db, answerId);
      expect(await answeredBefore(db, question, "en")).toBe(true);
      expect(await answeredBefore(db, question, "ja")).toBe(false);
    }));

  it("is false for every answer in a practice round", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { json } = await world.startRound({ mode: "practice" });
      const flags = [];
      for (let position = 1; position <= 3; position += 1) {
        flags.push(await firstAttemptOf(db, (await world.answerPosition(json.round.id)).answerId));
      }
      expect(flags).toEqual([false, false, false]);
    }));
});

describe("POST /api/rounds/{id}/answers", () => {
  it("opens one slot, and a repeat returns the same row with a fresh URL for the same key", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { json } = await world.startRound();
      const roundId = json.round.id;
      const first = await world.call(world.handlers.open, roundId, { content_type: "audio/webm;codecs=opus", expected_bytes: 1000 });
      const second = await world.call(world.handlers.open, roundId, { content_type: "audio/webm", expected_bytes: 2000 });
      expect(first.status).toBe(201);
      expect(second.status).toBe(200);
      expect(second.json.answer_id).toBe(first.json.answer_id);
      expect(world.store.presigned.map((entry) => entry.key)).toEqual([
        `dev/${world.userId}/${roundId}/${first.json.answer_id}.webm`,
        `dev/${world.userId}/${roundId}/${first.json.answer_id}.webm`,
      ]);
      expect(first.json).toMatchObject({ position: 1, kind: "question", is_first_attempt: true, upload: { method: "PUT" } });
      expect(await count(db, s.answers)).toBe(1);
    }));

  it.each([
    [{ content_type: "audio/mp4", expected_bytes: 10 }, 422, "unsupported_content_type"],
    [{ content_type: "audio/webm", expected_bytes: 20 * 1024 * 1024 + 1 }, 422, "upload_too_large"],
    [{ content_type: "audio/webm", expected_bytes: 10, key: "mine.webm" }, 400, "invalid_request"],
  ])("refuses %o before writing anything", (body, status, code) =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { json } = await world.startRound();
      const response = await world.call(world.handlers.open, json.round.id, body);
      expect(response.status).toBe(status);
      expect(response.json.error.code).toBe(code);
      expect(await count(db, s.answers)).toBe(0);
    }));

  it("keeps the slot when the presign fails, and the retry lands on it", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { json } = await world.startRound();
      world.store.failPresign = true;
      const failed = await world.call(world.handlers.open, json.round.id, { content_type: "audio/webm", expected_bytes: 10 });
      expect(failed.status).toBe(502);
      expect(failed.json.error.code).toBe("presign_failed");
      world.store.failPresign = false;
      const retried = await world.call(world.handlers.open, json.round.id, { content_type: "audio/webm", expected_bytes: 10 });
      expect(retried.json.answer_id).toBe(failed.json.error.detail.answer_id);
    }));

  it("is 404 for another user's round", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { json } = await world.startRound();
      await db.update(s.rounds).set({ userId: (await insertOtherUser(db)) }).where(eq(s.rounds.id, json.round.id));
      const response = await world.call(world.handlers.open, json.round.id, { content_type: "audio/webm", expected_bytes: 10 });
      expect(response.status).toBe(404);
    }));

  it("is 500 write_failed on a failed write, and nothing is opened", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { json } = await world.startRound();
      world.fail.next = true;
      const response = await world.call(world.handlers.open, json.round.id, { content_type: "audio/webm", expected_bytes: 10 });
      expect(response.status).toBe(500);
      expect(response.json.error.code).toBe("write_failed");
      expect(await count(db, s.answers)).toBe(0);
    }));
});

async function insertOtherUser(db: TestDb) {
  const id = crypto.randomUUID();
  await db.insert(s.users).values({ id, name: "other", email: `${id}@example.test` });
  return id;
}

describe("POST /api/answers/{id}/transcribe", () => {
  it("is 404 audio_missing before the take is uploaded, and makes no model call", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { json } = await world.startRound();
      const opened = await world.call(world.handlers.open, json.round.id, { content_type: "audio/webm", expected_bytes: 10 });
      const response = await world.call(world.handlers.transcribe, opened.json.answer_id, {});
      expect(response.status).toBe(404);
      expect(response.json.error.code).toBe("audio_missing");
      expect(world.transcriber.calls).toBe(0);
    }));

  it("stores the raw transcript, its duration and pace, and a repeat calls no model", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { json } = await world.startRound();
      const opened = await world.call(world.handlers.open, json.round.id, { content_type: "audio/webm", expected_bytes: 10 });
      world.store.put(world.store.presigned[0].key, AUDIO);
      const first = await world.call(world.handlers.transcribe, opened.json.answer_id, {});
      const second = await world.call(world.handlers.transcribe, opened.json.answer_id, {});
      expect(first.status).toBe(200);
      expect(first.json).toMatchObject({ audio_duration_ms: 90_000, transcriber_model_id: "fake-transcriber" });
      // 10 words in 1.5 minutes.
      expect(first.json.words_per_minute).toBeCloseTo(10 / 1.5);
      expect(second.json).toEqual(first.json);
      expect(world.transcriber.calls).toBe(1);
    }));

  it("is 500 write_failed when the transcript cannot be stored, and the column stays null for the retry", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { json } = await world.startRound();
      const opened = await world.call(world.handlers.open, json.round.id, { content_type: "audio/webm", expected_bytes: 10 });
      world.store.put(world.store.presigned[0].key, AUDIO);
      world.fail.next = true;
      const failed = await world.call(world.handlers.transcribe, opened.json.answer_id, {});
      expect(failed.status).toBe(500);
      expect(failed.json.error.code).toBe("write_failed");
      const [row] = await db.select().from(s.answers).where(eq(s.answers.id, opened.json.answer_id));
      expect(row.transcriptRaw).toBeNull();
      const retried = await world.call(world.handlers.transcribe, opened.json.answer_id, {});
      expect(retried.status).toBe(200);
    }));

  it("keeps the take and leaves the transcript null when transcription fails", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { json } = await world.startRound();
      const opened = await world.call(world.handlers.open, json.round.id, { content_type: "audio/webm", expected_bytes: 10 });
      world.store.put(world.store.presigned[0].key, AUDIO);
      const failing = createTranscribe({
        auth: createAuth({ db, transaction: false }),
        db,
        transaction: async (work) => work(db),
        store: world.store,
        transcriber: fakeTranscriber(() => {
          throw new ModelCallFailed("Transcription", "upstream_500");
        }),
      });
      const response = await world.call(failing, opened.json.answer_id, {});
      expect(response.status).toBe(502);
      expect(response.json.error).toMatchObject({ code: "transcription_failed", detail: { error_class: "upstream_500" } });
      const [row] = await db.select().from(s.answers).where(eq(s.answers.id, opened.json.answer_id));
      expect(row.transcriptRaw).toBeNull();
      expect(world.store.objects.size).toBe(1);
    }));
});

describe("POST /api/answers/{id}/submit", () => {
  it("keeps both transcripts, stamps all four, scores in after(), and walks the round to pressure", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { roundId, answers } = await playThrough(world);
      // Each question's answer is followed up at the same position; each follow-up's by the next question.
      expect(answers.map((answer) => answer.submitted.json.next.kind)).toEqual(["follow_up", "follow_up", "follow_up"]);
      expect(answers.map((answer) => answer.followUp!.submitted.json.next.kind)).toEqual(["question", "question", "pressure"]);
      expect(answers[0].followUp!.submitted.json.next).toMatchObject({ position: 2, speak: true });
      expect(answers[2].followUp!.submitted.json.progress).toEqual({ position: 3, of: 3 });

      const [answer] = await db.select().from(s.answers).where(eq(s.answers.id, answers[0].answerId));
      expect(answer.transcriptRaw).toContain(SENTINEL);
      expect(answer.transcriptCorrected).toBe("I led the migration, um, in six months.");
      expect(answer.rewriteMagnitude).toBeGreaterThan(0);

      const attempts = await db.select().from(s.scoringAttempts);
      expect(attempts).toHaveLength(6);
      for (const attempt of attempts) {
        expect(attempt.status).toBe("pending");
        expect(attempt.cvVersionId).not.toBeNull();
        expect(attempt.rubricVersionId).not.toBeNull();
        expect(attempt.generatorPromptVersion).toMatch(/^(set-piece-en-1\.0|synthetic-generated-en-1\.0|follow-up-en-fake)$/);
        expect(attempt.modelId).toBe("fake-scorer-2026-01-01");
        expect(attempt.scoringPromptVersion).toBe("score-en-fake");
      }

      await world.drainAfter();
      const scored = await db.select().from(s.scoringAttempts);
      expect(scored.every((attempt) => attempt.status === "ok")).toBe(true);
      expect(await db.select().from(s.scores)).toHaveLength(36);
      expect(world.scorer.calls).toBe(6);
      void roundId;
    }));

  it("sends the scorer the corrected text, never the raw one", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { json } = await world.startRound();
      const seen: string[] = [];
      world.scorer.score = async (input) => {
        expect(world.inTransaction()).toBe(false);
        seen.push(input.answer);
        return uniformScores(4)(input);
      };
      await world.answerCurrent(json.round.id, "Corrected text only.");
      await world.drainAfter();
      expect(seen).toEqual(["Corrected text only."]);
    }));

  it("returns the same attempt for the same body, and refuses a different one", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { json } = await world.startRound();
      const { answerId, submitted } = await world.answerCurrent(json.round.id, "First.");
      const again = await world.call(world.handlers.submit, answerId, { transcript_corrected: "First." });
      const changed = await world.call(world.handlers.submit, answerId, { transcript_corrected: "Second." });
      expect(again.status).toBe(200);
      expect(again.json.scoring.attempt_id).toBe(submitted.json.scoring.attempt_id);
      expect(changed.status).toBe(422);
      expect(changed.json.error.code).toBe("answer_already_submitted");
      expect(await db.select().from(s.scoringAttempts)).toHaveLength(1);
    }));

  it("marks the attempt failed after three retries, keeping only the error class", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { json } = await world.startRound();
      world.scorer.score = async () => {
        world.scorer.calls += 1;
        throw new ModelCallFailed("Scoring", "upstream_500");
      };
      const { submitted } = await world.answerCurrent(json.round.id);
      await world.drainAfter();
      const [attempt] = await db.select().from(s.scoringAttempts).where(eq(s.scoringAttempts.id, submitted.json.scoring.attempt_id));
      expect(attempt).toMatchObject({ status: "failed", errorClass: "upstream_500" });
      expect(world.scorer.calls).toBe(4);
      expect(world.slept).toEqual([2_000, 4_000, 8_000]);
      expect(await db.select().from(s.scores)).toHaveLength(0);
    }));

  it("is 500 write_failed on a failed write: no correction, no attempt", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { json } = await world.startRound();
      const opened = await world.call(world.handlers.open, json.round.id, { content_type: "audio/webm", expected_bytes: 10 });
      world.store.put(world.store.presigned[0].key, AUDIO);
      await world.call(world.handlers.transcribe, opened.json.answer_id, {});
      world.fail.next = true;
      const response = await world.call(world.handlers.submit, opened.json.answer_id, { transcript_corrected: SENTINEL });
      expect(response.status).toBe(500);
      expect(response.json.error.code).toBe("write_failed");
      const [row] = await db.select().from(s.answers).where(eq(s.answers.id, opened.json.answer_id));
      expect(row.transcriptCorrected).toBeNull();
      expect(await db.select().from(s.scoringAttempts)).toHaveLength(0);
    }));
});

describe("POST /api/rounds/{id}/complete (11 §3.14)", () => {
  it("is 422 pressure_required without a rating in a realistic round, and closes nothing", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { roundId } = await playThrough(world);
      const response = await world.call(world.handlers.complete, roundId, {});
      expect(response.status).toBe(422);
      expect(response.json.error.code).toBe("pressure_required");
      const [round] = await db.select().from(s.rounds).where(eq(s.rounds.id, roundId));
      expect(round.completedAt).toBeNull();
    }));

  it("is 409 round_not_complete while a question is unanswered", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { json } = await world.startRound();
      await world.answerCurrent(json.round.id);
      const response = await world.call(world.handlers.complete, json.round.id, { felt_pressure: 3 });
      expect(response.status).toBe(409);
      expect(response.json.error.code).toBe("round_not_complete");
    }));

  it("is 422 pressure_not_applicable for a practice round with a rating", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { json } = await world.startRound({ mode: "practice" });
      for (let position = 1; position <= 3; position += 1) await world.answerPosition(json.round.id);
      const response = await world.call(world.handlers.complete, json.round.id, { felt_pressure: 3 });
      expect(response.status).toBe(422);
      expect(response.json.error.code).toBe("pressure_not_applicable");
    }));

  it("commits the rating first, then generates feedback from every score, once", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { roundId } = await playThrough(world);
      await world.drainAfter();
      let ratedWhenCalled: number | null = null;
      world.generator.generate = async (input) => {
        expect(world.inTransaction()).toBe(false);
        const [round] = await db.select().from(s.rounds).where(eq(s.rounds.id, roundId));
        ratedWhenCalled = round.feltPressure;
        expect(input.answers.every((answer) => answer.scores?.length === 6)).toBe(true);
        return FIXTURE_FEEDBACK;
      };
      const response = await world.call(world.handlers.complete, roundId, { felt_pressure: 4 });
      expect(response.status).toBe(201);
      expect(ratedWhenCalled).toBe(4);
      expect(response.json.scoring).toEqual({ ok: 6, pending: 0, failed: 0 });
      expect(response.json.feedback).toMatchObject({ what_worked: FIXTURE_FEEDBACK.whatWorked, language: "en", prompt_version: "feedback-en-fake" });
      // An English round's feedback is English: there is nothing to toggle to (PRD §4).
      expect(response.json.feedback.body_translated).toBeNull();
      expect(response.json.feedback.to_fix).toHaveLength(2);
      expect(await count(db, s.roundFeedback)).toBe(1);

      const again = await world.call(world.handlers.complete, roundId, { felt_pressure: 2 });
      expect(again.status).toBe(200);
      expect(again.json).toEqual(response.json);
      const [round] = await db.select().from(s.rounds).where(eq(s.rounds.id, roundId));
      expect(round.feltPressure).toBe(4);
    }));

  it("waits for a score that lands inside the bound", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { roundId } = await playThrough(world);
      const complete = createComplete({
        auth: createAuth({ db, transaction: false }),
        db,
        transaction: async (work) => work(db),
        generator: world.generator,
        modelAnswerGenerator: world.modelAnswers,
        after: () => {},
        waitBoundMs: 60_000,
        // The scores land during the first poll.
        sleep: () => world.drainAfter(),
      });
      const response = await world.call(complete, roundId, { felt_pressure: 3 });
      expect(response.status).toBe(201);
      // A follow-up's answer is sent under its parent's position, marked as one.
      expect(world.generator.inputs[0].answers.map((answer) => [answer.position, answer.followUp])).toEqual([
        [1, false],
        [1, true],
        [2, false],
        [2, true],
        [3, false],
        [3, true],
      ]);
    }));

  it("writes no feedback when a score is still pending past the bound, and the round stays complete", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { roundId } = await playThrough(world);
      const response = await world.call(world.handlers.complete, roundId, { felt_pressure: 5 });
      expect(response.status).toBe(502);
      expect(response.json.error).toMatchObject({ code: "feedback_generation_failed", detail: { error_class: "scores_pending", pending: 6 } });
      expect(world.generator.calls).toBe(0);
      expect(await count(db, s.roundFeedback)).toBe(0);
      const [round] = await db.select().from(s.rounds).where(eq(s.rounds.id, roundId));
      expect(round.feltPressure).toBe(5);
      expect(round.completedAt).not.toBeNull();

      // The retry writes the row once the scores are in; a second retry calls nothing.
      await world.drainAfter();
      const retried = await world.call(world.handlers.feedback, roundId, {});
      expect(retried.status).toBe(201);
      const second = await world.call(world.handlers.feedback, roundId, {});
      expect(second.status).toBe(200);
      expect(second.json.feedback).toEqual(retried.json.feedback);
      expect(world.generator.calls).toBe(1);
      expect(await count(db, s.roundFeedback)).toBe(1);
    }));

  it("is 500 write_failed when the retry cannot store the feedback, and a later retry writes it", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { roundId } = await playThrough(world);
      expect((await world.call(world.handlers.complete, roundId, { felt_pressure: 3 })).status).toBe(502);
      await world.drainAfter();
      world.fail.next = true;
      const failed = await world.call(world.handlers.feedback, roundId, {});
      expect(failed.status).toBe(500);
      expect(failed.json.error.code).toBe("write_failed");
      expect(await count(db, s.roundFeedback)).toBe(0);
      expect((await world.call(world.handlers.feedback, roundId, {})).status).toBe(201);
      expect(await count(db, s.roundFeedback)).toBe(1);
    }));

  it("keeps the round complete with its rating when generation fails", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { roundId } = await playThrough(world);
      await world.drainAfter();
      world.generator.generate = async () => {
        throw new ModelCallFailed("Round feedback", "upstream_503");
      };
      const response = await world.call(world.handlers.complete, roundId, { felt_pressure: 2 });
      expect(response.status).toBe(502);
      expect(response.json.error.detail.error_class).toBe("upstream_503");
      const [round] = await db.select().from(s.rounds).where(eq(s.rounds.id, roundId));
      expect(round).toMatchObject({ feltPressure: 2 });
      expect(round.completedAt).not.toBeNull();
      expect(await count(db, s.roundFeedback)).toBe(0);
      // Scores landed, so screen 8 offers the retry.
      expect(await feedbackScreen(db, round)).toMatchObject({ findings: null, findingsUnavailable: false });
    }));

  // A retry that spent its retries: the answer's latest attempt is `failed`.
  async function failScoring(db: TestDb, world: World, roundId: string, answerId: string) {
    const [round] = await db.select().from(s.rounds).where(eq(s.rounds.id, roundId));
    await db.insert(s.scoringAttempts).values({
      answerId,
      userId: world.userId,
      status: "failed",
      cvVersionId: round.cvVersionId,
      rubricVersionId: round.rubricVersionId,
      generatorPromptVersion: "synthetic-generated-en-1.0",
      modelId: "fake-scorer-2026-01-01",
      scoringPromptVersion: "score-en-fake",
      errorClass: "upstream_500",
      isSuperseding: true,
      createdAt: new Date(Date.now() + 1_000),
    });
  }

  it("generates without an answer whose score failed: its transcript never reaches the generator", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const started = await world.startRound();
      const roundId = started.json.round.id as string;
      await world.answerPosition(roundId, "I owned the rollout.");
      const second = await world.answerPosition(roundId, `I failed to be scored ${SENTINEL}.`);
      await world.answerPosition(roundId, "I measured the outcome.");
      await world.drainAfter();
      await failScoring(db, world, roundId, second.answerId);
      const response = await world.call(world.handlers.complete, roundId, { felt_pressure: 3 });
      expect(response.status).toBe(201);
      expect(response.json.scoring).toEqual({ ok: 5, pending: 0, failed: 1 });
      // The failed answer is left out; its follow-up's answer, scored on its own, is not.
      const sent = world.generator.inputs[0].answers;
      expect(sent.map((answer) => [answer.position, answer.followUp])).toEqual([
        [1, false],
        [1, true],
        [2, true],
        [3, false],
        [3, true],
      ]);
      expect(sent.filter((answer) => !answer.followUp).map((answer) => answer.answer)).toEqual(["I owned the rollout.", "I measured the outcome."]);
      expect(JSON.stringify(world.generator.inputs)).not.toContain(SENTINEL);
    }));

  it("refuses as no_scores when every score failed, makes no model call, and screen 8 offers no retry", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { roundId, answers } = await playThrough(world);
      await world.drainAfter();
      for (const { answerId, followUp } of answers) {
        await failScoring(db, world, roundId, answerId);
        await failScoring(db, world, roundId, followUp!.answerId);
      }
      const completed = await world.call(world.handlers.complete, roundId, { felt_pressure: 3 });
      expect(completed.status).toBe(502);
      expect(completed.json.error).toMatchObject({ code: "feedback_generation_failed", detail: { error_class: "no_scores" } });
      expect(events("feedback_generation_failed")[0]).toMatchObject({ ok: 0, pending: 0, failed: answers.length * 2 });
      const retried = await world.call(world.handlers.feedback, roundId, {});
      expect(retried.status).toBe(502);
      expect(retried.json.error.detail.error_class).toBe("no_scores");
      expect(world.generator.calls).toBe(0);
      expect(await count(db, s.roundFeedback)).toBe(0);
      const [round] = await db.select().from(s.rounds).where(eq(s.rounds.id, roundId));
      expect(round.completedAt).not.toBeNull();
      const screen = await feedbackScreen(db, round);
      expect(screen).toMatchObject({ findings: null, findingsUnavailable: true });
    }));

  it("is 500 write_failed when the rating cannot be written, and the round stays open", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { roundId } = await playThrough(world);
      world.fail.next = true;
      const response = await world.call(world.handlers.complete, roundId, { felt_pressure: 3 });
      expect(response.status).toBe(500);
      expect(response.json.error.code).toBe("write_failed");
      const [round] = await db.select().from(s.rounds).where(eq(s.rounds.id, roundId));
      expect(round.completedAt).toBeNull();
      expect(world.generator.calls).toBe(0);
    }));
});

// The synthetic English CV's claims, in span order: the numbers the models are shown (db/seed-cv.ts).
const LATENCY = 2;
const MIGRATION = 3;
const REFUNDS = 4;
const CLAIM_COUNT = 7;

function events(name: string) {
  return logged.flatMap((line) => {
    try {
      const fields = JSON.parse(line) as Record<string, unknown>;
      return fields.event === name ? [fields] : [];
    } catch {
      return [];
    }
  });
}

/** The round's CV: its body and its claims in span order, as the models are shown them. */
async function roundCv(db: TestDb, roundId: string) {
  const [round] = await db.select().from(s.rounds).where(eq(s.rounds.id, roundId));
  const [cv] = await db.select().from(s.cvVersions).where(eq(s.cvVersions.id, round.cvVersionId));
  const claims = await db.select().from(s.cvClaims).where(eq(s.cvClaims.cvVersionId, cv.id)).orderBy(s.cvClaims.spanStart);
  const text = (number: number) => [...cv.body].slice(claims[number - 1].spanStart, claims[number - 1].spanEnd).join("");
  return { claims, text };
}

describe("CV grounding (US-11, 11 §3.12)", () => {
  const ANSWER = `I led the migration, um, and I cut cloud costs by 30 percent ${SENTINEL}.`;
  const UNSUPPORTED = "I cut cloud costs by 30 percent";

  it("shows the scorer the CV's claims, sliced from the stored body in span order", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { json } = await world.startRound();
      const seen: (readonly string[])[] = [];
      world.scorer.score = async (input) => {
        seen.push(input.claims);
        return uniformScores(3)(input);
      };
      await world.answerCurrent(json.round.id);
      await world.drainAfter();
      const { claims, text } = await roundCv(db, json.round.id);
      expect(seen[0]).toHaveLength(CLAIM_COUNT);
      expect(seen[0]).toEqual(claims.map((_, index) => text(index + 1)));
    }));

  it("stores what survives the check and counts what does not, with no text in the log", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { json } = await world.startRound();
      world.scorer.score = async (input) =>
        uniformScores(3, {
          citations: [
            { claim: MIGRATION, relation: "supported_by" },
            { claim: MIGRATION, relation: "supported_by" },
            { claim: LATENCY, relation: "contradicted_by" },
            { claim: CLAIM_COUNT + 1, relation: "supported_by" },
            { claim: 0, relation: "contradicted_by" },
          ],
          unsupported: [
            { quote: UNSUPPORTED, startHint: 20 },
            { quote: UNSUPPORTED, startHint: 0 },
            { quote: "I cut cloud costs by 40 percent", startHint: 20 },
            { quote: "i cut cloud costs", startHint: 20 },
          ],
          answeredLanguage: "ja",
        })(input);
      const { answerId } = await world.answerCurrent(json.round.id, ANSWER);
      await world.drainAfter();

      const [attempt] = await db.select().from(s.scoringAttempts).where(eq(s.scoringAttempts.answerId, answerId));
      expect(attempt).toMatchObject({ status: "ok", answeredLanguage: "ja" });

      const { claims } = await roundCv(db, json.round.id);
      const citations = await db.select().from(s.claimCitations).where(eq(s.claimCitations.answerId, answerId));
      expect(citations.map((citation) => [citation.cvClaimId, citation.relation]).sort()).toEqual(
        [
          [claims[MIGRATION - 1].id, "supported_by"],
          [claims[LATENCY - 1].id, "contradicted_by"],
        ].sort(),
      );

      const flags = await db.select().from(s.answerFlags).where(eq(s.answerFlags.answerId, answerId));
      expect(flags).toHaveLength(1);
      expect(flags[0]).toMatchObject({ kind: "unsupported", scoringAttemptId: attempt.id, userId: world.userId });
      // The quote is the stored text's own, by span: nothing the model wrote is kept.
      expect([...ANSWER].slice(flags[0].spanStart, flags[0].spanEnd).join("")).toBe(UNSUPPORTED);

      expect(events("scoring_ok")).toEqual([
        expect.objectContaining({
          claims: CLAIM_COUNT,
          claims_rejected: 0,
          citations: 2,
          citations_dropped: 2,
          flags: 1,
          flags_dropped: 2,
          answered_language: "ja",
        }),
      ]);
      for (const line of logged) {
        expect(line).not.toContain("cloud costs");
        expect(line).not.toContain(SENTINEL);
      }
    }));

  it("drops a quote that is only in the raw transcript: the span is into the corrected text", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { json } = await world.startRound();
      world.scorer.score = async (input) => uniformScores(3, { unsupported: [{ quote: SENTINEL, startHint: 0 }] })(input);
      const { answerId } = await world.answerCurrent(json.round.id, "I led the migration in six months.");
      await world.drainAfter();
      const [answer] = await db.select().from(s.answers).where(eq(s.answers.id, answerId));
      expect(answer.transcriptRaw).toContain(SENTINEL);
      expect(await db.select().from(s.answerFlags)).toHaveLength(0);
      expect(events("scoring_ok")[0]).toMatchObject({ flags: 0, flags_dropped: 1 });
    }));

  it("leaves a claim whose stored span no longer reads as the claim out of what can be cited", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { json } = await world.startRound();
      const { claims } = await roundCv(db, json.round.id);
      await db.update(s.cvClaims).set({ spanEnd: claims[0].spanEnd - 1 }).where(eq(s.cvClaims.id, claims[0].id));
      let shown = 0;
      world.scorer.score = async (input) => {
        shown = input.claims.length;
        // Number 1 is now the second stored claim: the first was never shown.
        return uniformScores(3, { citations: [{ claim: 1, relation: "supported_by" }] })(input);
      };
      await world.answerCurrent(json.round.id);
      await world.drainAfter();
      expect(shown).toBe(CLAIM_COUNT - 1);
      const citations = await db.select().from(s.claimCitations);
      expect(citations.map((citation) => citation.cvClaimId)).toEqual([claims[1].id]);
      expect(events("scoring_ok")[0]).toMatchObject({ claims: CLAIM_COUNT - 1, claims_rejected: 1 });
    }));

  it("stores no citation, flag or language for an attempt that fails", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { json } = await world.startRound();
      world.scorer.score = async () => {
        throw new ModelCallFailed("scoring", "upstream_500");
      };
      const { answerId } = await world.answerCurrent(json.round.id, ANSWER);
      await world.drainAfter();
      const [attempt] = await db.select().from(s.scoringAttempts).where(eq(s.scoringAttempts.answerId, answerId));
      expect(attempt).toMatchObject({ status: "failed", answeredLanguage: null });
      expect(await db.select().from(s.claimCitations)).toHaveLength(0);
      expect(await db.select().from(s.answerFlags)).toHaveLength(0);
    }));

  async function groundedRound(db: TestDb) {
    const world = await setUp(db);
    const started = await world.startRound();
    const roundId = started.json.round.id as string;
    const byAnswer = [
      uniformScores(3, { citations: [{ claim: MIGRATION, relation: "supported_by" }], unsupported: [{ quote: UNSUPPORTED, startHint: 20 }] }),
      uniformScores(3, { citations: [{ claim: LATENCY, relation: "contradicted_by" }], answeredLanguage: "ja" }),
      uniformScores(3),
    ];
    const corrected = [ANSWER, "I made checkout slower on purpose.", "I measured the outcome."];
    // A follow-up's answer is scored too; here it cites and flags nothing.
    world.scorer.score = async (input) => (byAnswer[corrected.indexOf(input.answer)] ?? uniformScores(3))(input);
    const answers = [];
    for (const text of corrected) answers.push(await world.answerPosition(roundId, text));
    await world.drainAfter();
    return { world, roundId, answers, ...(await roundCv(db, roundId)) };
  }

  it("sends the feedback call each answer's unsupported parts and only the claims the round never cited", () =>
    inRolledBackTransaction(async (db) => {
      const { world, roundId, text } = await groundedRound(db);
      await world.call(world.handlers.complete, roundId, { felt_pressure: 3 });
      const [input] = world.generator.inputs;
      // Each position's answer, then its follow-up's.
      expect(input.answers.map((answer) => [answer.position, answer.followUp, answer.unsupported])).toEqual([
        [1, false, [UNSUPPORTED]],
        [1, true, []],
        [2, false, []],
        [2, true, []],
        [3, false, []],
        [3, true, []],
      ]);
      // A contradicted claim was used: it is not untouched material.
      expect(input.unusedClaims).toHaveLength(CLAIM_COUNT - 2);
      expect(input.unusedClaims).not.toContain(text(MIGRATION));
      expect(input.unusedClaims).not.toContain(text(LATENCY));
      expect(input.unusedClaims).toContain(text(REFUNDS));
    }));

  it("stores only picks from the never-cited set it showed, at most three, and counts the rest", () =>
    inRolledBackTransaction(async (db) => {
      const { world, roundId, claims } = await groundedRound(db);
      // Shown: claims 1, 4, 5, 6, 7 as numbers 1 to 5.
      world.generator.generate = async () => ({ ...FIXTURE_FEEDBACK, untouched: [2, 9, 2, 0, 1, 5, 4] });
      const response = await world.call(world.handlers.complete, roundId, { felt_pressure: 3 });
      const picked = [claims[REFUNDS - 1].id, claims[0].id, claims[CLAIM_COUNT - 1].id];
      expect(response.status).toBe(201);
      expect(response.json.feedback.untouched_claim_ids).toEqual(picked);
      const [feedback] = await db.select().from(s.roundFeedback).where(eq(s.roundFeedback.roundId, roundId));
      expect(feedback.untouchedClaimIds).toEqual(picked);
      expect(events("round_feedback_written")).toEqual([
        expect.objectContaining({ never_cited: CLAIM_COUNT - 2, untouched: 3, untouched_dropped: 3 }),
      ]);
    }));

  it("writes the feedback with no untouched material when every pick is invented", () =>
    inRolledBackTransaction(async (db) => {
      const { world, roundId } = await groundedRound(db);
      world.generator.generate = async () => ({ ...FIXTURE_FEEDBACK, untouched: [MIGRATION + 40, -1] });
      const response = await world.call(world.handlers.complete, roundId, { felt_pressure: 3 });
      expect(response.status).toBe(201);
      expect(response.json.feedback.untouched_claim_ids).toEqual([]);
      expect(response.json.feedback.to_fix).toHaveLength(2);
    }));

  it("renders screen 8's grounding from stored spans, and says which answer was in the wrong language", () =>
    inRolledBackTransaction(async (db) => {
      const { world, roundId, text } = await groundedRound(db);
      world.generator.generate = async () => ({ ...FIXTURE_FEEDBACK, untouched: [2, 1] });
      await world.call(world.handlers.complete, roundId, { felt_pressure: 3 });
      const [round] = await db.select().from(s.rounds).where(eq(s.rounds.id, roundId));
      const screen = await feedbackScreen(db, round);
      expect(screen.grounding).toEqual({
        cvLabel: expect.stringMatching(/^CV v\d+$/),
        unsupported: [{ position: 1, quote: UNSUPPORTED }],
        untouched: [text(REFUNDS), text(1)],
      });
      // Only a mismatch is named: an answer in the round's language says nothing.
      expect(screen.answers.map((answer) => answer.answeredIn)).toEqual([null, "ja", null]);
    }));

  it("shows no grounding for a round scored before the CV check existed", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { roundId } = await playThrough(world);
      await world.drainAfter();
      await world.call(world.handlers.complete, roundId, { felt_pressure: 3 });
      // What a score-en-1.0 attempt looks like: ok, with no answered language (04).
      await db.update(s.scoringAttempts).set({ answeredLanguage: null });
      const [round] = await db.select().from(s.rounds).where(eq(s.rounds.id, roundId));
      const screen = await feedbackScreen(db, round);
      expect(screen.grounding).toBeNull();
      expect(screen.answers.map((answer) => answer.answeredIn)).toEqual([null, null, null]);
    }));

  it("does not carry an answer's flag onto a superseding attempt that raised none", () =>
    inRolledBackTransaction(async (db) => {
      const { world, roundId, answers } = await groundedRound(db);
      const [first] = await db.select().from(s.scoringAttempts).where(eq(s.scoringAttempts.answerId, answers[0].answerId));
      await db.insert(s.scoringAttempts).values({
        answerId: first.answerId,
        userId: first.userId,
        status: "ok",
        answeredLanguage: "en",
        cvVersionId: first.cvVersionId,
        rubricVersionId: first.rubricVersionId,
        generatorPromptVersion: first.generatorPromptVersion,
        modelId: first.modelId,
        scoringPromptVersion: first.scoringPromptVersion,
        isSuperseding: true,
        createdAt: new Date(Date.now() + 1_000),
      });
      await world.call(world.handlers.complete, roundId, { felt_pressure: 3 });
      expect(world.generator.inputs[0].answers[0].unsupported).toEqual([]);
      const [round] = await db.select().from(s.rounds).where(eq(s.rounds.id, roundId));
      expect((await feedbackScreen(db, round)).grounding?.unsupported).toEqual([]);
      // The first attempt's flag is still there: nothing is deleted (invariant 7).
      expect(await db.select().from(s.answerFlags)).toHaveLength(1);
    }));
});

describe("follow-ups: one per answer, written by submit (07 §5.9, 11 §3.1)", () => {
  const SLOT = { content_type: "audio/webm", expected_bytes: AUDIO.byteLength };

  /** The follow-up generator failing every call with `errorClass`. */
  function failFollowUps(world: World, errorClass: string) {
    world.followUps.generate = async () => {
      world.followUps.calls += 1;
      throw new ModelCallFailed("Follow-up generation", errorClass);
    };
  }

  async function followUpRows(db: TestDb) {
    return db.select().from(s.followUps);
  }

  it.each([
    ["realistic", true],
    ["practice", false],
  ] as const)("writes the row before submit returns, in a %s round: its text, its stamps and its tokens", (mode, speak) =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { json } = await world.startRound({ mode });
      const { answerId, submitted } = await world.answerCurrent(json.round.id);

      const [row] = await followUpRows(db);
      expect(row).toMatchObject({
        parentAnswerId: answerId,
        userId: world.userId,
        status: "generated",
        promptText: FOLLOW_UP_TEXT,
        modelId: world.followUps.modelId,
        promptVersion: "follow-up-en-fake",
        tokensIn: 400,
        tokensOut: 20,
        errorClass: null,
      });
      expect(submitted.status).toBe(200);
      // The follow-up shares its parent's position (06, 2026-09-27, confirm 3).
      expect(submitted.json.next).toEqual({
        kind: "follow_up",
        position: 1,
        parent_answer_id: answerId,
        follow_up_id: row.id,
        text: FOLLOW_UP_TEXT,
        prompt_version: "follow-up-en-fake",
        speak,
      });
      expect(submitted.json.progress).toEqual({ position: 1, of: 3 });
    }));

  it("generates from the question as asked and the corrected text, never the raw one, outside any transaction", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { json } = await world.startRound();
      const generate = world.followUps.generate;
      world.followUps.generate = async (input, options) => {
        expect(world.inTransaction()).toBe(false);
        return generate(input, options);
      };
      await world.answerCurrent(json.round.id, "Corrected text only.");
      expect(world.followUps.inputs).toEqual([
        { language: "en", roundType: "hr", prompt: json.prompt.text, answer: "Corrected text only." },
      ]);
    }));

  it("opens the follow-up's slot at its parent's position, with the stored text, and never as a first attempt", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { json } = await world.startRound();
      const parent = await world.answerCurrent(json.round.id);
      expect(parent.opened.json).toMatchObject({ kind: "question", position: 1, is_first_attempt: true });

      const opened = await world.call(world.handlers.open, json.round.id, SLOT);
      expect(opened.status).toBe(201);
      // A realistic round, and still not a first attempt: Progress never plots a follow-up (04 §3).
      expect(opened.json).toMatchObject({
        kind: "follow_up",
        position: 1,
        question_id: null,
        parent_answer_id: parent.answerId,
        is_first_attempt: false,
      });
      const [slot] = await db.select().from(s.answers).where(eq(s.answers.id, opened.json.answer_id));
      expect(slot).toMatchObject({
        questionId: null,
        parentAnswerId: parent.answerId,
        retryOfAnswerId: null,
        promptText: FOLLOW_UP_TEXT,
        position: 1,
        isFirstAttempt: false,
      });
      // The repeat lands on the same slot, as it does for a question.
      const again = await world.call(world.handlers.open, json.round.id, SLOT);
      expect(again.json.answer_id).toBe(opened.json.answer_id);
    }));

  it("stamps the follow-up's answer with the follow-up prompt version as its stamp 3", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { json } = await world.startRound();
      const { answerId, followUp } = await world.answerPosition(json.round.id);
      const [own] = await db.select().from(s.scoringAttempts).where(eq(s.scoringAttempts.answerId, followUp!.answerId));
      const [parent] = await db.select().from(s.scoringAttempts).where(eq(s.scoringAttempts.answerId, answerId));
      expect(own.generatorPromptVersion).toBe("follow-up-en-fake");
      expect(parent.generatorPromptVersion).toBe("set-piece-en-1.0");
      // The other three are the round's, the same on both.
      expect(own).toMatchObject({
        cvVersionId: parent.cvVersionId,
        rubricVersionId: parent.rubricVersionId,
        modelId: parent.modelId,
        scoringPromptVersion: parent.scoringPromptVersion,
      });
    }));

  it("asks no follow-up of a follow-up's own answer: one row and one call per question", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { answers } = await playThrough(world);
      expect(world.followUps.calls).toBe(3);
      expect(await count(db, s.followUps)).toBe(3);
      expect(await count(db, s.answers)).toBe(6);
      const parents = (await followUpRows(db)).map((row) => row.parentAnswerId).sort();
      expect(parents).toEqual(answers.map((answer) => answer.answerId).sort());
    }));

  it("asks no follow-up of a practice answer-again", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { json } = await world.startRound({ mode: "practice" });
      const { answerId } = await world.answerPosition(json.round.id);
      const [original] = await db.select().from(s.answers).where(eq(s.answers.id, answerId));
      // "Answer again" is a new row beside the first (04 `answers`), transcribed and not yet submitted.
      const [retry] = await db
        .insert(s.answers)
        .values({ ...original, id: undefined, retryOfAnswerId: original.id, audioS3Key: null, transcriptCorrected: null, rewriteMagnitude: null })
        .returning({ id: s.answers.id });

      const submitted = await world.call(world.handlers.submit, retry.id, { transcript_corrected: "I led it, better." });
      expect(submitted.status).toBe(200);
      expect(submitted.json.next).toMatchObject({ kind: "question", position: 2 });
      expect(world.followUps.calls).toBe(1);
      expect(await count(db, s.followUps)).toBe(1);
    }));

  it("stores a failed generation as missing, answers 502 once, and the same body then gets the degraded next", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { json } = await world.startRound();
      failFollowUps(world, "upstream_500");
      const { answerId, submitted } = await world.answerCurrent(json.round.id);

      // One retry, then the hole is a row: the round does not wait on a third call.
      expect(world.followUps.calls).toBe(2);
      expect(world.slept).toEqual([1_000]);
      const [attempt] = await db.select().from(s.scoringAttempts).where(eq(s.scoringAttempts.answerId, answerId));
      expect(submitted.status).toBe(502);
      expect(submitted.json.error).toMatchObject({
        code: "followup_generation_failed",
        detail: { answer_id: answerId, attempt_id: attempt.id, error_class: "upstream_500" },
      });
      const [row] = await followUpRows(db);
      expect(row).toMatchObject({
        parentAnswerId: answerId,
        status: "missing",
        promptText: null,
        modelId: world.followUps.modelId,
        promptVersion: "follow-up-en-fake",
        tokensIn: null,
        tokensOut: null,
        errorClass: "upstream_500",
      });
      // Not fatal: the answer is saved and is scored like any other.
      const [answer] = await db.select().from(s.answers).where(eq(s.answers.id, answerId));
      expect(answer.transcriptCorrected).toBe("I led the migration, um, in six months.");
      await world.drainAfter();
      expect(await db.select().from(s.scores)).toHaveLength(6);

      // The same body again: 200, the next question, and nothing generated a second time.
      const again = await world.call(world.handlers.submit, answerId, { transcript_corrected: answer.transcriptCorrected });
      expect(again.status).toBe(200);
      expect(again.json.scoring.attempt_id).toBe(attempt.id);
      expect(again.json.next).toMatchObject({ kind: "question", position: 2 });
      expect(again.json.progress).toEqual({ position: 2, of: 3 });
      expect(world.followUps.calls).toBe(2);
      expect(await count(db, s.followUps)).toBe(1);
    }));

  it.each([
    ["upstream_400", 1, []],
    ["malformed_output", 2, [1_000]],
    ["upstream_timeout", 2, [1_000]],
  ] as const)("on %s makes %i call(s) before recording the follow-up as missing", (errorClass, calls, slept) =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { json } = await world.startRound();
      failFollowUps(world, errorClass);
      const { submitted } = await world.answerCurrent(json.round.id);
      expect(submitted.json.error.detail.error_class).toBe(errorClass);
      expect(world.followUps.calls).toBe(calls);
      expect(world.slept).toEqual(slept);
      expect((await followUpRows(db))[0]).toMatchObject({ status: "missing", errorClass });
    }));

  it("stores the follow-up a second call produced: generated, and no 502", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { json } = await world.startRound();
      const generate = world.followUps.generate;
      world.followUps.generate = async (input, options) => {
        if (world.followUps.calls === 0) {
          world.followUps.calls += 1;
          throw new ModelCallFailed("Follow-up generation", "upstream_503");
        }
        return generate(input, options);
      };
      const { submitted } = await world.answerCurrent(json.round.id);
      expect(submitted.status).toBe(200);
      expect(submitted.json.next.kind).toBe("follow_up");
      expect(world.followUps.calls).toBe(2);
      expect((await followUpRows(db))[0]).toMatchObject({ status: "generated", errorClass: null });
    }));

  it.each([
    ["realistic", "pressure"],
    ["practice", "feedback"],
  ] as const)("degrades next past the last question's missing follow-up in a %s round: %s", (mode, kind) =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { json } = await world.startRound({ mode });
      await world.answerPosition(json.round.id);
      await world.answerPosition(json.round.id);
      failFollowUps(world, "upstream_500");
      const { answerId, submitted } = await world.answerCurrent(json.round.id, "The last one.");
      expect(submitted.status).toBe(502);

      const again = await world.call(world.handlers.submit, answerId, { transcript_corrected: "The last one." });
      expect(again.json.next).toEqual({ kind });
      expect(again.json.progress).toEqual({ position: 3, of: 3 });
      // The round closes with the hole in it.
      await world.drainAfter();
      const completed = await world.call(world.handlers.complete, json.round.id, mode === "realistic" ? { felt_pressure: 3 } : {});
      expect(completed.status).toBe(201);
      expect(completed.json.scoring).toEqual({ ok: 5, pending: 0, failed: 0 });
    }));

  it("resumes on the stored follow-up: the same text on every read, and no model call", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { json } = await world.startRound();
      const { answerId, submitted } = await world.answerCurrent(json.round.id);
      const [round] = await db.select().from(s.rounds).where(eq(s.rounds.id, json.round.id));

      for (let read = 0; read < 2; read += 1) {
        const frame = await roundFrame(db, world.userId, round);
        expect(frame !== "complete" && frame.start).toEqual({
          kind: "question",
          position: 1,
          text: FOLLOW_UP_TEXT,
          followUpVersion: "follow-up-en-fake",
          again: null,
          transcript: null,
          openAnswerId: null,
          uploadConfirmed: false,
        });
        expect(frame !== "complete" && frame.followUpVersions).toEqual(["follow-up-en-fake"]);
      }
      // A retried submit reads the same row too.
      const again = await world.call(world.handlers.submit, answerId, { transcript_corrected: "I led the migration, um, in six months." });
      expect(again.json.next).toEqual(submitted.json.next);
      expect(world.followUps.calls).toBe(1);
      expect(await count(db, s.followUps)).toBe(1);

      // And with the follow-up's take transcribed, the reload lands on its transcript.
      const slot = await world.call(world.handlers.open, json.round.id, SLOT);
      world.store.put(world.store.presigned.at(-1)!.key, AUDIO);
      await world.call(world.handlers.transcribe, slot.json.answer_id, {});
      const frame = await roundFrame(db, world.userId, round);
      expect(frame !== "complete" && frame.start).toMatchObject({
        kind: "question",
        position: 1,
        text: FOLLOW_UP_TEXT,
        transcript: { answerId: slot.json.answer_id },
      });
      expect(world.followUps.calls).toBe(1);
    }));

  describe("a submit that died between the answer's commit and its follow-up's row", () => {
    /** The answer is committed and scored; the follow-up's own write fails, so no row exists. */
    async function strand(world: World, roundId: string) {
      const generate = world.followUps.generate;
      world.followUps.generate = async (input, options) => {
        world.fail.next = true;
        return generate(input, options);
      };
      const stranded = await world.answerCurrent(roundId, "I owned the rollout.");
      world.followUps.generate = generate;
      return stranded;
    }

    it("is 500 write_failed with the answer saved, and the same body then writes the follow-up once", () =>
      inRolledBackTransaction(async (db) => {
        const world = await setUp(db);
        const { json } = await world.startRound();
        const { answerId, submitted } = await strand(world, json.round.id);
        expect(submitted.status).toBe(500);
        expect(submitted.json.error).toMatchObject({ code: "write_failed", detail: { answer_id: answerId, error_class: "pg_57014" } });
        expect(await count(db, s.followUps)).toBe(0);
        const [answer] = await db.select().from(s.answers).where(eq(s.answers.id, answerId));
        expect(answer.transcriptCorrected).toBe("I owned the rollout.");
        expect(await db.select().from(s.scoringAttempts)).toHaveLength(1);

        const again = await world.call(world.handlers.submit, answerId, { transcript_corrected: "I owned the rollout." });
        expect(again.status).toBe(200);
        expect(again.json.next).toMatchObject({ kind: "follow_up", position: 1, parent_answer_id: answerId, text: FOLLOW_UP_TEXT });
        expect(await count(db, s.followUps)).toBe(1);
        // Still one attempt: the repeat made the follow-up, not a second scoring run.
        expect(await db.select().from(s.scoringAttempts)).toHaveLength(1);
      }));

    it("reloads onto the saved answer, and neither a slot nor complete gets past it", () =>
      inRolledBackTransaction(async (db) => {
        const world = await setUp(db);
        const { json } = await world.startRound();
        const { answerId } = await strand(world, json.round.id);
        const [round] = await db.select().from(s.rounds).where(eq(s.rounds.id, json.round.id));
        expect((await readRoundStep(db, round)).kind).toBe("follow_up_due");

        const frame = await roundFrame(db, world.userId, round);
        expect(frame !== "complete" && frame.start).toEqual({
          kind: "follow_up_due",
          position: 1,
          text: json.prompt.text,
          answerId,
          corrected: "I owned the rollout.",
        });
        // No second answer to the question, and no skipping its follow-up: only `submit` moves on.
        const answersBefore = await count(db, s.answers);
        const slot = await world.call(world.handlers.open, json.round.id, SLOT);
        expect(slot.status).toBe(422);
        expect(slot.json.error).toMatchObject({ code: "answer_already_submitted", detail: { round_id: json.round.id, answer_id: answerId } });
        expect(await count(db, s.answers)).toBe(answersBefore);
        const completed = await world.call(world.handlers.complete, json.round.id, { felt_pressure: 3 });
        expect(completed.status).toBe(409);
        expect(completed.json.error.code).toBe("round_not_complete");
        expect(world.followUps.calls).toBe(1);
      }));

    it("generates nothing for an abandoned round: 409, no model call and no row", () =>
      inRolledBackTransaction(async (db) => {
        const world = await setUp(db);
        const { json } = await world.startRound();
        const { answerId } = await strand(world, json.round.id);
        await abandonBy(world, db);

        const again = await world.call(world.handlers.submit, answerId, { transcript_corrected: "I owned the rollout." });
        expect(again.status).toBe(409);
        expect(again.json.error.code).toBe("round_abandoned");
        expect(world.followUps.calls).toBe(1);
        expect(await count(db, s.followUps)).toBe(0);
      }));
  });

  it("writes no row when the round is abandoned while the follow-up is being generated", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { json } = await world.startRound();
      const generate = world.followUps.generate;
      world.followUps.generate = async (input, options) => {
        await abandonBy(world, db);
        return generate(input, options);
      };
      const { submitted } = await world.answerCurrent(json.round.id);
      expect(submitted.status).toBe(409);
      expect(submitted.json.error.code).toBe("round_abandoned");
      expect(await count(db, s.followUps)).toBe(0);
    }));

  it("keeps the row a concurrent submit stored first: one follow-up, and this call returns it", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { json } = await world.startRound();
      // The other call's row lands while this one's generation is failing.
      world.followUps.generate = async (input) => {
        world.followUps.calls += 1;
        const [parent] = await db.select({ id: s.answers.id }).from(s.answers).where(eq(s.answers.promptText, input.prompt));
        await db.insert(s.followUps).values({
          parentAnswerId: parent.id,
          userId: world.userId,
          status: "generated",
          promptText: "What did the other call ask?",
          modelId: world.followUps.modelId,
          promptVersion: "follow-up-en-fake",
        });
        throw new ModelCallFailed("Follow-up generation", "upstream_400");
      };
      const { submitted } = await world.answerCurrent(json.round.id);
      // Not a 502: this call's failure wrote nothing, so there is no hole to report.
      expect(submitted.status).toBe(200);
      expect(submitted.json.next).toMatchObject({ kind: "follow_up", text: "What did the other call ask?" });
      expect(await count(db, s.followUps)).toBe(1);
    }));

  it("is 409 round_not_complete while a follow-up is unanswered", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { json } = await world.startRound();
      await world.answerPosition(json.round.id);
      await world.answerPosition(json.round.id);
      await world.answerCurrent(json.round.id);
      const response = await world.call(world.handlers.complete, json.round.id, { felt_pressure: 3 });
      expect(response.status).toBe(409);
      expect(response.json.error.code).toBe("round_not_complete");
    }));

  it("shows each answer's follow-up on screen 8: asked with its scoring, or missing", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { json } = await world.startRound();
      await world.answerPosition(json.round.id);
      const generate = world.followUps.generate;
      failFollowUps(world, "upstream_400");
      const second = await world.answerCurrent(json.round.id, "The second one.");
      world.followUps.generate = generate;
      await world.call(world.handlers.submit, second.answerId, { transcript_corrected: "The second one." });
      await world.answerPosition(json.round.id);
      await world.drainAfter();
      await world.call(world.handlers.complete, json.round.id, { felt_pressure: 3 });

      const [round] = await db.select().from(s.rounds).where(eq(s.rounds.id, json.round.id));
      const screen = await feedbackScreen(db, round);
      // One page per bank question; the follow-up hangs off it and is not a page of its own.
      expect(screen.answers.map((answer) => answer.position)).toEqual([1, 2, 3]);
      expect(screen.answers.map((answer) => answer.followUp)).toMatchObject([
        { kind: "asked", text: FOLLOW_UP_TEXT, status: "ok" },
        { kind: "missing" },
        { kind: "asked", text: FOLLOW_UP_TEXT, status: "ok" },
      ]);
      expect(screen.answers[1].followUp).toEqual({ kind: "missing" });
      expect(screen.stamps.generatorVersions).toContain("follow-up-en-fake");
    }));

  it("carries no follow-up text into a log line or an error envelope", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { roundId, answers } = await playThrough(world);
      // Every refusal a follow-up's answer can meet, after the text exists.
      await world.call(world.handlers.submit, answers[0].followUp!.answerId, { transcript_corrected: "Something else." });
      world.fail.next = true;
      await world.call(world.handlers.complete, roundId, { felt_pressure: 3 });
      await world.drainAfter();
      await world.call(world.handlers.complete, roundId, { felt_pressure: 3 });
      expect(world.responses.some((text) => text.includes(FOLLOW_UP_SENTINEL))).toBe(true);
      for (const text of logged) expect(text).not.toContain(FOLLOW_UP_SENTINEL);
      // `next.text` returns the follow-up to its owner, by design; no error envelope carries it.
      for (const text of world.responses) if (text.includes('"error"')) expect(text).not.toContain(FOLLOW_UP_SENTINEL);
    }));
});

// #74: how each question could have been answered, from the round's CV version and what was said.
// Written once per answer at `complete`, beside the feedback, and by the retry for what is lacking.
describe("model answers (#74, 07 §5.12, §5.19)", () => {
  // Recognisable text in a model answer: stored and shown to its owner, and logged nowhere.
  // Its digits follow a letter: digits at a word boundary are a figure, and the server marks one the
  // CV does not hold (04 `model_answers`).
  const MODEL_SENTINEL = "QUOKKA-SENTINEL-X6120";
  const MODEL_ANSWER = {
    ...FIXTURE_MODEL_ANSWER,
    answer: `At ${MODEL_SENTINEL} I led the migration and finished it in six months, with a team of four.`,
    unsupported: [{ quote: "a team of four", startHint: 70 }],
  };
  const modelAnswersOf = (db: TestDb, roundId: string) =>
    db
      .select({ modelAnswer: s.modelAnswers, answer: s.answers })
      .from(s.modelAnswers)
      .innerJoin(s.answers, eq(s.answers.id, s.modelAnswers.answerId))
      .where(eq(s.answers.roundId, roundId));

  // 07 §5.12: a slow call is not what the feedback waits for. It is `pending`, and lands in `after()`.
  it("answers without a call still running past the wait, and stores it behind the response", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { roundId } = await playThrough(world);
      await world.drainAfter();
      const respond = world.modelAnswers.generate;
      let release = () => {};
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      let call = 0;
      world.modelAnswers.generate = async (input, options) => {
        call += 1;
        if (call === 2) await held;
        return respond(input, options);
      };
      const response = await world.call(world.completeWith({ modelAnswerWaitMs: 0 }), roundId, { felt_pressure: 3 });
      expect(response.status).toBe(201);
      // The five that had finished are stored whatever the wait; the one still running is not waited for.
      expect(response.json.model_answers).toEqual({ written: 5, failed: 0, pending: 1 });
      expect(response.json.feedback.to_fix).toHaveLength(2);
      expect(await modelAnswersOf(db, roundId)).toHaveLength(5);

      release();
      await world.drainAfter();
      expect(await modelAnswersOf(db, roundId)).toHaveLength(6);
      expect(world.modelAnswers.calls).toBe(6);
    }));

  it("leaves a gap, and no row, when the call it did not wait for fails", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { roundId } = await playThrough(world);
      await world.drainAfter();
      const respond = world.modelAnswers.generate;
      let fail = () => {};
      const held = new Promise<never>((_, reject) => {
        fail = () => reject(new ModelCallFailed("Model answer", "upstream_timeout"));
      });
      let call = 0;
      world.modelAnswers.generate = async (input, options) => {
        call += 1;
        if (call === 2) await held;
        return respond(input, options);
      };
      const errors = vi.spyOn(console, "error").mockImplementation(() => {});
      const response = await world.call(world.completeWith({ modelAnswerWaitMs: 0 }), roundId, { felt_pressure: 3 });
      expect(response.json.model_answers).toEqual({ written: 5, failed: 0, pending: 1 });

      fail();
      await world.drainAfter();
      expect(await modelAnswersOf(db, roundId)).toHaveLength(5);
      expect(errors.mock.calls.map(([line]) => JSON.parse(line as string).event)).toContain("model_answer_call_failed");

      // The retry writes it, as it does one that failed in front of the response.
      world.modelAnswers.generate = respond;
      const retried = await world.call(world.handlers.modelAnswers, roundId, {});
      expect(retried.json).toEqual({ model_answers: { written: 1, failed: 0 } });
    }));

  it("writes one per answer at complete, follow-ups included, from the CV's claims and the corrected text", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { roundId } = await playThrough(world);
      await world.drainAfter();
      const respond = world.modelAnswers.generate;
      world.modelAnswers.generate = async (input, options) => {
        // Outside any transaction, like every model call of the round (06, 2026-09-27).
        expect(world.inTransaction()).toBe(false);
        return respond(input, options);
      };
      const response = await world.call(world.handlers.complete, roundId, { felt_pressure: 3 });
      expect(response.status).toBe(201);
      expect(response.json.model_answers).toEqual({ written: 6, failed: 0, pending: 0 });

      expect(world.modelAnswers.calls).toBe(6);
      const [cv] = await db.select().from(s.cvVersions).where(and(eq(s.cvVersions.userId, world.userId), eq(s.cvVersions.language, "en")));
      const claims = await db.select().from(s.cvClaims).where(eq(s.cvClaims.cvVersionId, cv.id));
      for (const input of world.modelAnswers.inputs) {
        expect(input.claims).toHaveLength(claims.length);
        expect(input.rubric.language).toBe("en");
        expect(input.roundType).toBe("hr");
        expect(input.roleContext).toEqual({ kind: "general" });
        // The corrected text, never the raw one the transcriber heard.
        expect(input.answer).not.toContain(SENTINEL);
      }
      // A follow-up is sent with the question it followed and what was said to it.
      const followUps = world.modelAnswers.inputs.filter((input) => input.parent !== null);
      expect(followUps).toHaveLength(3);
      expect(followUps.every((input) => input.prompt === FOLLOW_UP_TEXT)).toBe(true);
      expect(followUps.every((input) => input.parent!.answer === "I led the migration, um, in six months.")).toBe(true);

      const rows = await modelAnswersOf(db, roundId);
      expect(rows).toHaveLength(6);
      expect(new Set(rows.map((row) => row.answer.id)).size).toBe(6);
      for (const { modelAnswer } of rows) {
        expect(modelAnswer).toMatchObject({
          userId: world.userId,
          body: FIXTURE_MODEL_ANSWER.answer,
          bodyTranslated: null,
          modelId: "fake-model-answer-2026-01-01",
          promptVersion: "model-answer-en-fake",
          tokensIn: 2_000,
          tokensOut: 300,
        });
        // The mark is a span of the stored body, found there from the model's quote.
        expect(modelAnswer.unsupportedSpans).toHaveLength(1);
        const [span] = modelAnswer.unsupportedSpans;
        expect(Array.from(modelAnswer.body).slice(span.start, span.end).join("")).toBe("a team of four");
      }
    }));

  it("stores a span only where the quote stands in the answer, and counts what it drops", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { roundId } = await playThrough(world);
      await world.drainAfter();
      world.modelAnswers.generate = async () => ({
        ...MODEL_ANSWER,
        unsupported: [...MODEL_ANSWER.unsupported, { quote: "a team of five", startHint: 70 }, { quote: "", startHint: 0 }],
      });
      await world.call(world.handlers.complete, roundId, { felt_pressure: 3 });
      const rows = await modelAnswersOf(db, roundId);
      expect(rows.every((row) => row.modelAnswer.unsupportedSpans.length === 1)).toBe(true);
      const line = logged.map((text) => JSON.parse(text)).find((entry) => entry.event === "model_answers_generated");
      expect(line).toMatchObject({ round_id: roundId, wanted: 6, generated: 6, failed: 0, unsupported_spans: 6, unsupported_dropped: 12 });
    }));

  // 04 `model_answers`: a figure in digits that neither the CV nor the candidate's words hold is marked
  // by the server, whatever the writing call marked.
  it("marks a figure neither the CV nor the candidate's words hold, though the model marked nothing", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { roundId } = await playThrough(world);
      await world.drainAfter();
      world.modelAnswers.generate = async () => ({
        ...MODEL_ANSWER,
        answer: "I led the migration and cut failed payments by 83%.",
        unsupported: [],
      });
      await world.call(world.handlers.complete, roundId, { felt_pressure: 3 });
      const rows = await modelAnswersOf(db, roundId);
      expect(rows).toHaveLength(6);
      for (const { modelAnswer } of rows) {
        const marked = modelAnswer.unsupportedSpans.map((span) => Array.from(modelAnswer.body).slice(span.start, span.end).join(""));
        expect(marked).toEqual(["83%"]);
      }
    }));

  it("leaves a failed call's answer without a row, completes the round all the same, and the retry writes only that one", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { roundId } = await playThrough(world);
      await world.drainAfter();
      const respond = world.modelAnswers.generate;
      let call = 0;
      world.modelAnswers.generate = async (input, options) => {
        call += 1;
        if (call === 2) throw new ModelCallFailed("Model answer", "upstream_500");
        return respond(input, options);
      };
      const response = await world.call(world.handlers.complete, roundId, { felt_pressure: 3 });
      expect(response.status).toBe(201);
      expect(response.json.model_answers).toEqual({ written: 5, failed: 1, pending: 0 });
      expect(await count(db, s.roundFeedback)).toBe(1);
      expect(await modelAnswersOf(db, roundId)).toHaveLength(5);

      const [round] = await db.select().from(s.rounds).where(eq(s.rounds.id, roundId));
      const lacking = (await feedbackScreen(db, round)).answers.flatMap((answer) => [
        answer.modelAnswer,
        answer.followUp?.kind === "asked" ? answer.followUp.modelAnswer : null,
      ]);
      expect(lacking.filter((modelAnswer) => modelAnswer === null)).toHaveLength(1);

      world.modelAnswers.generate = respond;
      const retried = await world.call(world.handlers.modelAnswers, roundId, {});
      expect(retried.status).toBe(201);
      expect(retried.json).toEqual({ model_answers: { written: 1, failed: 0 } });
      // Five calls answered at complete, and one more now: only the answer that lacked one.
      expect(world.modelAnswers.calls).toBe(6);
      expect(await modelAnswersOf(db, roundId)).toHaveLength(6);

      // A round that lacks none makes no model call.
      const again = await world.call(world.handlers.modelAnswers, roundId, {});
      expect(again.status).toBe(200);
      expect(again.json).toEqual({ model_answers: { written: 0, failed: 0 } });
      expect(world.modelAnswers.calls).toBe(6);
    }));

  it("is 502 model_answer_generation_failed when a retry's call fails, keeping what the others wrote", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { roundId } = await playThrough(world);
      await world.drainAfter();
      const respond = world.modelAnswers.generate;
      world.modelAnswers.generate = async () => {
        throw new ModelCallFailed("Model answer", "upstream_timeout");
      };
      const completed = await world.call(world.handlers.complete, roundId, { felt_pressure: 3 });
      expect(completed.status).toBe(201);
      expect(completed.json.model_answers).toEqual({ written: 0, failed: 6, pending: 0 });

      let call = 0;
      world.modelAnswers.generate = async (input, options) => {
        call += 1;
        if (call > 4) throw new ModelCallFailed("Model answer", "malformed_output");
        return respond(input, options);
      };
      const retried = await world.call(world.handlers.modelAnswers, roundId, {});
      expect(retried.status).toBe(502);
      expect(retried.json.error).toEqual({
        code: "model_answer_generation_failed",
        message: "Not every model answer was written; the round is complete.",
        detail: { round_id: roundId, written: 4, failed: 2, error_class: "malformed_output" },
      });
      expect(await modelAnswersOf(db, roundId)).toHaveLength(4);
    }));

  it("writes them when the feedback is not: they wait for no score, and the feedback retry writes none", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { roundId } = await playThrough(world);
      // No score has landed: the bound runs out and no feedback is written.
      const response = await world.call(world.handlers.complete, roundId, { felt_pressure: 3 });
      expect(response.status).toBe(502);
      expect(response.json.error.code).toBe("feedback_generation_failed");
      expect(await count(db, s.roundFeedback)).toBe(0);
      expect(await modelAnswersOf(db, roundId)).toHaveLength(6);

      await world.drainAfter();
      expect((await world.call(world.handlers.feedback, roundId, {})).status).toBe(201);
      expect(world.modelAnswers.calls).toBe(6);
    }));

  it("writes a round completed before model answers existed its model answers, on the retry", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { roundId } = await playThrough(world);
      await world.drainAfter();
      await world.call(world.handlers.complete, roundId, { felt_pressure: 3 });
      await db.execute(sql`delete from model_answers`);
      const [round] = await db.select().from(s.rounds).where(eq(s.rounds.id, roundId));
      expect((await feedbackScreen(db, round)).answers.every((answer) => answer.modelAnswer === null)).toBe(true);

      const retried = await world.call(world.handlers.modelAnswers, roundId, {});
      expect(retried.status).toBe(201);
      expect(retried.json).toEqual({ model_answers: { written: 6, failed: 0 } });
      // The round feedback is written once and is not touched.
      expect(world.generator.calls).toBe(1);
    }));

  it("keeps the row a concurrent call stored first", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { roundId, answers } = await playThrough(world);
      await world.drainAfter();
      const respond = world.modelAnswers.generate;
      let raced = false;
      world.modelAnswers.generate = async (input, options) => {
        if (!raced) {
          raced = true;
          await db.insert(s.modelAnswers).values({
            answerId: answers[0].answerId,
            userId: world.userId,
            body: "Stored first.",
            modelId: "fake-model-answer-2026-01-01",
            promptVersion: "model-answer-en-fake",
          });
        }
        return respond(input, options);
      };
      const response = await world.call(world.handlers.complete, roundId, { felt_pressure: 3 });
      expect(response.json.model_answers).toEqual({ written: 5, failed: 0, pending: 0 });
      const rows = await modelAnswersOf(db, roundId);
      expect(rows).toHaveLength(6);
      expect(rows.find((row) => row.answer.id === answers[0].answerId)!.modelAnswer.body).toBe("Stored first.");
    }));

  it("writes none for a practice answer-again: the question has its model answer", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { json } = await world.startRound({ mode: "practice" });
      const { answerId } = await world.answerPosition(json.round.id);
      const [original] = await db.select().from(s.answers).where(eq(s.answers.id, answerId));
      const [retry] = await db
        .insert(s.answers)
        .values({ ...original, id: undefined, retryOfAnswerId: original.id, audioS3Key: null, transcriptCorrected: null, rewriteMagnitude: null })
        .returning({ id: s.answers.id });
      await world.call(world.handlers.submit, retry.id, { transcript_corrected: "I led it, better." });
      for (let position = 2; position <= 3; position += 1) await world.answerPosition(json.round.id);
      await world.drainAfter();

      const response = await world.call(world.handlers.complete, json.round.id, {});
      expect(response.status).toBe(201);
      expect(response.json.model_answers).toEqual({ written: 6, failed: 0, pending: 0 });
      expect((await modelAnswersOf(db, json.round.id)).map((row) => row.answer.id)).not.toContain(retry.id);
    }));

  it("is 500 write_failed when the retry cannot store them, and a later retry writes them", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { roundId } = await playThrough(world);
      await world.drainAfter();
      await world.call(world.handlers.complete, roundId, { felt_pressure: 3 });
      await db.execute(sql`delete from model_answers`);
      world.fail.next = true;
      const failed = await world.call(world.handlers.modelAnswers, roundId, {});
      expect(failed.status).toBe(500);
      expect(failed.json.error).toMatchObject({ code: "write_failed", detail: { round_id: roundId, error_class: "pg_57014" } });
      expect(await modelAnswersOf(db, roundId)).toHaveLength(0);
      expect((await world.call(world.handlers.modelAnswers, roundId, {})).status).toBe(201);
      expect(await modelAnswersOf(db, roundId)).toHaveLength(6);
    }));

  it("refuses the retry with no session, for another user's round, and for a round that is still open", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { json } = await world.startRound();
      const roundId = json.round.id as string;
      expect((await world.call(world.handlers.modelAnswers, roundId, {}, { signedIn: false })).status).toBe(401);
      expect((await world.call(world.handlers.modelAnswers, "not-a-uuid", {})).status).toBe(404);

      const open = await world.call(world.handlers.modelAnswers, roundId, {});
      expect(open.status).toBe(409);
      expect(open.json.error.code).toBe("round_not_complete");

      await db.update(s.rounds).set({ userId: await insertOtherUser(db), completedAt: new Date() }).where(eq(s.rounds.id, roundId));
      expect((await world.call(world.handlers.modelAnswers, roundId, {})).status).toBe(404);
      expect(world.modelAnswers.calls).toBe(0);
      expect(await count(db, s.modelAnswers)).toBe(0);
    }));

  it("shows screen 8 what was said beside its model answer, marked by the stored spans", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { roundId } = await playThrough(world);
      await world.drainAfter();
      await world.call(world.handlers.complete, roundId, { felt_pressure: 3 });
      const [round] = await db.select().from(s.rounds).where(eq(s.rounds.id, roundId));
      const screen = await feedbackScreen(db, round);
      const [first] = screen.answers;
      expect(first.own).toBe("I led the migration, um, in six months.");
      expect(first.modelAnswer).toEqual({
        segments: [
          { text: "I led the payments migration and finished it in six months. I planned the cutover with ", unsupported: false },
          { text: "a team of four", unsupported: true },
          { text: ".", unsupported: false },
        ],
        translated: null,
      });
      // The follow-up's own answer and model answer hang off the question, as its row does.
      expect(first.followUp).toMatchObject({ kind: "asked", own: "It was my call, um, in the end." });
      expect(first.followUp?.kind === "asked" ? first.followUp.modelAnswer?.segments.map((segment) => segment.text).join("") : null).toBe(
        FIXTURE_MODEL_ANSWER.answer,
      );
    }));

  it("stores a Japanese round's model answer with its English, each with its own spans", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { roundId } = await playThrough(world, { language: "ja" });
      await world.drainAfter();
      const response = await world.call(world.handlers.complete, roundId, { felt_pressure: 3 });
      expect(response.json.model_answers).toEqual({ written: 6, failed: 0, pending: 0 });
      expect(world.modelAnswers.inputs.every((input) => input.rubric.language === "ja")).toBe(true);

      const [{ modelAnswer }] = await modelAnswersOf(db, roundId);
      expect(modelAnswer.promptVersion).toBe("model-answer-ja-fake");
      expect(modelAnswer.body).toBe(FIXTURE_MODEL_ANSWER_JA.answer);
      const [span] = modelAnswer.unsupportedSpans;
      expect(Array.from(modelAnswer.body).slice(span.start, span.end).join("")).toBe("4名のチーム");
      const translated = modelAnswer.bodyTranslated as { language: string; body: string; unsupported_spans: { start: number; end: number }[] };
      expect(translated.language).toBe("en");
      expect(translated.body).toBe(FIXTURE_MODEL_ANSWER_JA.translated!.answer);
      expect(translated.unsupported_spans.map((mark) => translated.body.slice(mark.start, mark.end))).toEqual(["a team of four"]);

      const [round] = await db.select().from(s.rounds).where(eq(s.rounds.id, roundId));
      const screen = await feedbackScreen(db, round);
      expect(screen.answers[0].modelAnswer?.translated?.filter((segment) => segment.unsupported)).toEqual([
        { text: "a team of four", unsupported: true },
      ]);
    }));

  it("carries no model answer into a log line or an envelope, on success or failure", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { roundId } = await playThrough(world);
      await world.drainAfter();
      let call = 0;
      world.modelAnswers.generate = async () => {
        call += 1;
        if (call === 3) throw new ModelCallFailed("Model answer", "upstream_500");
        return MODEL_ANSWER;
      };
      await world.call(world.handlers.complete, roundId, { felt_pressure: 3 });
      world.fail.next = true;
      await world.call(world.handlers.modelAnswers, roundId, {});
      await world.call(world.handlers.modelAnswers, roundId, {});
      expect((await modelAnswersOf(db, roundId)).some((row) => row.modelAnswer.body.includes(MODEL_SENTINEL))).toBe(true);
      for (const text of [...world.responses, ...logged]) expect(text).not.toContain(MODEL_SENTINEL);
    }));
});

describe("what leaves the handlers (11 §3.10, §3.16)", () => {
  it("carries no transcript text into any envelope or log line, on success or failure", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { roundId } = await playThrough(world);
      world.fail.next = true;
      await world.call(world.handlers.complete, roundId, { felt_pressure: 3 });
      await world.drainAfter();
      for (const text of [...world.responses, ...logged]) {
        // The raw transcript is returned to its owner by transcribe, by design; nothing else carries it.
        if (text.includes('"transcript_raw"')) continue;
        expect(text).not.toContain(SENTINEL);
      }
    }));

  it("scores no composite anywhere in a response", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { roundId } = await playThrough(world);
      await world.drainAfter();
      await world.call(world.handlers.complete, roundId, { felt_pressure: 3 });
      for (const text of world.responses) expect(text).not.toMatch(/total|average|overall|composite/i);
    }));
});

describe("a Japanese round (#43)", () => {
  const JA = { language: "ja" };

  it("is scored against the Japanese CV and rubric `ja`, and asks Japanese questions only", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { status, json } = await world.startRound(JA);
      expect(status).toBe(201);
      expect(json.round).toMatchObject({ round_type: "hr", language: "ja", mode: "realistic", length: 3 });
      expect(json.round.stamps).toEqual({
        cv_version_label: "応募書類 v1",
        rubric_version_label: "v1.0",
        scoring_model_id: world.scorer.modelId,
        scoring_prompt_version: "score-ja-fake",
      });
      const [stored] = await db.select().from(s.rounds).where(eq(s.rounds.id, json.round.id));
      const [rubric] = await db.select().from(s.rubricVersions).where(eq(s.rubricVersions.id, stored.rubricVersionId));
      expect(rubric.language).toBe("ja");
      expect((rubric.dimensions as { key: string }[]).map((dimension) => dimension.key)).toContain("keigo");

      const chosen = await db
        .select({ origin: s.questions.origin, language: s.questions.language, stamp: s.questions.generatorPromptVersion, body: s.questions.body })
        .from(s.roundQuestions)
        .innerJoin(s.questions, eq(s.questions.id, s.roundQuestions.questionId))
        .where(eq(s.roundQuestions.roundId, json.round.id))
        .orderBy(s.roundQuestions.position);
      expect(chosen.map((row) => row.origin)).toEqual(["set_piece", "generated", "generated"]);
      expect(chosen.every((row) => row.language === "ja")).toBe(true);
      // The self-introduction first, under the Japanese content version (stamp 3).
      expect(chosen[0]).toMatchObject({ stamp: "set-piece-ja-1.0", body: "まず、簡単に自己紹介をお願いします。" });
      expect(json.prompt.text).toBe(chosen[0].body);
    }));

  it("leaves the English bank alone: an English round still asks English questions only", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { json } = await world.startRound({ length: 7 });
      const chosen = await db
        .select({ language: s.questions.language })
        .from(s.roundQuestions)
        .innerJoin(s.questions, eq(s.questions.id, s.roundQuestions.questionId))
        .where(eq(s.roundQuestions.roundId, json.round.id));
      expect(chosen).toHaveLength(7);
      expect(chosen.every((row) => row.language === "en")).toBe(true);
    }));

  // 04 `answers`, 06 2026-09-27 confirm 4: characters per minute of transcript_raw.
  it("stores the pace in characters per minute of the raw transcript", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { json } = await world.startRound(JA);
      const opened = await world.call(world.handlers.open, json.round.id, { content_type: "audio/webm", expected_bytes: 10 });
      world.store.put(world.store.presigned[0].key, AUDIO);
      const transcribed = await world.call(world.handlers.transcribe, opened.json.answer_id, {});
      expect(transcribed.status).toBe(200);
      expect(transcribed.json.transcript_raw).toBe(HEARD_JA);
      expect(transcribed.json.words_per_minute).toBeCloseTo(HEARD_JA_CHARACTERS / 1.5);
      const [answer] = await db.select().from(s.answers).where(eq(s.answers.id, opened.json.answer_id));
      expect(answer.language).toBe("ja");
      expect(answer.wordsPerMinute).toBeCloseTo(HEARD_JA_CHARACTERS / 1.5);
    }));

  it("scores all seven dimensions, keigo among them, stamped with the Japanese prompt", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { json } = await world.startRound(JA);
      const rubrics: string[] = [];
      world.scorer.score = async (input) => {
        rubrics.push(`${input.rubric.language} ${input.rubric.versionLabel}`);
        return uniformScores(4)(input);
      };
      const { answerId } = await world.answerCurrent(json.round.id, "決済基盤の移行を担当いたしました。");
      await world.drainAfter();
      expect(rubrics).toEqual(["ja v1.0"]);
      const [attempt] = await db.select().from(s.scoringAttempts).where(eq(s.scoringAttempts.answerId, answerId));
      expect(attempt).toMatchObject({ status: "ok", scoringPromptVersion: "score-ja-fake", generatorPromptVersion: "set-piece-ja-1.0" });
      const scores = await db.select().from(s.scores).where(eq(s.scores.scoringAttemptId, attempt.id));
      expect(scores.map((score) => score.dimension).sort()).toEqual(
        ["accuracy", "evidence", "fluency", "keigo", "length_pacing", "relevance", "structure"],
      );
    }));

  // PRD §4, US-10: Japanese feedback, with the English toggle stored beside it, written once.
  it("writes Japanese feedback with its English translation in body_translated", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { roundId } = await playThrough(world, JA);
      await world.drainAfter();
      const response = await world.call(world.handlers.complete, roundId, { felt_pressure: 4 });
      expect(response.status).toBe(201);
      expect(world.generator.calls).toBe(1);
      expect(world.generator.inputs[0].rubric.language).toBe("ja");
      expect(world.generator.inputs[0].answers.every((answer) => answer.scores.length === 7)).toBe(true);

      const translated = {
        language: "en",
        to_fix: FIXTURE_FEEDBACK_JA.translated!.toFix,
        what_worked: FIXTURE_FEEDBACK_JA.translated!.whatWorked,
      };
      expect(response.json.feedback).toMatchObject({
        to_fix: FIXTURE_FEEDBACK_JA.toFix,
        what_worked: FIXTURE_FEEDBACK_JA.whatWorked,
        language: "ja",
        prompt_version: "feedback-ja-fake",
        body_translated: translated,
      });
      const [row] = await db.select().from(s.roundFeedback).where(eq(s.roundFeedback.roundId, roundId));
      expect(row.language).toBe("ja");
      expect(row.bodyTranslated).toEqual(translated);

      // The retry returns the stored row, translation included, with no second model call.
      const again = await world.call(world.handlers.feedback, roundId, {});
      expect(again.status).toBe(200);
      expect(again.json.feedback.body_translated).toEqual(translated);
      expect(world.generator.calls).toBe(1);
    }));

  it("gives screen 8 both names of every dimension and both readings of the findings", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { roundId } = await playThrough(world, JA);
      await world.drainAfter();
      await world.call(world.handlers.complete, roundId, { felt_pressure: 2 });
      const [round] = await db.select().from(s.rounds).where(eq(s.rounds.id, roundId));
      const screen = await feedbackScreen(db, round);
      expect(screen.round.language).toBe("ja");
      expect(screen.answers).toHaveLength(3);
      expect(screen.answers[0].scores.map((score) => score.labels.ja)).toEqual(["構成", "根拠", "関連性", "流暢さ", "正確さ", "長さ・配分", "敬語"]);
      expect(screen.answers[0].scores.map((score) => score.labels.en)).toEqual(
        ["Structure", "Evidence", "Relevance", "Fluency", "Accuracy", "Length and pacing", "Keigo (register)"],
      );
      expect(screen.answers[0].scores.every((score) => score.value === 3)).toBe(true);
      expect(screen.findings).toEqual({ toFix: FIXTURE_FEEDBACK_JA.toFix, whatWorked: FIXTURE_FEEDBACK_JA.whatWorked });
      expect(screen.translated).toEqual(FIXTURE_FEEDBACK_JA.translated);
      expect(screen.stamps).toMatchObject({ rubricLabel: "v1.0", cvLabel: "応募書類 v1" });
      // A follow-up's answer is stamped with the follow-up prompt's version (04), so it is among them.
      expect(screen.stamps.generatorVersions).toEqual(["follow-up-ja-fake", "set-piece-ja-1.0", "synthetic-generated-ja-1.0"]);
    }));

  // #44: a Japanese round asks its 深掘り through the same port, in its own language.
  it("asks one follow-up per answer, generated and stamped with the Japanese follow-up prompt", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { json } = await world.startRound(JA);
      const corrected = "決済基盤の移行を担当いたしました。";
      const { answerId, submitted } = await world.answerCurrent(json.round.id, corrected);
      expect(submitted.json.next).toMatchObject({ kind: "follow_up", position: 1 });
      expect(world.followUps.inputs).toEqual([expect.objectContaining({ language: "ja", answer: corrected })]);
      const [row] = await db.select().from(s.followUps).where(eq(s.followUps.parentAnswerId, answerId));
      expect(row).toMatchObject({ status: "generated", promptVersion: "follow-up-ja-fake" });

      const followUp = await world.answerCurrent(json.round.id, "半年で完了いたしました。");
      await world.drainAfter();
      const [answer] = await db.select().from(s.answers).where(eq(s.answers.id, followUp.answerId));
      expect(answer).toMatchObject({ language: "ja", parentAnswerId: answerId, questionId: null, position: 1, isFirstAttempt: false });
      const [attempt] = await db.select().from(s.scoringAttempts).where(eq(s.scoringAttempts.answerId, followUp.answerId));
      expect(attempt).toMatchObject({ status: "ok", scoringPromptVersion: "score-ja-fake", generatorPromptVersion: "follow-up-ja-fake" });
      expect(await count(db, s.followUps)).toBe(1);
    }));

  it("gives an English round's screen 8 no translation", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { roundId } = await playThrough(world);
      await world.drainAfter();
      await world.call(world.handlers.complete, roundId, { felt_pressure: 2 });
      const [round] = await db.select().from(s.rounds).where(eq(s.rounds.id, roundId));
      const screen = await feedbackScreen(db, round);
      expect(screen.round.language).toBe("en");
      expect(screen.answers[0].scores).toHaveLength(6);
      expect(screen.translated).toBeNull();
    }));

  it("resumes on the same Japanese question, with the Japanese stamps", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { json } = await world.startRound(JA);
      const [round] = await db.select().from(s.rounds).where(eq(s.rounds.id, json.round.id));
      const frame = await roundFrame(db, world.userId, round);
      expect(frame).toMatchObject({
        round: { language: "ja", length: 3 },
        cvLabel: "応募書類 v1",
        rubricLabel: "v1.0",
        start: { kind: "question", position: 1, text: "まず、簡単に自己紹介をお願いします。" },
      });
    }));

  it("carries no Japanese transcript text into any envelope or log line", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { roundId } = await playThrough(world, JA);
      await world.drainAfter();
      await world.call(world.handlers.complete, roundId, { felt_pressure: 3 });
      for (const text of [...world.responses, ...logged]) {
        if (text.includes('"transcript_raw"')) continue;
        expect(text).not.toContain(SENTINEL);
        expect(text).not.toContain("決済期版");
      }
    }));
});
