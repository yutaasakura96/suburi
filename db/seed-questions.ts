import { and, eq, inArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { RUBRICS } from "../lib/rubric/index.ts";
import { SET_PIECES, type SetPieceContent } from "../lib/questions/set-pieces.ts";
import { questions, rubricVersions } from "./schema.ts";

type Db = Pick<NodePgDatabase, "select" | "insert">;

/**
 * Every rubric version in `lib/rubric/`, idempotent on `(version_label, language)`. Real data, but
 * **seeded anywhere real only after the user's review and native read** (04 `rubric_versions`,
 * 11 §5): `db:seed:develop` calls it, production's `db:seed` does not yet (12 §3 step 9).
 */
export async function seedRubrics(db: Db): Promise<number> {
  const inserted = await db
    .insert(rubricVersions)
    .values(
      RUBRICS.map((rubric) => ({
        versionLabel: rubric.versionLabel,
        language: rubric.language,
        dimensions: rubric.dimensions,
      })),
    )
    .onConflictDoNothing({ target: [rubricVersions.versionLabel, rubricVersions.language] })
    .returning({ id: rubricVersions.id });
  return inserted.length;
}

/**
 * Inserts the bodies of `pieces` this user does not already hold under the same stamp, so running it
 * twice adds nothing and a stored row is never rewritten (04 §5).
 */
async function seedBank(
  db: Db,
  userId: string,
  language: "ja" | "en",
  origin: "set_piece" | "generated",
  generatorPromptVersion: string,
  pieces: readonly { roundType: (typeof questions.$inferInsert)["roundType"]; body: string }[],
) {
  const existing = await db
    .select({ body: questions.body })
    .from(questions)
    .where(
      and(
        eq(questions.userId, userId),
        eq(questions.language, language),
        eq(questions.generatorPromptVersion, generatorPromptVersion),
        inArray(
          questions.body,
          pieces.map((piece) => piece.body),
        ),
      ),
    );
  const held = new Set(existing.map((row) => row.body));
  const missing = pieces.filter((piece) => !held.has(piece.body));
  if (missing.length === 0) return 0;
  await db.insert(questions).values(
    missing.map((piece) => ({
      userId,
      language,
      roundType: piece.roundType,
      origin,
      body: piece.body,
      // No model wrote these: a null generator says so, and stamp 3 is the content version.
      generatorModelId: null,
      generatorPromptVersion,
    })),
  );
  return missing.length;
}

/** The set pieces for one user, each carrying its content version as stamp 3. */
export async function seedSetPieces(db: Db, userId: string, content: readonly SetPieceContent[] = SET_PIECES) {
  let inserted = 0;
  for (const set of content) {
    inserted += await seedBank(db, userId, set.language, "set_piece", set.contentVersion, set.pieces);
  }
  return inserted;
}

/**
 * Synthetic generated-origin bank questions (12 §1), for `develop` and local only — **never seeded on
 * `main`**. Fixtures with no model call, so a round of 3 can be filled before generation exists
 * (#47). Their stamp 3 names them as fixtures, so no chart can mistake them for the generator's.
 */
export const SYNTHETIC_QUESTIONS_VERSION = "synthetic-generated-en-1.0";

export const SYNTHETIC_QUESTIONS_EN: readonly { roundType: "behavioural" | "technical" | "hr" | "ceo"; body: string }[] = [
  { roundType: "hr", body: "Tell me about a time you disagreed with your manager. What did you do?" },
  { roundType: "hr", body: "What kind of team do you do your best work in, and why?" },
  { roundType: "hr", body: "Describe a piece of feedback that changed how you work." },
  { roundType: "hr", body: "How do you decide what to work on when everything is urgent?" },
  { roundType: "hr", body: "Tell me about a mistake you made at work and what you changed afterwards." },
  { roundType: "hr", body: "What would your last team say you should do less of?" },
  { roundType: "hr", body: "How do you keep your skills current outside of project work?" },
  { roundType: "hr", body: "Where do you want your career to be in three years, and how does this role fit?" },
  { roundType: "behavioural", body: "Tell me about the most difficult problem you solved in the last year." },
  { roundType: "behavioural", body: "Describe a time you had to deliver with less time than you needed." },
  { roundType: "behavioural", body: "Tell me about a time you persuaded someone who did not report to you." },
  { roundType: "technical", body: "Walk me through how you would find the cause of a sudden slowdown in production." },
  { roundType: "technical", body: "How would you migrate a live service to a new database without downtime?" },
  { roundType: "technical", body: "Describe a design decision you made that you would now make differently." },
  { roundType: "ceo", body: "What would you want to have achieved here after your first year?" },
  { roundType: "ceo", body: "What do you think this industry gets wrong today?" },
  { roundType: "ceo", body: "Why should we choose you over someone with more experience?" },
];

export async function seedSyntheticQuestions(db: Db, userId: string) {
  return seedBank(db, userId, "en", "generated", SYNTHETIC_QUESTIONS_VERSION, SYNTHETIC_QUESTIONS_EN);
}
