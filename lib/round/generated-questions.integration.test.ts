import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as s from "../../db/schema";
import { seedUser } from "../../db/seed";
import { seedSyntheticCv } from "../../db/seed-cv";
import { seedRubrics, seedSetPieces, seedSyntheticQuestions } from "../../db/seed-questions";
import { closePool, expectRefused, inRolledBackTransaction, type TestDb } from "../../db/test/database";
import { insertUser } from "../../db/test/fixtures";
import {
  fakeEmbedder,
  fakeModelHealth,
  fakeQuestionGenerator,
  fakeScorer,
  numberedQuestions,
  uniformScores,
  vectorNear,
} from "../ai/fake-round-ports";
import type { QuestionGenerationInput, QuestionGenerationResult } from "../ai/generate-questions";
import { ModelCallFailed } from "../ai/upstream";
import { createAuth } from "../auth/auth";
import { mintSessionCookie } from "../auth/test/session";
import { getConfig } from "../config";
import { characterLength } from "../cv/spans";
import { NEAR_DUPLICATE_THRESHOLD, admitCandidate, nearestQuestion, type QuestionSlice } from "../questions/near-duplicate";
import { SPARE_CANDIDATES } from "./generate-candidates";
import { MAX_POSTING_CHARS } from "./limits";
import { createPostRound } from "./post-round";
import { createPostRoleContext } from "./role-context";

// #47 through its handlers and its guard, against the migrated test database: generation at round
// start, the near-duplicate guard (11 §3.7), the questions a round fixes (11 §3.13) and the posting.
// The generator and the embedder are fakes with fixed vectors (11 §2), so what is under test is the
// decision rule, not a model.

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

// A step either side of the threshold wide enough to survive `vector`'s float4 storage.
const ABOVE = NEAR_DUPLICATE_THRESHOLD + 0.03;
const BELOW = NEAR_DUPLICATE_THRESHOLD - 0.03;

const STAMPS = {
  generatorModelId: "fake-generator-2026-01-01",
  generatorPromptVersion: "generate-behavioural-en-1.0",
  embeddingModelId: "fake-embedder-2026-01-01",
  tokensIn: null,
  tokensOut: null,
};

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

function savepointTransaction(db: TestDb, fail: { next: boolean }, depth: { open: number }) {
  return async <T>(work: (tx: TestDb) => Promise<T>) => {
    await db.execute(sql`savepoint round_write`);
    depth.open += 1;
    try {
      const result = await work(db);
      // After the work, so the failure undoes questions the guard had already inserted.
      if (fail.next) {
        fail.next = false;
        throw Object.assign(new Error(`insert failed: ${SENTINEL}`), { code: "57014" });
      }
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

type Respond = (input: QuestionGenerationInput) => QuestionGenerationResult | Promise<QuestionGenerationResult>;

async function setUp(
  db: TestDb,
  {
    healthy = true,
    respond = numberedQuestions(),
    vectorOf,
  }: { healthy?: boolean; respond?: Respond; vectorOf?: (text: string) => readonly number[] | undefined } = {},
) {
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
  const inTransactionAtGeneration: boolean[] = [];
  const questionGenerator = fakeQuestionGenerator((input) => {
    inTransactionAtGeneration.push(depth.open > 0);
    return respond(input);
  });
  const embedder = fakeEmbedder(vectorOf);
  const health = fakeModelHealth(healthy);
  const base = { auth, db, transaction: savepointTransaction(db, fail, depth) };
  const handlers = {
    roleContext: createPostRoleContext(base),
    round: createPostRound({ ...base, health, scorer: fakeScorer(uniformScores(3)), questionGenerator, embedder }),
  };

  const responses: string[] = [];
  async function post(handler: (request: Request) => Promise<Response>, body: unknown, { signedIn = true } = {}) {
    const response = await handler(
      new Request("http://localhost:3000/api/x", {
        method: "POST",
        headers: { "content-type": "application/json", ...(signedIn ? { cookie: `${cookie.name}=${cookie.value}` } : {}) },
        body: JSON.stringify(body),
      }),
    );
    const text = await response.text();
    responses.push(text);
    return { status: response.status, json: JSON.parse(text) };
  }

  async function general() {
    return (await post(handlers.roleContext, { kind: "general" })).json.id as string;
  }

  async function startRound(overrides: object = {}) {
    return post(handlers.round, {
      round_type: "behavioural",
      language: "en",
      mode: "realistic",
      length: 5,
      role_context_id: await general(),
      ...overrides,
    });
  }

  /** The round's questions, in the order they will be asked. */
  async function asked(roundId: string) {
    return db
      .select({ id: s.questions.id, origin: s.questions.origin, body: s.questions.body, roundType: s.questions.roundType })
      .from(s.roundQuestions)
      .innerJoin(s.questions, eq(s.questions.id, s.roundQuestions.questionId))
      .where(eq(s.roundQuestions.roundId, roundId))
      .orderBy(s.roundQuestions.position);
  }

  /** An answer to the question, in a round of its own: what makes a question seen (04). */
  async function answer(questionId: string, language: "en" | "ja" = "en") {
    const [[cv], [rubric], contextId] = [
      await db.select({ id: s.cvVersions.id }).from(s.cvVersions).where(eq(s.cvVersions.userId, user.id)),
      await db.select({ id: s.rubricVersions.id }).from(s.rubricVersions).where(eq(s.rubricVersions.language, "en")),
      await general(),
    ];
    const [round] = await db
      .insert(s.rounds)
      .values({
        userId: user.id,
        roundType: "behavioural",
        language,
        mode: "realistic",
        length: 3,
        perAnswerCapSeconds: 240,
        cvVersionId: cv.id,
        roleContextId: contextId,
        rubricVersionId: rubric.id,
        startedAt: new Date(Date.now() - 60_000),
      })
      .returning({ id: s.rounds.id });
    const [row] = await db
      .insert(s.answers)
      .values({ roundId: round.id, userId: user.id, questionId, promptText: "fixture", position: 1, language })
      .returning({ id: s.answers.id });
    return row.id;
  }

  const slice = (overrides: Partial<QuestionSlice> = {}): QuestionSlice => ({
    userId: user.id,
    language: "en",
    roundType: "behavioural",
    ...overrides,
  });

  /** A generated question already in the bank, with an embedding the guard can compare against. */
  async function banked(body: string, embedding: number[], overrides: Partial<typeof s.questions.$inferInsert> = {}) {
    const [row] = await db
      .insert(s.questions)
      .values({
        userId: user.id,
        language: "en",
        roundType: "behavioural",
        origin: "generated",
        body,
        embedding,
        generatorModelId: "fake-generator-2026-01-01",
        generatorPromptVersion: "generate-behavioural-en-1.0",
        ...overrides,
      })
      .returning({ id: s.questions.id });
    return row.id;
  }

  const inSlice = (roundType: QuestionSlice["roundType"] = "behavioural") =>
    db
      .select()
      .from(s.questions)
      .where(and(eq(s.questions.userId, user.id), eq(s.questions.language, "en"), eq(s.questions.roundType, roundType)))
      .orderBy(asc(s.questions.createdAt), asc(s.questions.id));

  const checks = () => db.select().from(s.nearDuplicateChecks).where(eq(s.nearDuplicateChecks.userId, user.id));

  return {
    userId: user.id,
    fail,
    inTransactionAtGeneration,
    questionGenerator,
    embedder,
    health,
    handlers,
    post,
    responses,
    general,
    startRound,
    asked,
    answer,
    slice,
    banked,
    inSlice,
    checks,
  };
}

const count = async (db: TestDb, table: typeof s.rounds | typeof s.roundQuestions | typeof s.questions | typeof s.nearDuplicateChecks) =>
  (await db.select({ id: table.id }).from(table)).length;

describe("the near-duplicate guard (11 §3.7)", () => {
  it("reuses the existing question at or above the threshold, and inserts nothing", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const existing = await world.banked("An existing question?", vectorNear(1));
      const before = await count(db, s.questions);

      const admission = await admitCandidate(db, world.slice(), { body: "The same question, reworded?", embedding: vectorNear(1, ABOVE) }, STAMPS);

      expect(admission).toEqual({ kind: "reused", questionId: existing });
      expect(await count(db, s.questions)).toBe(before);
    }));

  it("reuses at the threshold exactly: the rule is at or above", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const existing = await world.banked("An existing question?", vectorNear(1));
      const embedding = vectorNear(1, BELOW);
      // Whatever the database makes of this pair is the threshold the guard is then given.
      const measured = (await nearestQuestion(db, world.slice(), embedding))!.similarity;

      const admission = await admitCandidate(db, world.slice(), { body: "On the line?", embedding }, STAMPS, measured);

      expect(admission).toEqual({ kind: "reused", questionId: existing });
    }));

  it("inserts below the threshold, with its embedding stored and its stamps set", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      await world.banked("An existing question?", vectorNear(1));
      const embedding = vectorNear(1, BELOW);

      const admission = await admitCandidate(db, world.slice(), { body: "A different question?", embedding }, { ...STAMPS, tokensIn: 900, tokensOut: 120 });

      expect(admission.kind).toBe("inserted");
      const [stored] = await db.select().from(s.questions).where(eq(s.questions.id, admission.questionId));
      expect(stored).toMatchObject({
        origin: "generated",
        language: "en",
        roundType: "behavioural",
        body: "A different question?",
        generatorModelId: STAMPS.generatorModelId,
        generatorPromptVersion: STAMPS.generatorPromptVersion,
        tokensIn: 900,
        tokensOut: 120,
        retiredAt: null,
      });
      expect(stored.embedding).toHaveLength(embedding.length);
      expect(stored.embedding![2]).toBeCloseTo(embedding[2], 5);
      expect(stored.embedding![3]).toBeCloseTo(embedding[3], 5);
    }));

  it.each([
    ["another language", { language: "ja" }],
    ["another round type", { roundType: "hr" }],
  ] as const)("is not suppressed by a near-identical question in %s", (_, elsewhere) =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      await world.banked("The same question, elsewhere?", vectorNear(1), elsewhere);

      const admission = await admitCandidate(db, world.slice(), { body: "The same question, here?", embedding: vectorNear(1) }, STAMPS);

      expect(admission.kind).toBe("inserted");
      // Nothing in its own slice to compare with: no check, rather than one at similarity zero.
      expect(await world.checks()).toHaveLength(0);
    }));

  it("is not suppressed by another user's identical question", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      await world.banked("Someone else's question?", vectorNear(1), { userId: await insertUser(db) });

      expect((await admitCandidate(db, world.slice(), { body: "Mine?", embedding: vectorNear(1) }, STAMPS)).kind).toBe("inserted");
    }));

  it("is not suppressed by a retired question, which keeps every answer that referenced it", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const retired = await world.banked("A retired question?", vectorNear(1));
      const answerId = await world.answer(retired);
      await db.update(s.questions).set({ retiredAt: new Date() }).where(eq(s.questions.id, retired));

      const admission = await admitCandidate(db, world.slice(), { body: "The retired question, again?", embedding: vectorNear(1) }, STAMPS);

      expect(admission.kind).toBe("inserted");
      expect(admission.questionId).not.toBe(retired);
      const [kept] = await db.select().from(s.answers).where(eq(s.answers.id, answerId));
      expect(kept.questionId).toBe(retired);
      expect(await db.select().from(s.questions).where(eq(s.questions.id, retired))).toHaveLength(1);
    }));

  it("never compares against a question with no embedding, such as a set piece", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      // The seeded behavioural questions carry no embedding, and they are all the slice holds.
      expect(await nearestQuestion(db, world.slice(), vectorNear(1))).toBeNull();
    }));

  it("compares with the nearest question, not the first one", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      await world.banked("Far?", vectorNear(2));
      const near = await world.banked("Near?", vectorNear(1));
      await world.banked("Further?", vectorNear(3));

      const nearest = await nearestQuestion(db, world.slice(), vectorNear(1, 0.8));

      expect(nearest!.id).toBe(near);
      expect(nearest!.similarity).toBeCloseTo(0.8, 5);
    }));

  it("stores every comparison with its similarity, the threshold in force and what it matched", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const existing = await world.banked("An existing question?", vectorNear(1));

      // The duplicate first: once the near-miss is in the bank it is a neighbour too.
      const reuse = await admitCandidate(db, world.slice(), { body: "A duplicate?", embedding: vectorNear(1, ABOVE) }, STAMPS);
      const miss = await admitCandidate(db, world.slice(), { body: "A near-miss?", embedding: vectorNear(1, BELOW) }, STAMPS);

      const rows = (await world.checks()).sort((a, b) => a.similarity - b.similarity);
      expect(rows).toHaveLength(2);
      // The near-miss: inserted beside the question it resembled.
      expect(rows[0]).toMatchObject({
        matchedQuestionId: existing,
        questionId: miss.questionId,
        threshold: NEAR_DUPLICATE_THRESHOLD,
        embeddingModelId: STAMPS.embeddingModelId,
      });
      expect(rows[0].similarity).toBeCloseTo(BELOW, 5);
      // The reuse: no row of its own.
      expect(rows[1]).toMatchObject({ matchedQuestionId: existing, questionId: null, threshold: NEAR_DUPLICATE_THRESHOLD });
      expect(rows[1].similarity).toBeCloseTo(ABOVE, 5);
      expect(reuse.questionId).toBe(existing);
    }));

  it("holds a check to what its numbers say, and to no text", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const existing = await world.banked("An existing question?", vectorNear(1));
      const other = await world.banked("Another?", vectorNear(2));
      const row = { userId: world.userId, matchedQuestionId: existing, threshold: 0.9, embeddingModelId: "fixture" };

      // Above the threshold yet inserted, and below it yet reused: neither can be written.
      await expectRefused(db, () => db.insert(s.nearDuplicateChecks).values({ ...row, questionId: other, similarity: 0.95 }), {
        kind: "check",
        constraint: "near_duplicate_checks_decision_check",
      });
      await expectRefused(db, () => db.insert(s.nearDuplicateChecks).values({ ...row, questionId: null, similarity: 0.5 }), {
        kind: "check",
        constraint: "near_duplicate_checks_decision_check",
      });
      await expectRefused(db, () => db.insert(s.nearDuplicateChecks).values({ ...row, questionId: existing, similarity: 0.5 }), {
        kind: "check",
        constraint: "near_duplicate_checks_distinct_check",
      });

      const columns = await db.execute<{ column_name: string; data_type: string }>(sql`
        select column_name, data_type from information_schema.columns where table_name = 'near_duplicate_checks'`);
      const text = columns.rows.filter((column) => column.data_type === "text").map((column) => column.column_name);
      expect(text.sort()).toEqual(["embedding_model_id", "user_id"]);
    }));

  it("keeps a question that a check points at: the record is not deletable", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const existing = await world.banked("An existing question?", vectorNear(1));
      await admitCandidate(db, world.slice(), { body: "A duplicate?", embedding: vectorNear(1, ABOVE) }, STAMPS);

      await expectRefused(db, () => db.delete(s.questions).where(eq(s.questions.id, existing)), {
        kind: "restrict",
        constraint: "near_duplicate_checks_matched_question_id_questions_id_fk",
      });
    }));
});

describe("POST /api/rounds — generation at round start (07 §5.4, 11 §3.13)", () => {
  it("generates only the shortfall, and writes exactly `length` round_questions", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      // Three unseen behavioural questions are seeded; a round of five is two short.
      const { status, json } = await world.startRound();

      expect(status).toBe(201);
      expect(world.questionGenerator.calls).toBe(1);
      expect(world.questionGenerator.inputs[0]).toMatchObject({ language: "en", roundType: "behavioural", count: 2 + SPARE_CANDIDATES });
      const asked = await world.asked(json.round.id);
      expect(asked).toHaveLength(5);
      expect(new Set(asked.map((question) => question.id)).size).toBe(5);
      // Unseen bank questions first, then the new ones, in the model's order.
      expect(asked.slice(3).map((question) => question.body)).toEqual(["Generated fixture question 1?", "Generated fixture question 2?"]);
      // The spare candidates were not needed, and are not in the bank.
      expect(await world.inSlice()).toHaveLength(5);
    }));

  it("stamps what it writes: origin, model, prompt version, embedding, and the call's tokens once", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { json } = await world.startRound();
      const asked = await world.asked(json.round.id);
      const written = await db
        .select()
        .from(s.questions)
        .where(eq(s.questions.generatorModelId, world.questionGenerator.modelId))
        .orderBy(asc(s.questions.createdAt), asc(s.questions.body));

      expect(written.map((question) => question.id).sort()).toEqual(asked.slice(3).map((question) => question.id).sort());
      for (const question of written) {
        expect(question).toMatchObject({ origin: "generated", generatorPromptVersion: "generate-behavioural-en-1.0", retiredAt: null });
        expect(question.embedding).toHaveLength(1536);
      }
      // One call wrote both rows; a sum over rows is the call's spend (04 `questions`).
      expect(written.map((question) => question.tokensIn).filter((tokens) => tokens !== null)).toEqual([900]);
      expect(written.map((question) => question.tokensOut).filter((tokens) => tokens !== null)).toEqual([120]);
    }));

  it("gives the generator the CV as claims quoted from its body, General practice, and the slice's questions", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      await world.startRound();
      const [input] = world.questionGenerator.inputs;
      const [cv] = await db.select({ body: s.cvVersions.body }).from(s.cvVersions).where(eq(s.cvVersions.userId, world.userId));

      expect(input.roleContext).toEqual({ kind: "general" });
      expect(input.claims.length).toBeGreaterThan(0);
      for (const claim of input.claims) expect(cv.body).toContain(claim);
      // The three seeded questions: what the slice held before this call wrote to it.
      const seeded = (await world.inSlice()).filter((question) => question.generatorModelId === null);
      expect([...input.existing].sort()).toEqual(seeded.map((question) => question.body).sort());
    }));

  it("tells the generator the set pieces of the round's type, so it does not ask them again", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      await db.update(s.questions).set({ retiredAt: new Date() }).where(and(eq(s.questions.origin, "generated"), eq(s.questions.roundType, "hr")));
      const { status } = await world.startRound({ round_type: "hr", length: 3 });

      expect(status).toBe(201);
      const setPieces = (await world.inSlice("hr")).filter((question) => question.origin === "set_piece");
      expect(setPieces.length).toBeGreaterThan(0);
      for (const piece of setPieces) expect(world.questionGenerator.inputs[0].existing).toContain(piece.body);
    }));

  it("gives the generator the picked posting", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const posting = await world.post(world.handlers.roleContext, {
        kind: "posting",
        company_name: "Invented Freight",
        role_title: "Backend Engineer",
        body: "An invented posting for a backend engineer.",
      });
      await world.startRound({ role_context_id: posting.json.id });

      expect(world.questionGenerator.inputs[0].roleContext).toEqual({
        kind: "posting",
        companyName: "Invented Freight",
        roleTitle: "Backend Engineer",
        body: "An invented posting for a backend engineer.",
      });
    }));

  it("runs generation before the transaction, never inside it", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      await world.startRound();
      expect(world.inTransactionAtGeneration).toEqual([false]);
    }));

  it("generates a whole round from an empty slice", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      await db.update(s.questions).set({ retiredAt: new Date() }).where(eq(s.questions.roundType, "behavioural"));

      const { status, json } = await world.startRound({ length: 7 });

      expect(status).toBe(201);
      expect(world.questionGenerator.inputs[0].count).toBe(7 + SPARE_CANDIDATES);
      expect((await world.asked(json.round.id)).map((question) => question.origin)).toEqual(Array(7).fill("generated"));
      // The first has nothing to compare with; each later one is compared with those before it.
      expect(await world.checks()).toHaveLength(6);
    }));

  it("asks a reloaded round the same questions without calling the generator again", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { json } = await world.startRound();
      const first = await world.asked(json.round.id);
      const second = await world.asked(json.round.id);

      expect(second).toEqual(first);
      expect(world.questionGenerator.calls).toBe(1);
    }));

  it("maps a near-duplicate candidate to the bank's question, and fills its place with the next candidate", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db, {
        vectorOf: (text) => (text === "Generated fixture question 1?" ? vectorNear(1, ABOVE) : undefined),
      });
      const existing = await world.banked("An existing question?", vectorNear(1));

      // Four unseen now, so a round of five is one short; the first candidate duplicates `existing`.
      const { status, json } = await world.startRound();

      expect(status).toBe(201);
      const asked = await world.asked(json.round.id);
      expect(asked.map((question) => question.id).filter((id) => id === existing)).toHaveLength(1);
      expect(asked.at(-1)!.body).toBe("Generated fixture question 2?");
      expect((await world.inSlice()).map((question) => question.body)).not.toContain("Generated fixture question 1?");
      const reused = (await world.checks()).filter((check) => check.questionId === null);
      expect(reused).toHaveLength(1);
      expect(reused[0].matchedQuestionId).toBe(existing);
    }));

  it("collapses two rephrasings that arrive in one generation call", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db, {
        vectorOf: (text) =>
          text === "Generated fixture question 1?" ? vectorNear(1) : text === "Generated fixture question 2?" ? vectorNear(1, ABOVE) : undefined,
      });
      const { json } = await world.startRound();

      const bodies = (await world.asked(json.round.id)).map((question) => question.body);
      expect(bodies).toContain("Generated fixture question 1?");
      expect(bodies).not.toContain("Generated fixture question 2?");
      expect(bodies).toContain("Generated fixture question 3?");
    }));

  it("asks an answered question as a repeat when every candidate duplicates it: said on Setup first", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db, { vectorOf: () => vectorNear(1, ABOVE) });
      const seen = await world.banked("An answered question?", vectorNear(1));
      await world.answer(seen);
      await world.banked("Unseen and unlike?", vectorNear(2));
      const before = await count(db, s.questions);

      // Four unseen, one short; every candidate duplicates the seen question, which fills the place.
      const { status, json } = await world.startRound({ length: 5 });

      expect(status).toBe(201);
      const asked = await world.asked(json.round.id);
      expect(asked.at(-1)!.id).toBe(seen);
      expect(new Set(asked.map((question) => question.id)).size).toBe(5);
      expect(await count(db, s.questions)).toBe(before);
    }));

  it("is 502 bank_too_small when the candidates and the repeats together cannot fill the round, and creates nothing", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db, { vectorOf: () => vectorNear(1, ABOVE) });
      const seen = await world.banked("An answered question?", vectorNear(1));
      await world.answer(seen);
      const rounds = await count(db, s.rounds);

      // Three unseen, two short; every candidate duplicates the one seen question, which fills one place.
      const { status, json } = await world.startRound({ length: 5 });

      expect(status).toBe(502);
      expect(json.error).toMatchObject({ code: "question_generation_failed", detail: { error_class: "bank_too_small" } });
      expect(await count(db, s.rounds)).toBe(rounds);
      // The transaction that would have stored the comparisons was rolled back with the round.
      expect(await count(db, s.nearDuplicateChecks)).toBe(0);
    }));

  it("is 502 question_generation_failed with the call's error class, and creates nothing", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db, {
        respond: () => {
          throw new ModelCallFailed("Question generation", "upstream_503");
        },
      });
      const before = await count(db, s.questions);
      const { status, json } = await world.startRound();

      expect(status).toBe(502);
      expect(json.error).toMatchObject({ code: "question_generation_failed", detail: { error_class: "upstream_503" } });
      expect(await count(db, s.rounds)).toBe(0);
      expect(await count(db, s.questions)).toBe(before);
    }));

  it("is 502 when the embedding call fails, and creates nothing", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      world.embedder.embed = async () => {
        throw new ModelCallFailed("Embedding", "upstream_timeout");
      };
      const before = await count(db, s.questions);
      const { status, json } = await world.startRound();

      expect(status).toBe(502);
      expect(json.error.detail).toEqual({ error_class: "upstream_timeout" });
      expect(await count(db, s.rounds)).toBe(0);
      expect(await count(db, s.questions)).toBe(before);
    }));

  it("is 503 model_unavailable when the preflight fails, even if generation succeeded, and banks nothing", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db, { healthy: false });
      const before = await count(db, s.questions);
      const { status, json } = await world.startRound();

      expect(status).toBe(503);
      expect(json.error.code).toBe("model_unavailable");
      expect(await count(db, s.questions)).toBe(before);
      expect(await count(db, s.nearDuplicateChecks)).toBe(0);
    }));

  it("leaves no question behind when the round's write fails", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const contextId = await world.general();
      const before = await count(db, s.questions);
      world.fail.next = true;
      const { status, json } = await world.post(world.handlers.round, {
        round_type: "behavioural",
        language: "en",
        mode: "realistic",
        length: 7,
        role_context_id: contextId,
      });

      expect(status).toBe(500);
      expect(json.error).toMatchObject({ code: "write_failed", detail: { error_class: "pg_57014" } });
      expect(await count(db, s.questions)).toBe(before);
      expect(await count(db, s.nearDuplicateChecks)).toBe(0);
      expect(await count(db, s.rounds)).toBe(0);
    }));

  it("carries no question, posting or CV text into any envelope or log line", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db, {
        respond: (input) => ({
          questions: Array.from({ length: input.count }, (_, index) => `${SENTINEL} question ${index}?`),
          tokensIn: 1,
          tokensOut: 1,
        }),
      });
      const posting = await world.post(world.handlers.roleContext, {
        kind: "posting",
        company_name: `${SENTINEL} Ltd`,
        role_title: `${SENTINEL} engineer`,
        body: `${SENTINEL} posting text.`,
        source_filename: `${SENTINEL}.pdf`,
      });
      const started = await world.startRound({ role_context_id: posting.json.id });
      expect(started.status).toBe(201);
      world.fail.next = true;
      await world.startRound({ role_context_id: posting.json.id, length: 7 });

      for (const line of logged) expect(line).not.toContain(SENTINEL);
      for (const text of world.responses) {
        // A posting's own fields go back to its owner, and so does the first question, by design.
        if (text.includes('"company_name"') || text.includes('"prompt"')) continue;
        expect(text).not.toContain(SENTINEL);
      }
    }));
});

describe("POST /api/rounds — practice prefers seen questions (07 §5.4)", () => {
  it("asks answered questions first, then unseen ones, and takes no set piece", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const hr = await world.inSlice("hr");
      const generated = hr.filter((question) => question.origin === "generated");
      await world.answer(generated[4].id);
      await world.answer(generated[6].id);

      const { status, json } = await world.startRound({ round_type: "hr", mode: "practice", length: 3 });

      expect(status).toBe(201);
      expect(json.round.per_answer_cap_seconds).toBe(900);
      const asked = await world.asked(json.round.id);
      expect(asked.map((question) => question.id)).toEqual([generated[4].id, generated[6].id, generated[0].id]);
      expect(asked.every((question) => question.origin === "generated")).toBe(true);
      expect(world.questionGenerator.calls).toBe(0);
    }));

  it("asks the unseen ones first in a realistic round over the same bank", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const generated = (await world.inSlice("hr")).filter((question) => question.origin === "generated");
      await world.answer(generated[0].id);
      await world.answer(generated[1].id);

      const { json } = await world.startRound({ round_type: "hr", length: 3 });

      const asked = await world.asked(json.round.id);
      expect(asked[0].origin).toBe("set_piece");
      expect(asked.slice(1).map((question) => question.id)).toEqual([generated[2].id, generated[3].id]);
      expect(world.questionGenerator.calls).toBe(0);
    }));

  it("generates for a practice round only what the bank cannot give", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { status, json } = await world.startRound({ mode: "practice", length: 5 });

      expect(status).toBe(201);
      expect(world.questionGenerator.inputs[0].count).toBe(2 + SPARE_CANDIDATES);
      expect(await world.asked(json.round.id)).toHaveLength(5);
    }));
});

describe("POST /api/role-contexts — a posting (07 §5.3)", () => {
  const posting = { kind: "posting", company_name: "Invented Freight", role_title: "Backend Engineer", body: "An invented posting." };

  it("saves a pasted posting and returns it without its text", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { status, json } = await world.post(world.handlers.roleContext, posting);

      expect(status).toBe(201);
      expect(json).toEqual({
        id: expect.any(String),
        kind: "posting",
        company_name: "Invented Freight",
        role_title: "Backend Engineer",
        source_filename: null,
        created_at: expect.any(String),
      });
      const [row] = await db.select().from(s.roleContexts).where(eq(s.roleContexts.id, json.id));
      expect(row).toMatchObject({ userId: world.userId, kind: "posting", body: "An invented posting.", sourceFilename: null });
    }));

  it("keeps the name of the file an imported posting came from, and never the file", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { status, json } = await world.post(world.handlers.roleContext, { ...posting, source_filename: "invented_posting.pdf" });

      expect(status).toBe(201);
      expect(json.source_filename).toBe("invented_posting.pdf");
      const [row] = await db.select().from(s.roleContexts).where(eq(s.roleContexts.id, json.id));
      expect(row.sourceFilename).toBe("invented_posting.pdf");
    }));

  it("is immutable: the same posting saved twice is two rows, and a changed one a third", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const first = await world.post(world.handlers.roleContext, posting);
      const second = await world.post(world.handlers.roleContext, posting);
      await world.post(world.handlers.roleContext, { ...posting, body: "An invented posting, changed." });

      expect(second.status).toBe(201);
      expect(second.json.id).not.toBe(first.json.id);
      const rows = await db.select().from(s.roleContexts).where(and(eq(s.roleContexts.userId, world.userId), eq(s.roleContexts.kind, "posting")));
      expect(rows).toHaveLength(3);
      expect(rows.find((row) => row.id === first.json.id)!.body).toBe("An invented posting.");
    }));

  it("trims what it stores", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { json } = await world.post(world.handlers.roleContext, {
        ...posting,
        company_name: "  Invented Freight ",
        body: "\n An invented posting. \n",
      });
      const [row] = await db.select().from(s.roleContexts).where(eq(s.roleContexts.id, json.id));
      expect(row).toMatchObject({ companyName: "Invented Freight", body: "An invented posting." });
    }));

  it("is 422 role_context_too_large over the cap, before anything is saved", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { status, json } = await world.post(world.handlers.roleContext, { ...posting, body: "a".repeat(MAX_POSTING_CHARS + 1) });

      expect(status).toBe(422);
      expect(json.error).toMatchObject({
        code: "role_context_too_large",
        detail: { body_chars: MAX_POSTING_CHARS + 1, max_body_chars: MAX_POSTING_CHARS },
      });
      expect(await db.select().from(s.roleContexts).where(eq(s.roleContexts.userId, world.userId))).toHaveLength(0);
    }));

  it("counts the cap in code points, so a posting at the cap in any script is saved", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      // Each is one code point and two UTF-16 units: at the cap by the unit the cap is stated in.
      const body = "𠮷".repeat(MAX_POSTING_CHARS);
      expect(body.length).toBe(2 * MAX_POSTING_CHARS);
      expect(characterLength(body)).toBe(MAX_POSTING_CHARS);

      expect((await world.post(world.handlers.roleContext, { ...posting, body })).status).toBe(201);
    }));

  it.each([
    ["no company", { ...posting, company_name: undefined }, "company_name"],
    ["a blank company", { ...posting, company_name: "   " }, "company_name"],
    ["no role title", { ...posting, role_title: undefined }, "role_title"],
    ["a role title over 200 characters", { ...posting, role_title: "t".repeat(201) }, "role_title"],
    ["no text", { ...posting, body: " " }, "body"],
    ["a blank filename", { ...posting, source_filename: "" }, "source_filename"],
    ["an unknown field", { ...posting, notes: "x" }, "notes"],
    ["research, until US-16", { kind: "researched", company_name: "Invented Freight" }, "kind"],
    ["General practice with a company", { kind: "general", company_name: "Invented Freight" }, "company_name"],
  ])("refuses %s with a 400 naming the field, and saves nothing", (_, body, field) =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { status, json } = await world.post(world.handlers.roleContext, body);

      expect(status).toBe(400);
      expect(json.error.code).toBe("invalid_request");
      expect(JSON.stringify(json.error.detail)).toContain(field);
      expect(await db.select().from(s.roleContexts).where(eq(s.roleContexts.userId, world.userId))).toHaveLength(0);
    }));

  it("is 401 with no session", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      expect((await world.post(world.handlers.roleContext, posting, { signedIn: false })).status).toBe(401);
    }));

  it("leaves General practice one row per user beside any number of postings", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      await world.post(world.handlers.roleContext, posting);
      await world.general();
      await world.general();

      const general = await db.select().from(s.roleContexts).where(and(eq(s.roleContexts.userId, world.userId), eq(s.roleContexts.kind, "general")));
      expect(general).toHaveLength(1);
      expect(general[0]).toMatchObject({ companyName: null, roleTitle: null, body: null, sourceFilename: null });
      expect(await db.select().from(s.roleContexts).where(and(eq(s.roleContexts.userId, world.userId), isNull(s.roleContexts.body)))).toHaveLength(1);
    }));

  it("is a 404 for another user's posting at round start", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const [theirs] = await db
        .insert(s.roleContexts)
        .values({ userId: await insertUser(db), kind: "posting", companyName: "Theirs", roleTitle: "Theirs", body: "Theirs." })
        .returning({ id: s.roleContexts.id });

      const { status, json } = await world.startRound({ role_context_id: theirs.id });

      expect(status).toBe(404);
      expect(json.error.code).toBe("not_found");
      expect(world.questionGenerator.calls).toBe(0);
    }));
});
