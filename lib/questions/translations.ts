import { and, desc, eq, inArray, notExists, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { questions, questionTranslations } from "../../db/schema.ts";

// A Japanese bank question's English (04 `question_translations`; 06, 2026-10-14, Q106-4, Q106-5):
// a row of its own, never a column of `questions`. **Append-only, and the newest row is the
// question's English**: a re-write is a new row beside the old one. A reading aid, not the record —
// no score reads it, no stamp names it, and no route writes it (07 §6). Imported by scripts, so the
// imports are relative and carry their extensions.

type Db = Pick<NodePgDatabase, "select" | "selectDistinctOn" | "insert">;

export type TranslationInsert = typeof questionTranslations.$inferInsert;

/** The language a question's English is in. Today always English, of a Japanese question. */
export const TRANSLATION_LANGUAGE = "en" as const;

/**
 * Each question's newest English, by question id. A question with no row is absent from the map:
 * it has no English, and the screens say so (10 §15).
 */
export async function newestEnglish(db: Pick<Db, "selectDistinctOn">, questionIds: readonly string[]): Promise<Map<string, string>> {
  const english = new Map<string, string>();
  if (questionIds.length === 0) return english;
  const rows = await db
    .selectDistinctOn([questionTranslations.questionId], {
      questionId: questionTranslations.questionId,
      body: questionTranslations.body,
    })
    .from(questionTranslations)
    .where(and(inArray(questionTranslations.questionId, [...questionIds]), eq(questionTranslations.language, TRANSLATION_LANGUAGE)))
    // The question_translations (question_id, language, created_at desc) index; the id breaks a tie
    // between two rows one statement wrote, so the answer never depends on the plan.
    .orderBy(questionTranslations.questionId, desc(questionTranslations.createdAt), desc(questionTranslations.id));
  for (const row of rows) english.set(row.questionId, row.body);
  return english;
}

/** One question's newest English, or null when it has none. */
export async function questionEnglish(db: Pick<Db, "selectDistinctOn">, questionId: string): Promise<string | null> {
  return (await newestEnglish(db, [questionId])).get(questionId) ?? null;
}

/** A translation refused before it is written: its question is missing, or already in that language. */
export class TranslationRefused extends Error {
  // A field, not a parameter property: scripts run this file under Node's type stripping.
  readonly reason: "no_such_question" | "same_language";

  constructor(reason: "no_such_question" | "same_language") {
    super(`translation refused: ${reason}`);
    this.reason = reason;
  }
}

/**
 * Appends one English to one question. **It never touches `questions`**: the question is read for
 * its owner and language, and nothing else. The writer refuses an English of an English question,
 * which the column check cannot see (04).
 */
export async function appendTranslation(
  db: Db,
  row: Omit<TranslationInsert, "userId" | "language" | "id" | "createdAt">,
): Promise<string> {
  const [question] = await db
    .select({ userId: questions.userId, language: questions.language })
    .from(questions)
    .where(eq(questions.id, row.questionId));
  if (!question) throw new TranslationRefused("no_such_question");
  if (question.language === TRANSLATION_LANGUAGE) throw new TranslationRefused("same_language");
  const [inserted] = await db
    .insert(questionTranslations)
    .values({ ...row, userId: question.userId, language: TRANSLATION_LANGUAGE })
    .returning({ id: questionTranslations.id });
  return inserted.id;
}

/** Every Japanese question with no English yet, oldest first: what the script translates (12 §1). */
export async function untranslatedQuestions(db: Pick<Db, "select">) {
  return db
    .select({ id: questions.id, roundType: questions.roundType, body: questions.body })
    .from(questions)
    .where(
      and(
        eq(questions.language, "ja"),
        notExists(
          db
            .select({ one: sql`1` })
            .from(questionTranslations)
            .where(
              and(eq(questionTranslations.questionId, questions.id), eq(questionTranslations.language, TRANSLATION_LANGUAGE)),
            ),
        ),
      ),
    )
    .orderBy(questions.createdAt, questions.id);
}

/**
 * A hand-written English for each Japanese question this user holds under `japaneseVersion` whose
 * body `english` names, unless the question already carries this content version's English — so
 * running it twice adds nothing, and a script's later re-write is never undone. No model call.
 */
export async function seedHandWrittenEnglish(
  db: Db,
  userId: string,
  japaneseVersion: string,
  englishVersion: string,
  english: ReadonlyMap<string, string>,
): Promise<number> {
  const held = await db
    .select({ id: questions.id, body: questions.body })
    .from(questions)
    .where(
      and(
        eq(questions.userId, userId),
        eq(questions.language, "ja"),
        eq(questions.generatorPromptVersion, japaneseVersion),
        inArray(questions.body, [...english.keys()]),
        notExists(
          db
            .select({ one: sql`1` })
            .from(questionTranslations)
            .where(
              and(
                eq(questionTranslations.questionId, questions.id),
                eq(questionTranslations.source, "hand_written"),
                eq(questionTranslations.promptVersion, englishVersion),
              ),
            ),
        ),
      ),
    );
  if (held.length === 0) return 0;
  await db.insert(questionTranslations).values(
    held.map((question) => ({
      questionId: question.id,
      userId,
      language: TRANSLATION_LANGUAGE,
      body: english.get(question.body)!,
      source: "hand_written" as const,
      // No model wrote these: the null says so, and the content version is the prompt version (04).
      modelId: null,
      promptVersion: englishVersion,
    })),
  );
  return held.length;
}
