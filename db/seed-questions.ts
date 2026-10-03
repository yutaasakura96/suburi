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
  // One statement shares one now(), and selection breaks a created_at tie on the random id. A
  // millisecond apart, in the listed order, makes the order the content lists them in the order they
  // are asked: the self-introduction before the reason for leaving.
  const base = Date.now();
  await db.insert(questions).values(
    missing.map((piece) => ({
      createdAt: new Date(base + pieces.indexOf(piece)),
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
export const SYNTHETIC_QUESTIONS_VERSION = { en: "synthetic-generated-en-1.0", ja: "synthetic-generated-ja-1.0" } as const;

type SyntheticQuestion = { roundType: "behavioural" | "technical" | "hr" | "ceo"; body: string };

export const SYNTHETIC_QUESTIONS_EN: readonly SyntheticQuestion[] = [
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

/** The same seventeen, as a Japanese interviewer asks them — so a Japanese round fills on `develop` too. */
export const SYNTHETIC_QUESTIONS_JA: readonly SyntheticQuestion[] = [
  { roundType: "hr", body: "上司と意見が合わなかったときのことを教えてください。そのとき、どう対応しましたか。" },
  { roundType: "hr", body: "どのようなチームで最も力を発揮できますか。その理由も教えてください。" },
  { roundType: "hr", body: "仕事の進め方が変わるきっかけになったフィードバックについて教えてください。" },
  { roundType: "hr", body: "すべての仕事が急ぎに見えるとき、何から取り組むかをどう決めていますか。" },
  { roundType: "hr", body: "仕事での失敗と、そのあとに変えたことを教えてください。" },
  { roundType: "hr", body: "前のチームの人たちは、あなたが控えたほうがよいことは何だと言うと思いますか。" },
  { roundType: "hr", body: "担当業務のほかに、スキルを保つためにしていることはありますか。" },
  { roundType: "hr", body: "3年後にどのようなキャリアを築いていたいですか。この職務はそこにどうつながりますか。" },
  { roundType: "behavioural", body: "この1年で解決した、最も難しかった問題について教えてください。" },
  { roundType: "behavioural", body: "必要な時間が足りない中で成果を出さなければならなかった経験を教えてください。" },
  { roundType: "behavioural", body: "自分の部下ではない人を説得した経験を教えてください。" },
  { roundType: "technical", body: "本番環境で突然処理が遅くなったとき、原因をどのように突き止めますか。" },
  { roundType: "technical", body: "稼働中のサービスを、停止させずに新しいデータベースへ移行するにはどうしますか。" },
  { roundType: "technical", body: "過去の設計判断のうち、今なら違う判断をするものについて教えてください。" },
  { roundType: "ceo", body: "入社して1年後に、何を成し遂げていたいですか。" },
  { roundType: "ceo", body: "この業界がいま見誤っていることは何だと思いますか。" },
  { roundType: "ceo", body: "あなたより経験の豊富な候補者ではなく、あなたを選ぶべき理由は何ですか。" },
];

export async function seedSyntheticQuestions(db: Db, userId: string) {
  const en = await seedBank(db, userId, "en", "generated", SYNTHETIC_QUESTIONS_VERSION.en, SYNTHETIC_QUESTIONS_EN);
  const ja = await seedBank(db, userId, "ja", "generated", SYNTHETIC_QUESTIONS_VERSION.ja, SYNTHETIC_QUESTIONS_JA);
  return en + ja;
}
