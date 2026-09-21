import { randomUUID } from "node:crypto";
import * as s from "../schema";
import type { TestDb } from "./database";

// Synthetic only. No real CV, transcript or note ever appears here (docs/11-testing-plan.md §8).

export async function insertUser(db: TestDb) {
  const id = randomUUID();
  await db.insert(s.users).values({ id, name: "fixture", email: `${id}@example.test` });
  return id;
}

export async function insertRubric(db: TestDb, language: "ja" | "en" = "ja") {
  const [row] = await db
    .insert(s.rubricVersions)
    .values({ versionLabel: `fixture-${randomUUID()}`, language, dimensions: [] })
    .returning({ id: s.rubricVersions.id });
  return row.id;
}

export async function insertCvVersion(db: TestDb, userId: string) {
  const [row] = await db
    .insert(s.cvVersions)
    .values({
      userId,
      versionLabel: "応募書類 v1",
      language: "ja",
      body: "架空の株式会社で請求処理を40%短縮。",
    })
    .returning({ id: s.cvVersions.id });
  return row.id;
}

export async function insertQuestion(db: TestDb, userId: string) {
  const [row] = await db
    .insert(s.questions)
    .values({
      userId,
      language: "ja",
      roundType: "behavioural",
      origin: "set_piece",
      body: "これまでで最も困難だった課題を教えてください。",
    })
    .returning({ id: s.questions.id });
  return row.id;
}

// A user, CV version, role context, rubric and question, ready for rounds and answers.
export async function insertWorld(db: TestDb) {
  const userId = await insertUser(db);
  const cvVersionId = await insertCvVersion(db, userId);
  const rubricVersionId = await insertRubric(db);
  const questionId = await insertQuestion(db, userId);
  const [context] = await db
    .insert(s.roleContexts)
    .values({ userId, kind: "general" })
    .returning({ id: s.roleContexts.id });
  return { userId, cvVersionId, rubricVersionId, questionId, roleContextId: context.id };
}

export type World = Awaited<ReturnType<typeof insertWorld>>;

export function roundValues(world: World, overrides: Partial<typeof s.rounds.$inferInsert> = {}) {
  return {
    userId: world.userId,
    roundType: "behavioural",
    language: "ja",
    mode: "realistic",
    length: 5,
    perAnswerCapSeconds: 240,
    cvVersionId: world.cvVersionId,
    roleContextId: world.roleContextId,
    rubricVersionId: world.rubricVersionId,
    ...overrides,
  } satisfies typeof s.rounds.$inferInsert;
}

export async function insertRound(db: TestDb, world: World) {
  const [row] = await db.insert(s.rounds).values(roundValues(world)).returning({ id: s.rounds.id });
  return row.id;
}

export function answerValues(
  world: World,
  roundId: string,
  overrides: Partial<typeof s.answers.$inferInsert> = {},
) {
  return {
    roundId,
    userId: world.userId,
    questionId: world.questionId,
    promptText: "これまでで最も困難だった課題を教えてください。",
    position: 1,
    language: "ja",
    ...overrides,
  } satisfies typeof s.answers.$inferInsert;
}

export async function insertAnswer(
  db: TestDb,
  world: World,
  roundId: string,
  overrides: Partial<typeof s.answers.$inferInsert> = {},
) {
  const [row] = await db
    .insert(s.answers)
    .values(answerValues(world, roundId, overrides))
    .returning({ id: s.answers.id });
  return row.id;
}

export function attemptValues(world: World, answerId: string) {
  return {
    answerId,
    userId: world.userId,
    cvVersionId: world.cvVersionId,
    rubricVersionId: world.rubricVersionId,
    generatorPromptVersion: "generate-fixture",
    modelId: "fixture-model-2026-01-01",
    scoringPromptVersion: "score-fixture",
  } satisfies typeof s.scoringAttempts.$inferInsert;
}

export async function insertAttempt(db: TestDb, world: World, answerId: string) {
  const [row] = await db
    .insert(s.scoringAttempts)
    .values(attemptValues(world, answerId))
    .returning({ id: s.scoringAttempts.id });
  return row.id;
}
