import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { questions } from "../../db/schema.ts";
import type { QuestionTranslator } from "../ai/translate-question.ts";
import { upstreamErrorClass } from "../ai/upstream.ts";
import { appendTranslation, untranslatedQuestions } from "./translations.ts";

// What `scripts/translate-questions.mts` does, apart from its command line (12 §1): writes a
// `translated` English for every Japanese question with none, or a new one beside the old for the one
// question it is told to re-write. **It never touches `questions`** (04 `question_translations`): a
// question is read for its text and kind, and the English is a row of its own.

type Db = Pick<NodePgDatabase, "select" | "selectDistinctOn" | "insert">;

/** One line of the script's output: ids, counts and error classes, never a question or its English (12 §7). */
export type TranslationEvent =
  | { readonly event: "translated"; readonly question_id: string }
  | { readonly event: "translation_failed"; readonly question_id: string; readonly error_class: string };

export interface TranslationRun {
  readonly written: number;
  readonly failed: number;
}

/** Thrown for a re-write the script cannot do: no such question, or not a Japanese one. */
export class RewriteRefused extends Error {
  // A field, not a parameter property: scripts run this file under Node's type stripping.
  readonly reason: "no_such_question" | "not_japanese";

  constructor(reason: "no_such_question" | "not_japanese") {
    super(`re-write refused: ${reason}`);
    this.reason = reason;
  }
}

async function translateOne(
  db: Db,
  translator: QuestionTranslator,
  question: { id: string; roundType: (typeof questions.$inferSelect)["roundType"]; body: string },
  report: (event: TranslationEvent) => void,
): Promise<boolean> {
  let result;
  try {
    result = await translator.translate({ roundType: question.roundType, body: question.body });
  } catch (error) {
    report({ event: "translation_failed", question_id: question.id, error_class: upstreamErrorClass(error) });
    return false;
  }
  await appendTranslation(db, {
    questionId: question.id,
    body: result.english,
    source: "translated",
    modelId: translator.modelId,
    promptVersion: translator.promptVersion,
    // The call's tokens, on its one row: the week's spend counts them (12 §6).
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
  });
  report({ event: "translated", question_id: question.id });
  return true;
}

/**
 * With `rewrite` null, every Japanese question that has no English yet, one call each; a failed call
 * is reported by class and leaves that question without one, for the next run. With `rewrite` set,
 * that one question, whether or not it has an English: the new row is the newest, and the old stays.
 */
export async function translateQuestions(
  db: Db,
  translator: QuestionTranslator,
  { rewrite }: { readonly rewrite: string | null },
  report: (event: TranslationEvent) => void,
): Promise<TranslationRun> {
  let pending: { id: string; roundType: (typeof questions.$inferSelect)["roundType"]; body: string }[];
  if (rewrite !== null) {
    const [question] = await db
      .select({ id: questions.id, roundType: questions.roundType, body: questions.body, language: questions.language })
      .from(questions)
      .where(eq(questions.id, rewrite));
    if (!question) throw new RewriteRefused("no_such_question");
    if (question.language !== "ja") throw new RewriteRefused("not_japanese");
    pending = [question];
  } else {
    pending = await untranslatedQuestions(db);
  }
  let written = 0;
  for (const question of pending) {
    if (await translateOne(db, translator, question, report)) written += 1;
  }
  return { written, failed: pending.length - written };
}
