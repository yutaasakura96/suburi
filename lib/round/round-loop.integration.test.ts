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
  fakeFeedbackGenerator,
  fakeModelHealth,
  fakeScorer,
  fakeTranscriber,
  uniformScores,
} from "../ai/fake-round-ports";
import { ModelCallFailed } from "../ai/upstream";
import { fakeAudioStore } from "../audio/fake-store";
import { createAuth } from "../auth/auth";
import { mintSessionCookie } from "../auth/test/session";
import { getConfig } from "../config";
import { createComplete, createFeedbackRetry } from "./complete";
import { createOpenAnswer } from "./open-answer";
import { createPostRound } from "./post-round";
import { createPostRoleContext } from "./role-context";
import { createSubmit } from "./submit";
import { answeredBefore, newerRoundExists, promptAt } from "./state";
import { createTranscribe } from "./transcribe";

// The round-loop tracer (#42) through its handlers, against the migrated test database, with a real
// Better Auth session. Only the model ports and the bucket are faked (11 §2).

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

async function setUp(db: TestDb, { healthy = true } = {}) {
  await seedUser(db, getConfig().ALLOWED_EMAIL);
  const [user] = await db.select({ id: s.users.id }).from(s.users).where(eq(s.users.email, getConfig().ALLOWED_EMAIL));
  await seedSyntheticCv(db, user.id, "en");
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
  const transcriber = fakeTranscriber(() => ({ text: `I led the migration at ${SENTINEL}, um, in six months.`, durationMs: 90_000 }));
  const generator = fakeFeedbackGenerator(() => FIXTURE_FEEDBACK);
  const health = fakeModelHealth(healthy);
  const base = { auth, db, transaction: savepointTransaction(db, fail, depth) };
  const timing = { waitBoundMs: 50, sleep: async () => {} };

  const handlers = {
    roleContext: createPostRoleContext(base),
    round: createPostRound({ ...base, health, scorer }),
    open: createOpenAnswer({ ...base, store, prefix: "dev/" }),
    transcribe: createTranscribe({ ...base, store, transcriber }),
    submit: createSubmit({
      ...base,
      scorer,
      sleep: async (ms) => void slept.push(ms),
      after: (work) => void scheduled.push(work),
      deadline: () => Date.now() + 280_000,
    }),
    complete: createComplete({ ...base, generator, ...timing }),
    feedback: createFeedbackRetry({ ...base, generator, ...timing }),
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

  /** Runs everything `submit` scheduled in `after()`, as Vercel's waitUntil would. */
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

  /** Record → open → upload → transcribe → submit, for the round's current position. */
  async function answerCurrent(roundId: string, corrected = "I led the migration, um, in six months.") {
    const opened = await call(handlers.open, roundId, { content_type: "audio/webm", expected_bytes: AUDIO.byteLength });
    const key = store.presigned.at(-1)!.key;
    store.put(key, AUDIO);
    await call(handlers.transcribe, opened.json.answer_id, {});
    const submitted = await call(handlers.submit, opened.json.answer_id, { transcript_corrected: corrected });
    return { answerId: opened.json.answer_id as string, opened, submitted };
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
    health,
    handlers,
    call,
    post,
    responses,
    drainAfter,
    general,
    startRound,
    answerCurrent,
  };
}

type World = Awaited<ReturnType<typeof setUp>>;

async function playThrough(world: World) {
  const started = await world.startRound();
  const roundId = started.json.round.id as string;
  const answers = [];
  for (let position = 1; position <= 3; position += 1) answers.push(await world.answerCurrent(roundId));
  return { roundId, answers, started };
}

async function count(db: TestDb, table: typeof s.rounds | typeof s.roundQuestions | typeof s.roundFeedback | typeof s.answers) {
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
    "refuses %o in this slice",
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
        const { opened } = await world.answerCurrent(json.round.id);
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
    [{ language: "ja" }, "language"],
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

  it("is 502 question_generation_failed when the bank cannot fill the round, and creates nothing", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      await db.update(s.questions).set({ retiredAt: new Date() }).where(eq(s.questions.origin, "generated"));
      const { status, json } = await world.startRound();
      expect(status).toBe(502);
      expect(json.error.code).toBe("question_generation_failed");
      expect(await count(db, s.rounds)).toBe(0);
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

describe("an abandoned round takes no more writes (07 §5.5, §5.12)", () => {
  /** A stale tab's view: a newer round starts, dated as a later request would date it. */
  async function abandonBy(world: World, db: TestDb) {
    const newer = await world.startRound();
    await db
      .update(s.rounds)
      .set({ startedAt: sql`${s.rounds.startedAt} + interval '1 second'` })
      .where(eq(s.rounds.id, newer.json.round.id));
  }

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
      const world = await setUp(db);
      const practice = await world.startRound({ mode: "practice" });
      const { answerId: practised } = await world.answerCurrent(practice.json.round.id);
      expect(await firstAttemptOf(db, practised)).toBe(false);
      const practisedQuestion = await questionOf(db, practised);
      const [, other] = await roundQuestionIds(db, practice.json.round.id);

      // A set piece, then the unseen generated question, then the practised one.
      await keepGenerated(db, [practisedQuestion, other]);
      const realistic = await world.startRound();
      expect((await roundQuestionIds(db, realistic.json.round.id)).slice(1)).toEqual([other, practisedQuestion]);
      const flags = [];
      for (let position = 1; position <= 3; position += 1) {
        flags.push(await firstAttemptOf(db, (await world.answerCurrent(realistic.json.round.id)).answerId));
      }
      expect(flags).toEqual([true, true, false]);
    }));

  it("counts an answer in an abandoned round, but not a question that round only fixed", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const abandoned = await world.startRound();
      const [, answeredQuestion, fixedOnly] = await roundQuestionIds(db, abandoned.json.round.id);
      await world.answerCurrent(abandoned.json.round.id);
      const { answerId } = await world.answerCurrent(abandoned.json.round.id);
      expect(await firstAttemptOf(db, answerId)).toBe(true);

      // The next round: the next set piece, the question only fixed (unseen), the one answered (seen).
      await keepGenerated(db, [answeredQuestion, fixedOnly]);
      const next = await world.startRound();
      expect((await roundQuestionIds(db, next.json.round.id)).slice(1)).toEqual([fixedOnly, answeredQuestion]);
      const flags = [];
      for (let position = 1; position <= 3; position += 1) {
        flags.push(await firstAttemptOf(db, (await world.answerCurrent(next.json.round.id)).answerId));
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
        flags.push(await firstAttemptOf(db, (await world.answerCurrent(json.round.id)).answerId));
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
      expect(answers.map((answer) => answer.submitted.json.next.kind)).toEqual(["question", "question", "pressure"]);
      expect(answers[0].submitted.json.next).toMatchObject({ position: 2, speak: true });
      expect(answers[2].submitted.json.progress).toEqual({ position: 3, of: 3 });

      const [answer] = await db.select().from(s.answers).where(eq(s.answers.id, answers[0].answerId));
      expect(answer.transcriptRaw).toContain(SENTINEL);
      expect(answer.transcriptCorrected).toBe("I led the migration, um, in six months.");
      expect(answer.rewriteMagnitude).toBeGreaterThan(0);

      const attempts = await db.select().from(s.scoringAttempts);
      expect(attempts).toHaveLength(3);
      for (const attempt of attempts) {
        expect(attempt.status).toBe("pending");
        expect(attempt.cvVersionId).not.toBeNull();
        expect(attempt.rubricVersionId).not.toBeNull();
        expect(attempt.generatorPromptVersion).toMatch(/^(set-piece-en-1\.0|synthetic-generated-en-1\.0)$/);
        expect(attempt.modelId).toBe("fake-scorer-2026-01-01");
        expect(attempt.scoringPromptVersion).toBe("score-en-fake");
      }

      await world.drainAfter();
      const scored = await db.select().from(s.scoringAttempts);
      expect(scored.every((attempt) => attempt.status === "ok")).toBe(true);
      expect(await db.select().from(s.scores)).toHaveLength(18);
      expect(world.scorer.calls).toBe(3);
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
      for (let position = 1; position <= 3; position += 1) await world.answerCurrent(json.round.id);
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
      expect(response.json.scoring).toEqual({ ok: 3, pending: 0, failed: 0 });
      expect(response.json.feedback).toMatchObject({ what_worked: FIXTURE_FEEDBACK.whatWorked, language: "en", prompt_version: "feedback-en-fake" });
      expect(response.json.feedback.to_fix).toHaveLength(2);
      expect(await count(db, s.roundFeedback)).toBe(1);

      const again = await world.call(world.handlers.complete, roundId, { felt_pressure: 2 });
      expect(again.status).toBe(409);
      expect(again.json.error).toMatchObject({ code: "round_already_complete", detail: { has_feedback: true } });
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
        waitBoundMs: 60_000,
        // The scores land during the first poll.
        sleep: () => world.drainAfter(),
      });
      const response = await world.call(complete, roundId, { felt_pressure: 3 });
      expect(response.status).toBe(201);
      expect(world.generator.inputs[0].answers.map((answer) => answer.position)).toEqual([1, 2, 3]);
    }));

  it("writes no feedback when a score is still pending past the bound, and the round stays complete", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { roundId } = await playThrough(world);
      const response = await world.call(world.handlers.complete, roundId, { felt_pressure: 5 });
      expect(response.status).toBe(502);
      expect(response.json.error).toMatchObject({ code: "feedback_generation_failed", detail: { error_class: "scores_pending", pending: 3 } });
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
      await world.answerCurrent(roundId, "I owned the rollout.");
      const second = await world.answerCurrent(roundId, `I failed to be scored ${SENTINEL}.`);
      await world.answerCurrent(roundId, "I measured the outcome.");
      await world.drainAfter();
      await failScoring(db, world, roundId, second.answerId);
      const response = await world.call(world.handlers.complete, roundId, { felt_pressure: 3 });
      expect(response.status).toBe(201);
      expect(response.json.scoring).toEqual({ ok: 2, pending: 0, failed: 1 });
      const sent = world.generator.inputs[0].answers;
      expect(sent.map((answer) => answer.position)).toEqual([1, 3]);
      expect(sent.map((answer) => answer.answer)).toEqual(["I owned the rollout.", "I measured the outcome."]);
      expect(JSON.stringify(world.generator.inputs)).not.toContain(SENTINEL);
    }));

  it("refuses as no_scores when every score failed, makes no model call, and screen 8 offers no retry", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { roundId, answers } = await playThrough(world);
      await world.drainAfter();
      for (const { answerId } of answers) await failScoring(db, world, roundId, answerId);
      const completed = await world.call(world.handlers.complete, roundId, { felt_pressure: 3 });
      expect(completed.status).toBe(502);
      expect(completed.json.error).toMatchObject({ code: "feedback_generation_failed", detail: { error_class: "no_scores" } });
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
