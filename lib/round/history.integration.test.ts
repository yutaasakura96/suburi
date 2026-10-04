import { and, asc, eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { historyDetail } from "../../app/(app)/history/load";
import * as s from "../../db/schema";
import { seedUser } from "../../db/seed";
import { seedSyntheticCv } from "../../db/seed-cv";
import { seedRubrics, seedSyntheticQuestions } from "../../db/seed-questions";
import { SYNTHETIC_MODEL_ID, seedSyntheticRounds, syntheticId } from "../../db/seed-rounds";
import { closePool, inRolledBackTransaction, type TestDb } from "../../db/test/database";
import { insertUser } from "../../db/test/fixtures";
import { fakeScorer, uniformScores } from "../ai/fake-round-ports";
import { ModelCallFailed } from "../ai/upstream";
import { fakeAudioStore } from "../audio/fake-store";
import { createAuth } from "../auth/auth";
import { mintSessionCookie } from "../auth/test/session";
import { getConfig } from "../config";
import { createGetAnswerAudio } from "./answer-audio";
import { createGetRounds, decodeCursor, listRounds } from "./list-rounds";
import { RUN_CLAIM_SECONDS } from "./run-scoring";
import { createPostScoringAttempt, createRunScoringAttempt } from "./scoring-attempts";

// History (#50) through its handlers and its loader, against the migrated test database, with a real
// Better Auth session. The rounds are the synthetic seed's (12 §1): one in each state History shows.
// Only the scorer and the bucket are faked (11 §2).

vi.stubEnv("DATABASE_URL", "postgresql://suburi:suburi@localhost:5433/suburi_test");
vi.stubEnv("DATABASE_URL_UNPOOLED", "postgresql://suburi:suburi@localhost:5433/suburi_test");
vi.stubEnv("BETTER_AUTH_SECRET", "integration-only-secret-not-a-real-one");
vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
vi.stubEnv("GOOGLE_CLIENT_ID", "integration-client-id");
vi.stubEnv("GOOGLE_CLIENT_SECRET", "integration-client-secret");
vi.stubEnv("ALLOWED_EMAIL", "allowed@example.test");
vi.stubEnv("OPENAI_API_KEY", "integration-not-a-real-key");

// Words of the seeded transcripts and questions that must never reach an envelope or a log line (11 §3.10).
const RECORD_TEXT = ["refund", "afterthought", "industry", "fraud checks"];

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

// The handler's transaction, as a savepoint inside the test's rolled-back transaction. `fail` forces
// a database failure on the next write, for write_failed.
function savepointTransaction(db: TestDb, fail: { next: boolean }) {
  return async <T>(work: (tx: TestDb) => Promise<T>) => {
    await db.execute(sql`savepoint history_write`);
    try {
      if (fail.next) {
        fail.next = false;
        throw Object.assign(new Error("insert failed"), { code: "57014" });
      }
      const result = await work(db);
      await db.execute(sql`release savepoint history_write`);
      return result;
    } catch (error) {
      await db.execute(sql`rollback to savepoint history_write`);
      throw error;
    }
  };
}

/** Everything `db:seed:develop` seeds for one user (12 §1). */
async function seedFor(db: TestDb, userId: string) {
  await seedSyntheticCv(db, userId, "en");
  await seedSyntheticCv(db, userId, "ja");
  await seedSyntheticQuestions(db, userId);
  await seedSyntheticRounds(db, userId);
}

async function setUp(db: TestDb) {
  await seedUser(db, getConfig().ALLOWED_EMAIL);
  const [user] = await db.select({ id: s.users.id }).from(s.users).where(eq(s.users.email, getConfig().ALLOWED_EMAIL));
  await seedRubrics(db);
  await seedFor(db, user.id);

  const auth = createAuth({ db, transaction: false });
  const cookie = await mintSessionCookie(auth, user.id);
  const fail = { next: false };
  const store = fakeAudioStore();
  const scorer = fakeScorer(uniformScores(5));
  const base = { auth, db, transaction: savepointTransaction(db, fail) };
  const handlers = {
    list: createGetRounds(base),
    audio: createGetAnswerAudio({ ...base, store }),
    create: createPostScoringAttempt({ ...base, scorer }),
    run: createRunScoringAttempt({ ...base, scorer, sleep: async () => {}, deadline: () => Date.now() + 280_000 }),
  };

  const responses: string[] = [];
  async function send(response: Promise<Response>) {
    const resolved = await response;
    const text = await resolved.text();
    responses.push(text);
    return { status: resolved.status, json: JSON.parse(text) };
  }
  function request(method: "GET" | "POST", path: string, body: unknown, signedIn: boolean) {
    return new Request(`http://localhost:3000${path}`, {
      method,
      headers: {
        ...(method === "POST" ? { "content-type": "application/json" } : {}),
        ...(signedIn ? { cookie: `${cookie.name}=${cookie.value}` } : {}),
      },
      body: method === "POST" ? JSON.stringify(body) : undefined,
    });
  }
  const id = (name: string) => syntheticId(user.id, name);

  return {
    userId: user.id,
    fail,
    store,
    scorer,
    responses,
    id,
    /** The synthetic round's answer whose score failed, and the one whose score is still pending. */
    failedAnswerId: id("failed-en:q2"),
    pendingAttemptId: id("pending-en:q3:attempt"),
    list: (query = "", { signedIn = true } = {}) => send(handlers.list(request("GET", `/api/rounds${query}`, null, signedIn))),
    audio: (answerId: string, { signedIn = true } = {}) =>
      send(handlers.audio(request("GET", `/api/answers/${answerId}/audio`, null, signedIn), answerId)),
    create: (body: unknown, { signedIn = true } = {}) => send(handlers.create(request("POST", "/api/scoring-attempts", body, signedIn))),
    run: (attemptId: string, { signedIn = true } = {}) =>
      send(handlers.run(request("POST", `/api/scoring-attempts/${attemptId}/run`, {}, signedIn), attemptId)),
  };
}

type World = Awaited<ReturnType<typeof setUp>>;

/** A second user with the same seed: every id of theirs is one this session must not find. */
async function otherUser(db: TestDb) {
  const userId = await insertUser(db);
  await seedFor(db, userId);
  return userId;
}

/** A round beside the seeded ones, with its bank questions fixed; answered by `insertAnswer`. */
async function insertRound(
  db: TestDb,
  userId: string,
  values: { mode: "realistic" | "practice"; startedAt: Date; completedAt?: Date | null },
) {
  const [like] = await db.select().from(s.rounds).where(eq(s.rounds.id, syntheticId(userId, "abandoned-en")));
  const [round] = await db
    .insert(s.rounds)
    .values({
      userId,
      roundType: "hr",
      language: "en",
      mode: values.mode,
      length: 3,
      perAnswerCapSeconds: values.mode === "realistic" ? 240 : 900,
      cvVersionId: like.cvVersionId,
      roleContextId: like.roleContextId,
      rubricVersionId: like.rubricVersionId,
      startedAt: values.startedAt,
      completedAt: values.completedAt ?? null,
    })
    .returning();
  const questions = await db
    .select()
    .from(s.questions)
    .where(and(eq(s.questions.userId, userId), eq(s.questions.language, "en"), eq(s.questions.roundType, "hr")))
    .orderBy(asc(s.questions.createdAt))
    .limit(3);
  await db
    .insert(s.roundQuestions)
    .values(questions.map((question, index) => ({ roundId: round.id, userId, position: index + 1, questionId: question.id })));
  return { round, questions };
}

async function insertAnswer(
  db: TestDb,
  round: typeof s.rounds.$inferSelect,
  question: typeof s.questions.$inferSelect,
  values: { position: number; retryOf?: string; status?: "pending" | "ok" | "failed"; minute: number },
) {
  const createdAt = new Date(round.startedAt.getTime() + values.minute * 60_000);
  const [answer] = await db
    .insert(s.answers)
    .values({
      roundId: round.id,
      userId: round.userId,
      questionId: question.id,
      promptText: question.body,
      position: values.position,
      language: round.language,
      transcriptRaw: "Um, a fixture answer.",
      transcriptCorrected: "A fixture answer.",
      retryOfAnswerId: values.retryOf ?? null,
      createdAt,
    })
    .returning();
  const [attempt] = await db
    .insert(s.scoringAttempts)
    .values({
      answerId: answer.id,
      userId: round.userId,
      status: values.status ?? "pending",
      cvVersionId: round.cvVersionId,
      rubricVersionId: round.rubricVersionId,
      generatorPromptVersion: question.generatorPromptVersion,
      modelId: SYNTHETIC_MODEL_ID,
      scoringPromptVersion: "synthetic-score-en-1.0",
      createdAt,
    })
    .returning();
  return { answer, attempt };
}

function expectNoRecordText(world: World) {
  for (const text of [...logged, ...world.responses]) {
    for (const word of RECORD_TEXT) expect(text).not.toContain(word);
  }
}

describe("GET /api/rounds (07 §5.13)", () => {
  it("is 401 with no session", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      expect((await world.list("", { signedIn: false })).status).toBe(401);
    }));

  it("lists the user's rounds newest first, each with its derived status, its counts and its stamps", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { status, json } = await world.list();

      expect(status).toBe(200);
      expect(json.next_cursor).toBeNull();
      expect(json.items).toEqual([
        {
          id: world.id("complete-ja"),
          round_type: "behavioural",
          language: "ja",
          mode: "realistic",
          length: 3,
          started_at: "2026-09-12T10:30:00.000Z",
          completed_at: "2026-09-12T11:00:00.000Z",
          status: "complete",
          answers: 5,
          scoring: { ok: 5, pending: 0, failed: 0 },
          stamps: { cv_version_label: "応募書類 v1", rubric_version_label: "v1.0", scoring_model_ids: [SYNTHETIC_MODEL_ID] },
        },
        expect.objectContaining({ id: world.id("pending-en"), status: "complete", answers: 6, scoring: { ok: 5, pending: 1, failed: 0 } }),
        expect.objectContaining({ id: world.id("failed-en"), status: "complete", answers: 5, scoring: { ok: 4, pending: 0, failed: 1 } }),
        expect.objectContaining({
          id: world.id("abandoned-en"),
          status: "abandoned",
          completed_at: null,
          answers: 1,
          scoring: { ok: 1, pending: 0, failed: 0 },
          stamps: { cv_version_label: "CV v1", rubric_version_label: "v1.0", scoring_model_ids: [SYNTHETIC_MODEL_ID] },
        }),
      ]);
      // Counts of answers, never anything computed from their scores (04 §6).
      expect(world.responses.at(-1)).not.toMatch(/total|average|overall|composite|mean/i);
      expectNoRecordText(world);
    }));

  it("never lists another user's rounds", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const other = await otherUser(db);
      const { json } = await world.list();
      expect(json.items).toHaveLength(4);
      expect(json.items.map((round: { id: string }) => round.id)).not.toContain(syntheticId(other, "complete-ja"));
    }));

  it("pages by cursor without a skipped or repeated row, down to rounds a microsecond apart", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      // Three rounds inside one millisecond: a cursor that kept only milliseconds would lose two.
      for (const [name, micros] of [
        ["complete-ja", "000003"],
        ["pending-en", "000002"],
        ["failed-en", "000001"],
      ] as const) {
        await db.execute(
          sql`update rounds set started_at = ${`2026-09-01 00:00:00.${micros}+00`}::timestamptz where id = ${world.id(name)}`,
        );
      }

      const seen: string[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < 4; page += 1) {
        const { status, json } = await world.list(`?limit=1${cursor ? `&cursor=${cursor}` : ""}`);
        expect(status).toBe(200);
        expect(json.items).toHaveLength(1);
        seen.push(json.items[0].id);
        cursor = json.next_cursor;
        expect(cursor === null).toBe(page === 3);
      }
      expect(seen).toEqual([world.id("complete-ja"), world.id("pending-en"), world.id("failed-en"), world.id("abandoned-en")]);

      const first = await world.list("?limit=3");
      expect(first.json.items).toHaveLength(3);
      expect(decodeCursor(first.json.next_cursor)).toEqual({ s: "2026-09-01T00:00:00.000001Z", i: world.id("failed-en") });
      const second = await world.list(`?limit=3&cursor=${first.json.next_cursor}`);
      expect(second.json.items.map((round: { id: string }) => round.id)).toEqual([world.id("abandoned-en")]);
      expect(second.json.next_cursor).toBeNull();
    }));

  it("filters by language, round type and mode, and by nothing else", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const ids = async (query: string) => (await world.list(query)).json.items.map((round: { id: string }) => round.id);

      expect(await ids("?language=ja")).toEqual([world.id("complete-ja")]);
      expect(await ids("?round_type=ceo")).toEqual([world.id("failed-en")]);
      expect(await ids("?language=en&round_type=behavioural")).toEqual([world.id("abandoned-en")]);
      expect(await ids("?mode=practice")).toEqual([]);
      expect(await ids("?mode=realistic")).toHaveLength(4);
    }));

  it.each([
    ["?status=abandoned", ["status"]],
    ["?user_id=someone", ["user_id"]],
    ["?sort=started_at", ["sort"]],
    ["?limit=0", ["limit"]],
    ["?limit=101", ["limit"]],
    ["?limit=ten", ["limit"]],
    ["?language=fr", ["language"]],
    ["?language=en&language=ja", ["language"]],
    ["?cursor=not-a-cursor", ["cursor"]],
    [`?cursor=${Buffer.from(JSON.stringify({ s: "2026-09-01", i: "x" })).toString("base64url")}`, ["cursor"]],
  ])("is 400 for %s, naming the field and listing nothing", (query, fields) =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { status, json } = await world.list(query);
      expect(status).toBe(400);
      expect(json.error.code).toBe("invalid_request");
      expect(json.error.detail.fields).toEqual(fields);
    }),
  );
});

describe("abandoned, judged on the Asia/Tokyo day (04 `rounds`; 06, 2026-09-28)", () => {
  it("keeps the newest open round in progress until the day ends in Tokyo, whatever the UTC date", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      // 23:59 on 3 October in Tokyo.
      const { round } = await insertRound(db, world.userId, { mode: "realistic", startedAt: new Date("2026-10-03T14:59:00.000Z") });
      const statusAt = async (now: string) =>
        (await listRounds(db, world.userId, { limit: 20, cursor: null }, new Date(now))).items.find((item) => item.id === round.id)?.status;

      expect(await statusAt("2026-10-03T14:59:30.000Z")).toBe("in_progress");
      // A minute later it is 4 October in Tokyo, and still 3 October in UTC.
      expect(await statusAt("2026-10-03T15:00:30.000Z")).toBe("abandoned");
    }));

  it("keeps a round started this morning in Tokyo in progress across midnight UTC", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      // 08:30 on 4 October in Tokyo is 23:30 on 3 October in UTC.
      const { round } = await insertRound(db, world.userId, { mode: "realistic", startedAt: new Date("2026-10-03T23:30:00.000Z") });
      const page = await listRounds(db, world.userId, { limit: 20, cursor: null }, new Date("2026-10-04T01:00:00.000Z"));
      expect(page.items[0]).toMatchObject({ id: round.id, status: "in_progress" });
      // Every older open round is abandoned by the newer one, on any day.
      expect(page.items.at(-1)).toMatchObject({ id: world.id("abandoned-en"), status: "abandoned" });
    }));
});

describe("GET /api/answers/{id}/audio (07 §5.14)", () => {
  it("is 401 with no session", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      expect((await world.audio(world.failedAnswerId, { signedIn: false })).status).toBe(401);
    }));

  it("is 404 audio_missing for an answer with no recording", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { status, json } = await world.audio(world.failedAnswerId);
      expect(status).toBe(404);
      expect(json.error).toMatchObject({ code: "audio_missing", detail: { answer_id: world.failedAnswerId } });
    }));

  it("is 404 audio_missing when the key points at nothing: no URL is minted for an absent object", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      await db.update(s.answers).set({ audioS3Key: "dev/audio/gone.webm" }).where(eq(s.answers.id, world.failedAnswerId));
      const { status, json } = await world.audio(world.failedAnswerId);
      expect(status).toBe(404);
      expect(json.error.code).toBe("audio_missing");
      expect(world.responses.at(-1)).not.toContain("gone.webm");
    }));

  it("mints a short-lived URL for a stored recording, with its duration", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      await db.update(s.answers).set({ audioS3Key: "dev/audio/kept.webm" }).where(eq(s.answers.id, world.failedAnswerId));
      world.store.put("dev/audio/kept.webm", new Uint8Array([1, 2, 3]));
      const [answer] = await db.select().from(s.answers).where(eq(s.answers.id, world.failedAnswerId));

      const before = Date.now();
      const { status, json } = await world.audio(world.failedAnswerId);
      expect(status).toBe(200);
      expect(Object.keys(json).sort()).toEqual(["duration_ms", "expires_at", "url"]);
      expect(json.url).toContain("dev/audio/kept.webm");
      expect(json.duration_ms).toBe(answer.audioDurationMs);
      expect(Date.parse(json.expires_at) - before).toBeLessThanOrEqual(301_000);
    }));

  it("is 404 for another user's answer, an unknown id and a malformed one", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const other = await otherUser(db);
      for (const answerId of [syntheticId(other, "failed-en:q2"), crypto.randomUUID(), "not-an-id"]) {
        const { status, json } = await world.audio(answerId);
        expect(status).toBe(404);
        expect(json.error.code).toBe("not_found");
      }
    }));

  it("is 502 upstream_s3 when S3 cannot be reached, logging the class and no key", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      await db.update(s.answers).set({ audioS3Key: "dev/audio/kept.webm" }).where(eq(s.answers.id, world.failedAnswerId));
      world.store.failRead = true;
      const { status, json } = await world.audio(world.failedAnswerId);
      expect(status).toBe(502);
      expect(json.error.code).toBe("upstream_s3");
      expect(logged.some((line) => line.includes("audio_presign_failed") && line.includes("TimeoutError"))).toBe(true);
      expect([...logged, ...world.responses].join("\n")).not.toContain("kept.webm");
    }));
});

describe("POST /api/scoring-attempts (07 §5.11)", () => {
  it("is 401 with no session, and writes nothing", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      expect((await world.create({ answer_id: world.failedAnswerId }, { signedIn: false })).status).toBe(401);
      expect(await db.$count(s.scoringAttempts, eq(s.scoringAttempts.answerId, world.failedAnswerId))).toBe(1);
    }));

  it("writes a new pending attempt beside the failed one, stamped by the server", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const [failed] = await db.select().from(s.scoringAttempts).where(eq(s.scoringAttempts.answerId, world.failedAnswerId));
      const [round] = await db.select().from(s.rounds).where(eq(s.rounds.id, world.id("failed-en")));

      const { status, json } = await world.create({ answer_id: world.failedAnswerId });
      expect(status).toBe(201);
      expect(json).toEqual({
        attempt_id: expect.any(String),
        answer_id: world.failedAnswerId,
        status: "pending",
        is_superseding: true,
        stamps: {
          cv_version_id: round.cvVersionId,
          rubric_version_id: round.rubricVersionId,
          // Stamp 3 is the question's, as on the first attempt; the model and prompt are today's pins.
          generator_prompt_version: "synthetic-generated-en-1.0",
          model_id: "fake-scorer-2026-01-01",
          scoring_prompt_version: "score-en-fake",
        },
      });
      expect(json.attempt_id).not.toBe(failed.id);

      const rows = await db
        .select()
        .from(s.scoringAttempts)
        .where(eq(s.scoringAttempts.answerId, world.failedAnswerId))
        .orderBy(asc(s.scoringAttempts.createdAt));
      // A new row, never an overwrite (04 `scoring_attempts`).
      expect(rows).toHaveLength(2);
      expect(rows[0]).toEqual(failed);
      expect(rows[1]).toMatchObject({ id: json.attempt_id, status: "pending", isSuperseding: true, runStartedAt: null });
      expect(world.scorer.calls).toBe(0);
      expectNoRecordText(world);
    }));

  it("stamps a follow-up's answer with the follow-up's prompt version", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const answerId = world.id("failed-en:q1:follow-up-answer");
      await db.update(s.scoringAttempts).set({ status: "failed", answeredLanguage: null }).where(eq(s.scoringAttempts.answerId, answerId));
      const { status, json } = await world.create({ answer_id: answerId });
      expect(status).toBe(201);
      expect(json.stamps.generator_prompt_version).toBe("synthetic-follow-up-en-1.0");
    }));

  it("is 422 scoring_not_retryable for an ok score and for a pending one, and writes nothing", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      for (const [answerId, state] of [
        [world.id("failed-en:q1"), "ok"],
        [world.id("pending-en:q3"), "pending"],
      ] as const) {
        const { status, json } = await world.create({ answer_id: answerId });
        expect(status).toBe(422);
        expect(json.error).toMatchObject({ code: "scoring_not_retryable", detail: { answer_id: answerId, status: state } });
        expect(await db.$count(s.scoringAttempts, eq(s.scoringAttempts.answerId, answerId))).toBe(1);
      }
    }));

  it("refuses a second retry while the first is still pending: one new row, not two", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      expect((await world.create({ answer_id: world.failedAnswerId })).status).toBe(201);
      const again = await world.create({ answer_id: world.failedAnswerId });
      expect(again.status).toBe(422);
      expect(again.json.error.code).toBe("scoring_not_retryable");
      expect(await db.$count(s.scoringAttempts, eq(s.scoringAttempts.answerId, world.failedAnswerId))).toBe(2);
    }));

  it("is 404 for another user's answer and for an unknown one", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const other = await otherUser(db);
      for (const answerId of [syntheticId(other, "failed-en:q2"), crypto.randomUUID()]) {
        const { status, json } = await world.create({ answer_id: answerId });
        expect(status).toBe(404);
        expect(json.error.code).toBe("not_found");
      }
      expect(await db.$count(s.scoringAttempts, eq(s.scoringAttempts.answerId, syntheticId(other, "failed-en:q2")))).toBe(1);
    }));

  it.each([
    [{ answer_id: "not-an-id" }, ["answer_id"]],
    [{}, ["answer_id"]],
    // No stamp is accepted from the client (07 §1 rule 6), and none of these fields exists.
    [{ answer_id: "ANSWER", model_id: "gpt-other" }, ["model_id"]],
    [{ answer_id: "ANSWER", rubric_version_id: "x", is_superseding: false }, ["rubric_version_id", "is_superseding"]],
  ])("is 400 for the body %j", (body, fields) =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const sent = "answer_id" in body && body.answer_id === "ANSWER" ? { ...body, answer_id: world.failedAnswerId } : body;
      const { status, json } = await world.create(sent);
      expect(status).toBe(400);
      expect(json.error.detail.fields).toEqual(fields);
      expect(await db.$count(s.scoringAttempts, eq(s.scoringAttempts.answerId, world.failedAnswerId))).toBe(1);
    }),
  );

  it("is 500 write_failed on a failed write, and the retry of the retry lands", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      world.fail.next = true;
      const refused = await world.create({ answer_id: world.failedAnswerId });
      expect(refused.status).toBe(500);
      expect(refused.json.error).toMatchObject({ code: "write_failed", detail: { answer_id: world.failedAnswerId, error_class: "pg_57014" } });
      expect(await db.$count(s.scoringAttempts, eq(s.scoringAttempts.answerId, world.failedAnswerId))).toBe(1);
      expect((await world.create({ answer_id: world.failedAnswerId })).status).toBe(201);
    }));
});

describe("POST /api/scoring-attempts/{id}/run (07 §5.10)", () => {
  it("is 401 with no session, and calls no model", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      expect((await world.run(world.pendingAttemptId, { signedIn: false })).status).toBe(401);
      expect(world.scorer.calls).toBe(0);
    }));

  it("scores the retried answer alone: its scores in the rubric's order, and the round's feedback untouched", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const feedback = await db.select().from(s.roundFeedback).orderBy(asc(s.roundFeedback.id));
      const others = await db
        .select()
        .from(s.scoringAttempts)
        .where(sql`${s.scoringAttempts.answerId} <> ${world.failedAnswerId}`)
        .orderBy(asc(s.scoringAttempts.id));
      const created = await world.create({ answer_id: world.failedAnswerId });

      const { status, json } = await world.run(created.json.attempt_id);
      expect(status).toBe(200);
      expect(json).toEqual({
        attempt_id: created.json.attempt_id,
        answer_id: world.failedAnswerId,
        status: "ok",
        scores: ["structure", "evidence", "relevance", "fluency", "accuracy", "length_pacing"].map((dimension) => ({ dimension, value: 5 })),
        citations: [],
        flags: [],
        answered_language: "en",
        tokens_in: 100,
        tokens_out: 20,
      });
      // No total, average or overall: there is no field for one (07 §5.10).
      expect(world.responses.at(-1)).not.toMatch(/total|average|overall|composite|mean/i);
      expect(world.scorer.calls).toBe(1);

      // The round feedback is permanent, and no other answer was scored again (06, 2026-09-28).
      expect(await db.select().from(s.roundFeedback).orderBy(asc(s.roundFeedback.id))).toEqual(feedback);
      expect(
        await db
          .select()
          .from(s.scoringAttempts)
          .where(sql`${s.scoringAttempts.answerId} <> ${world.failedAnswerId}`)
          .orderBy(asc(s.scoringAttempts.id)),
      ).toEqual(others);

      // History now shows the score, and the round carries both models' stamps.
      const listed = (await world.list()).json.items.find((round: { id: string }) => round.id === world.id("failed-en"));
      expect(listed.scoring).toEqual({ ok: 5, pending: 0, failed: 0 });
      expect(listed.stamps.scoring_model_ids).toEqual(["fake-scorer-2026-01-01", SYNTHETIC_MODEL_ID]);
      const [round] = await db.select().from(s.rounds).where(eq(s.rounds.id, world.id("failed-en")));
      const detail = await historyDetail(db, round, new Date());
      expect(detail.rows[2]).toMatchObject({ answerId: world.failedAnswerId, scoring: { state: "ok", values: [5, 5, 5, 5, 5, 5] } });
      expect(detail.stamps.scoringModels).toEqual(["fake-scorer-2026-01-01", SYNTHETIC_MODEL_ID]);
      expectNoRecordText(world);
    }));

  it("sends the scorer the corrected text of that one answer, never the raw one", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const inputs: string[] = [];
      const respond = uniformScores(4);
      world.scorer.score = async (input) => {
        inputs.push(input.answer);
        return respond(input);
      };
      const created = await world.create({ answer_id: world.failedAnswerId });
      await world.run(created.json.attempt_id);
      const [answer] = await db.select().from(s.answers).where(eq(s.answers.id, world.failedAnswerId));
      expect(inputs).toEqual([answer.transcriptCorrected]);
      expect(answer.transcriptRaw).not.toBe(answer.transcriptCorrected);
    }));

  it("drives a pending attempt nothing finished, as it is: no new row", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { status, json } = await world.run(world.pendingAttemptId);
      expect(status).toBe(200);
      expect(json).toMatchObject({ attempt_id: world.pendingAttemptId, status: "ok" });
      expect(await db.$count(s.scoringAttempts, eq(s.scoringAttempts.answerId, world.id("pending-en:q3")))).toBe(1);
    }));

  it("returns a finished attempt as it stands and calls nothing: an ok score is not re-rolled", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const attemptId = world.id("failed-en:q1:attempt");
      const scores = await db.select().from(s.scores).where(eq(s.scores.scoringAttemptId, attemptId)).orderBy(asc(s.scores.id));

      for (let call = 0; call < 2; call += 1) {
        const { status, json } = await world.run(attemptId);
        expect(status).toBe(200);
        expect(json.status).toBe("ok");
        expect(json.scores.map((score: { value: number }) => score.value)).toEqual([3, 3, 4, 4, 4, 3]);
      }
      expect(world.scorer.calls).toBe(0);
      expect(await db.select().from(s.scores).where(eq(s.scores.scoringAttemptId, attemptId)).orderBy(asc(s.scores.id))).toEqual(scores);

      // A failed one is returned failed, with no score and no call either.
      const failed = await world.run(world.id("failed-en:q2:attempt"));
      expect(failed.status).toBe(200);
      expect(failed.json).toEqual({ attempt_id: world.id("failed-en:q2:attempt"), answer_id: world.failedAnswerId, status: "failed" });
      expect(world.scorer.calls).toBe(0);
    }));

  it("is 502 scoring_failed when the retries are spent, and the answer can be retried again", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      world.scorer.score = async () => {
        world.scorer.calls += 1;
        throw new ModelCallFailed("Scoring", "upstream_500");
      };
      const created = await world.create({ answer_id: world.failedAnswerId });

      const { status, json } = await world.run(created.json.attempt_id);
      expect(status).toBe(502);
      expect(json.error).toMatchObject({
        code: "scoring_failed",
        detail: { attempt_id: created.json.attempt_id, answer_id: world.failedAnswerId, error_class: "upstream_500" },
      });
      expect(world.scorer.calls).toBe(4);
      const [attempt] = await db.select().from(s.scoringAttempts).where(eq(s.scoringAttempts.id, created.json.attempt_id));
      expect(attempt).toMatchObject({ status: "failed", errorClass: "upstream_500" });
      expect(await db.$count(s.scores, eq(s.scores.scoringAttemptId, attempt.id))).toBe(0);

      // Failed again is retryable again: a third row beside the two.
      expect((await world.create({ answer_id: world.failedAnswerId })).status).toBe(201);
      expect(await db.$count(s.scoringAttempts, eq(s.scoringAttempts.answerId, world.failedAnswerId))).toBe(3);
      expectNoRecordText(world);
    }));

  it("is 409 scoring_in_progress while another run holds the attempt, and takes it over once that run cannot be alive", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      await db.execute(sql`update scoring_attempts set run_started_at = now() where id = ${world.pendingAttemptId}`);

      const held = await world.run(world.pendingAttemptId);
      expect(held.status).toBe(409);
      expect(held.json.error).toMatchObject({
        code: "scoring_in_progress",
        detail: { attempt_id: world.pendingAttemptId, answer_id: world.id("pending-en:q3") },
      });
      expect(world.scorer.calls).toBe(0);

      // One second short of the invocation ceiling, the first run may still be alive.
      await db.execute(
        sql`update scoring_attempts set run_started_at = now() - make_interval(secs => ${RUN_CLAIM_SECONDS - 1}) where id = ${world.pendingAttemptId}`,
      );
      expect((await world.run(world.pendingAttemptId)).status).toBe(409);

      await db.execute(
        sql`update scoring_attempts set run_started_at = now() - make_interval(secs => ${RUN_CLAIM_SECONDS}) where id = ${world.pendingAttemptId}`,
      );
      const taken = await world.run(world.pendingAttemptId);
      expect(taken.status).toBe(200);
      expect(taken.json.status).toBe("ok");
      expect(world.scorer.calls).toBe(1);
    }));

  it("is 404 for another user's attempt, an unknown id and a malformed one, and calls no model", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const other = await otherUser(db);
      for (const attemptId of [syntheticId(other, "pending-en:q3:attempt"), crypto.randomUUID(), "not-an-id"]) {
        const { status, json } = await world.run(attemptId);
        expect(status).toBe(404);
        expect(json.error.code).toBe("not_found");
      }
      expect(world.scorer.calls).toBe(0);
      const [theirs] = await db.select().from(s.scoringAttempts).where(eq(s.scoringAttempts.id, syntheticId(other, "pending-en:q3:attempt")));
      expect(theirs).toMatchObject({ status: "pending", runStartedAt: null });
    }));

  it("says only that the score is in while a realistic round is still being answered (US-8)", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { round, questions } = await insertRound(db, world.userId, { mode: "realistic", startedAt: new Date() });
      const { answer, attempt } = await insertAnswer(db, round, questions[0], { position: 1, minute: 0 });

      const { status, json } = await world.run(attempt.id);
      expect(status).toBe(200);
      expect(json).toEqual({ attempt_id: attempt.id, answer_id: answer.id, status: "ok" });
      expect(await db.$count(s.scores, eq(s.scores.scoringAttemptId, attempt.id))).toBe(6);
    }));

  it("counts each route in its own bucket", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const created = await world.create({ answer_id: world.failedAnswerId });
      await world.run(created.json.attempt_id);
      await world.run(created.json.attempt_id);
      const windows = await db
        .select({ route: s.rateLimitWindows.route, count: s.rateLimitWindows.count })
        .from(s.rateLimitWindows)
        .where(eq(s.rateLimitWindows.userId, world.userId))
        .orderBy(asc(s.rateLimitWindows.route));
      expect(windows).toEqual([
        { route: "scoring-attempts", count: 1 },
        { route: "scoring-run", count: 2 },
      ]);
    }));
});

describe("History's detail (10 §10)", () => {
  async function detailOf(db: TestDb, roundId: string, now = new Date()) {
    const [round] = await db.select().from(s.rounds).where(eq(s.rounds.id, roundId));
    return historyDetail(db, round, now);
  }

  it("lists each question, its follow-up under it, and the hole a missing follow-up left", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const detail = await detailOf(db, world.id("failed-en"));

      expect(detail.rows.map((row) => [row.kind, row.position, row.kind === "answer" ? row.asked : null])).toEqual([
        ["answer", 1, "question"],
        ["answer", 1, "follow_up"],
        ["answer", 2, "question"],
        ["answer", 2, "follow_up"],
        ["answer", 3, "question"],
        ["follow_up_missing", 3, null],
      ]);
      expect(detail.rows[2]).toMatchObject({ scoring: { state: "failed" } });
      expect(detail.rows[0]).toMatchObject({ scoring: { state: "ok", values: [3, 3, 4, 4, 4, 3] } });
      expect(detail.round).toMatchObject({ status: "complete", mode: "realistic", length: 3 });
      expect(detail.roleContext.kind).toBe("general");
      expect(detail.stamps).toEqual({
        rubricLabel: "v1.0",
        cvLabel: "CV v1",
        generatorVersions: ["synthetic-follow-up-en-1.0", "synthetic-generated-en-1.0"],
        scoringModels: [SYNTHETIC_MODEL_ID],
      });
      expect(detail.hasFeedback).toBe(true);
      expect(detail.translated).toBe(false);
      // Each row has one value per dimension and nothing that combines them (04 §6).
      expect(JSON.stringify(detail)).not.toMatch(/total|average|overall|composite|mean/i);
    }));

  it("keeps both transcripts on every answer row: the raw one is never replaced by the correction", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const detail = await detailOf(db, world.id("failed-en"));
      const answers = detail.rows.filter((row) => row.kind === "answer");
      expect(answers).toHaveLength(5);
      expect(answers.every((row) => row.raw !== null && row.corrected !== null)).toBe(true);
      expect(answers[2].raw).toContain("as a, as an afterthought");
      expect(answers[2].corrected).not.toContain("as a, as an");
      expect(answers[2].rewrite).toBeGreaterThan(0);
    }));

  it("offers a pending score its own attempt to run", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const detail = await detailOf(db, world.id("pending-en"));
      expect(detail.rows[4]).toMatchObject({ answerId: world.id("pending-en:q3"), scoring: { state: "pending", attemptId: world.pendingAttemptId } });
    }));

  it("puts a practice answer-again beside the answer it retries, each with its own score", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { round, questions } = await insertRound(db, world.userId, {
        mode: "practice",
        startedAt: new Date("2026-09-20T03:00:00.000Z"),
        completedAt: new Date("2026-09-20T03:30:00.000Z"),
      });
      const first = await insertAnswer(db, round, questions[0], { position: 1, minute: 1, status: "failed" });
      const again = await insertAnswer(db, round, questions[0], { position: 1, minute: 5, retryOf: first.answer.id, status: "pending" });
      const second = await insertAnswer(db, round, questions[1], { position: 2, minute: 9, status: "failed" });

      const detail = await detailOf(db, round.id);
      expect(detail.rows.map((row) => (row.kind === "answer" ? [row.answerId, row.retry, row.scoring.state] : [row.kind]))).toEqual([
        [first.answer.id, false, "failed"],
        [again.answer.id, true, "pending"],
        [second.answer.id, false, "failed"],
        ["question_unanswered"],
      ]);
      // The first answer is still there, unchanged, beside its retry (refusal 3).
      expect(await db.$count(s.answers, eq(s.answers.roundId, round.id))).toBe(3);
    }));

  it("withholds every score of a realistic round still in progress, and never shows a question not yet answered", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { round, questions } = await insertRound(db, world.userId, { mode: "realistic", startedAt: new Date() });
      const { attempt } = await insertAnswer(db, round, questions[0], { position: 1, minute: 0 });
      await world.run(attempt.id);

      const detail = await detailOf(db, round.id);
      expect(detail.round.status).toBe("in_progress");
      expect(detail.rows.map((row) => row.kind)).toEqual(["answer", "question_unanswered", "question_unanswered"]);
      expect(detail.rows[0]).toMatchObject({ scoring: { state: "withheld" } });
      expect(detail.stamps.scoringModels).toEqual([]);
      const serialised = JSON.stringify(detail);
      // Only an answer makes a question seen (04 `round_questions`).
      expect(serialised).toContain(questions[0].body);
      expect(serialised).not.toContain(questions[1].body);
      expect(serialised).not.toContain(questions[2].body);
      expect(serialised).not.toContain(attempt.id);

      // The same round, abandoned by tomorrow, shows what it scored.
      const tomorrow = await detailOf(db, round.id, new Date(Date.now() + 2 * 86_400_000));
      expect(tomorrow.round.status).toBe("abandoned");
      expect(tomorrow.rows[0]).toMatchObject({ scoring: { state: "ok", values: [5, 5, 5, 5, 5, 5] } });
    }));

  it("names the Japanese round's seven dimensions in both languages, for the pill", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const detail = await detailOf(db, world.id("complete-ja"));
      expect(detail.translated).toBe(true);
      expect(detail.dimensions).toHaveLength(7);
      expect(detail.dimensions.at(-1)).toMatchObject({ key: "keigo", labels: { ja: "敬語", en: expect.any(String) } });
      expect(detail.stamps.cvLabel).toBe("応募書類 v1");
    }));
});
