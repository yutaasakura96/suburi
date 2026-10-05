import { createHash } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { currentCvVersion } from "../lib/cv/current-version.ts";
import { pace, rewriteMagnitude } from "../lib/round/measures.ts";
import * as s from "./schema.ts";
import { SYNTHETIC_QUESTIONS_VERSION } from "./seed-questions.ts";

// The synthetic rounds for Neon `develop` and local (docs/12-deployment.md §1): one round in each
// state History has to show — complete and scored, complete with a score still pending, complete with
// a failed score, and abandoned. Fixtures, never a model call, so the rows are the same every run.
// **Never seeded on `main`**: `db:seed` does not call this.

type Language = "ja" | "en";
type Db = Pick<NodePgDatabase, "select" | "insert" | "execute">;

/** No model produced these rows, and their stamps say so: no chart can take them for a model's. */
export const SYNTHETIC_MODEL_ID = "synthetic-fixture";
export const SYNTHETIC_PROMPT_VERSIONS = {
  score: { en: "synthetic-score-en-1.0", ja: "synthetic-score-ja-1.0" },
  followUp: { en: "synthetic-follow-up-en-1.0", ja: "synthetic-follow-up-ja-1.0" },
  feedback: { en: "synthetic-feedback-en-1.0", ja: "synthetic-feedback-ja-1.0" },
} as const;

interface FixtureAnswer {
  /** As transcribed. Defaults to `corrected`: nothing was changed. */
  readonly raw?: string;
  readonly corrected: string;
  /** One value per rubric dimension, in the rubric's order; or how the latest attempt stands. */
  readonly scoring: readonly number[] | "pending" | "failed";
}

interface FixtureQuestion {
  /** A synthetic bank question's body (`db/seed-questions.ts`), in the round's language. */
  readonly body: string;
  /** Null where the round never reached the question. */
  readonly answer: FixtureAnswer | null;
  /** The answer's one follow-up: asked (and answered, or not), recorded as missing, or never reached. */
  readonly followUp: { readonly prompt: string; readonly answer: FixtureAnswer | null } | "missing" | null;
}

interface FixtureFeedback {
  readonly toFix: readonly { readonly title: string; readonly body: string }[];
  readonly whatWorked: string;
  readonly translated: { readonly to_fix: readonly { readonly title: string; readonly body: string }[]; readonly what_worked: string } | null;
}

interface FixtureRound {
  /** Names the round in its ids: changing it makes a new round, never a rewrite of a seeded one. */
  readonly name: string;
  readonly roundType: "behavioural" | "technical" | "ceo";
  readonly language: Language;
  /** Fixed, and in the past: an open round here is abandoned on any day the seed runs. */
  readonly startedAt: string;
  readonly feltPressure: number | null;
  readonly questions: readonly FixtureQuestion[];
  /** Null for a round that never completed. */
  readonly feedback: FixtureFeedback | null;
}

// The Japanese round answers with the synthetic CV's own sentences (`db/seed-cv.ts`), and its scores
// are 10 §10's sample rows: Q1 is `4 3 4 3 4 2 3`.
const COMPLETE_JA: FixtureRound = {
  name: "complete-ja",
  roundType: "behavioural",
  language: "ja",
  startedAt: "2026-09-12T10:30:00.000Z",
  feltPressure: 4,
  questions: [
    {
      body: "この1年で解決した、最も難しかった問題について教えてください。",
      answer: {
        raw: "えー、4名のチームで在庫連携バッチを再設計し、夜間処理を6時間から2時間に短縮しました。",
        corrected: "4名のチームで在庫連携バッチを再設計し、夜間処理を6時間から2時間に短縮しました。",
        scoring: [4, 3, 4, 3, 4, 2, 3],
      },
      followUp: {
        prompt: "その判断は誰が下したのですか。",
        answer: { corrected: "差分連携に切り替え、処理を店舗単位で並列化しました。", scoring: [3, 2, 4, 3, 4, 4, 3] },
      },
    },
    {
      body: "必要な時間が足りない中で成果を出さなければならなかった経験を教えてください。",
      answer: {
        corrected: "受注APIをモノリスから切り出し、ピーク時の応答時間を1.2秒から0.3秒に短縮しました。",
        scoring: [4, 4, 5, 4, 4, 4, 4],
      },
      followUp: "missing",
    },
    {
      body: "自分の部下ではない人を説得した経験を教えてください。",
      answer: {
        corrected: "倉庫管理システムの保守を担当し、問い合わせ対応手順を整備して一次回答までの時間を半減させました。",
        scoring: [3, 2, 3, 4, 4, 3, 3],
      },
      followUp: {
        prompt: "その判断は誰が下したのですか。",
        answer: { corrected: "結果として、2023年度は遅延がゼロになりました。", scoring: [3, 3, 3, 3, 4, 3, 3] },
      },
    },
  ],
  feedback: {
    toFix: [
      { title: "結論を最初の一文に置く", body: "第1問で、結論が最後に出てくる。" },
      { title: "数値を一つ挙げる", body: "第2問で、成果が抽象的なままである。" },
    ],
    whatWorked: "第3問で、具体的な場面を挙げて説明できている。",
    translated: {
      to_fix: [
        { title: "Put the conclusion in the first sentence", body: "In answer 1, the conclusion arrives last." },
        { title: "Name one number", body: "In answer 2, the outcome stays general." },
      ],
      what_worked: "In answer 3, you explained with a concrete situation.",
    },
  },
};

const PENDING_EN: FixtureRound = {
  name: "pending-en",
  roundType: "technical",
  language: "en",
  startedAt: "2026-09-06T11:00:00.000Z",
  feltPressure: 3,
  questions: [
    {
      body: "Walk me through how you would find the cause of a sudden slowdown in production.",
      answer: {
        raw: "Um, I would start with what changed. So I check the deploy log and the the p95 latency dashboards, then narrow it down by endpoint.",
        corrected: "I would start with what changed. I check the deploy log and the p95 latency dashboards, then narrow it down by endpoint.",
        scoring: [4, 3, 4, 4, 4, 3],
      },
      followUp: {
        prompt: "Which signal would you look at first, and why?",
        answer: {
          corrected: "The p95 latency per endpoint, because it shows where the time goes before I guess at a cause.",
          scoring: [3, 3, 4, 4, 4, 4],
        },
      },
    },
    {
      body: "How would you migrate a live service to a new database without downtime?",
      answer: {
        corrected:
          "I led a team of four through a zero-downtime migration from MySQL to PostgreSQL. We ran dual writes for six weeks before switching reads.",
        scoring: [4, 4, 5, 4, 4, 4],
      },
      followUp: {
        prompt: "What would have made you roll back?",
        answer: {
          corrected: "A mismatch between the two databases during dual writes. The cutover took eleven minutes and needed no rollback.",
          scoring: [3, 4, 4, 3, 4, 3],
        },
      },
    },
    {
      body: "Describe a design decision you made that you would now make differently.",
      answer: {
        corrected: "I kept fraud checks on the request path for too long. Moving them off cut checkout latency from 900 ms to 250 ms.",
        // The function that would have scored it died: the attempt was never finished (07 §5.10).
        scoring: "pending",
      },
      followUp: {
        prompt: "What stopped you from moving them earlier?",
        answer: {
          corrected: "We had no way to hold an order while a check ran, so I built that first.",
          scoring: [3, 2, 4, 4, 4, 3],
        },
      },
    },
  ],
  feedback: {
    toFix: [
      { title: "Lead with the result", body: "In answer 1, the method comes before what it found." },
      { title: "Name the number earlier", body: "In answer 2, the six weeks arrive in the last sentence." },
    ],
    whatWorked: "In answer 2, the migration was told as one concrete case.",
    translated: null,
  },
};

const FAILED_EN: FixtureRound = {
  name: "failed-en",
  roundType: "ceo",
  language: "en",
  startedAt: "2026-08-22T09:15:00.000Z",
  feltPressure: 2,
  questions: [
    {
      body: "What would you want to have achieved here after your first year?",
      answer: {
        corrected: "I would want one system I own end to end to be measurably faster, the way I cut checkout latency at my current company.",
        scoring: [3, 3, 4, 4, 4, 3],
      },
      followUp: {
        prompt: "How would you choose that system?",
        answer: { corrected: "By asking where customers wait the longest today.", scoring: [3, 2, 3, 4, 4, 4] },
      },
    },
    {
      body: "What do you think this industry gets wrong today?",
      answer: {
        raw: "It treats refunds as a, as an afterthought. I built a refund service that processed 40,000 refunds a month, and most of the work was in the edge cases.",
        corrected:
          "It treats refunds as an afterthought. I built a refund service that processed 40,000 refunds a month, and most of the work was in the edge cases.",
        // Spent its retries: History's "Retry scoring" writes a new attempt beside this one (07 §5.11).
        scoring: "failed",
      },
      followUp: {
        prompt: "What would you change first?",
        answer: { corrected: "I would make the refund path a first-class part of the design review.", scoring: [4, 3, 4, 4, 4, 3] },
      },
    },
    {
      body: "Why should we choose you over someone with more experience?",
      answer: {
        corrected: "Because I have done this migration once already, with a small team, and it needed no rollback.",
        scoring: [4, 4, 4, 3, 4, 4],
      },
      followUp: "missing",
    },
  ],
  feedback: {
    toFix: [
      { title: "Answer the question asked", body: "In answer 1, the first year is described through the last job." },
      { title: "Say why you, in one sentence", body: "In answer 3, the claim is made but not weighed against experience." },
    ],
    whatWorked: "In answer 3, the migration is named as something already done.",
    translated: null,
  },
};

const ABANDONED_EN: FixtureRound = {
  name: "abandoned-en",
  roundType: "behavioural",
  language: "en",
  startedAt: "2026-08-19T12:40:00.000Z",
  feltPressure: null,
  questions: [
    {
      body: "Tell me about the most difficult problem you solved in the last year.",
      answer: {
        corrected: "The hardest was the database migration. We ran dual writes for six weeks and cut over in eleven minutes.",
        scoring: [4, 3, 4, 4, 4, 2],
      },
      // Asked and never answered: the round was left here.
      followUp: { prompt: "What was the hardest part of those six weeks?", answer: null },
    },
    { body: "Describe a time you had to deliver with less time than you needed.", answer: null, followUp: null },
    { body: "Tell me about a time you persuaded someone who did not report to you.", answer: null, followUp: null },
  ],
  feedback: null,
};

/** Oldest first, so each is seeded with only its predecessors before it. */
export const SYNTHETIC_ROUNDS: readonly FixtureRound[] = [ABANDONED_EN, FAILED_EN, PENDING_EN, COMPLETE_JA];

const REALISTIC_CAP_SECONDS = 240;
// A speaking pace to give each take a length: characters a minute in Japanese, words in English.
const UNITS_PER_MINUTE = { ja: 300, en: 140 } as const;

/** The same id every run, for this user and this name: what makes the seed idempotent per round. */
export function syntheticId(userId: string, name: string) {
  const hex = createHash("sha256").update(`suburi-synthetic-round:${userId}:${name}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function durationMs(language: Language, text: string) {
  const units = language === "ja" ? [...text].length : text.split(/\s+/u).length;
  return Math.round((units / UNITS_PER_MINUTE[language]) * 600) * 100;
}

/**
 * Seeds the synthetic rounds this user does not already hold, and returns how many it wrote. Needs
 * what `db:seed:develop` seeds before it — the synthetic CV, the rubrics and the synthetic bank
 * questions — and fails, writing nothing, without them. Call it inside a transaction.
 *
 * **Realistic, and honest about first attempts**: an answer is a first attempt only where the
 * question has no earlier answer in that language (06, 2026-09-27), so seeding onto a `develop` that
 * already has rounds never claims a first attempt it is not.
 */
export async function seedSyntheticRounds(tx: Db, userId: string): Promise<number> {
  // One general-practice context per user (04 `role_contexts`): the one a round made here would use.
  await tx.execute(sql`
    insert into role_contexts (user_id, kind) values (${userId}, 'general')
    on conflict (user_id) where kind = 'general' do nothing`);
  const [context] = await tx
    .select({ id: s.roleContexts.id })
    .from(s.roleContexts)
    .where(and(eq(s.roleContexts.userId, userId), eq(s.roleContexts.kind, "general")));

  const held = await tx
    .select({ id: s.rounds.id })
    .from(s.rounds)
    .where(
      inArray(
        s.rounds.id,
        SYNTHETIC_ROUNDS.map((round) => syntheticId(userId, round.name)),
      ),
    );
  const missing = SYNTHETIC_ROUNDS.filter((round) => !held.some((row) => row.id === syntheticId(userId, round.name)));

  for (const round of missing) {
    const { language } = round;
    const id = (part: string) => syntheticId(userId, `${round.name}:${part}`);
    const at = (minutes: number) => new Date(Date.parse(round.startedAt) + minutes * 60_000);

    const cv = await currentCvVersion(tx, userId, language);
    const [rubric] = await tx
      .select()
      .from(s.rubricVersions)
      .where(eq(s.rubricVersions.language, language))
      .orderBy(desc(s.rubricVersions.createdAt))
      .limit(1);
    const bank = await tx
      .select({ id: s.questions.id, body: s.questions.body })
      .from(s.questions)
      .where(
        and(
          eq(s.questions.userId, userId),
          eq(s.questions.language, language),
          eq(s.questions.generatorPromptVersion, SYNTHETIC_QUESTIONS_VERSION[language]),
        ),
      );
    const questionIds = round.questions.map((question) => bank.find((row) => row.body === question.body)?.id);
    if (!cv || !rubric || questionIds.some((questionId) => questionId === undefined)) {
      throw new Error(`The synthetic CV, rubric and bank questions must be seeded before the synthetic rounds (${language}).`);
    }
    const dimensions = (rubric.dimensions as { key: string }[]).map((dimension) => dimension.key);

    const roundId = syntheticId(userId, round.name);
    await tx.insert(s.rounds).values({
      id: roundId,
      userId,
      roundType: round.roundType,
      language,
      mode: "realistic",
      length: round.questions.length,
      perAnswerCapSeconds: REALISTIC_CAP_SECONDS,
      cvVersionId: cv.version.id,
      roleContextId: context.id,
      rubricVersionId: rubric.id,
      feltPressure: round.feltPressure,
      startedAt: at(0),
      completedAt: round.feedback ? at(30) : null,
    });
    await tx.insert(s.roundQuestions).values(
      questionIds.map((questionId, index) => ({ roundId, userId, position: index + 1, questionId: questionId!, createdAt: at(0) })),
    );

    /** One answer, its attempt, and that attempt's scores, `minute` minutes into the round. */
    async function answer(
      key: string,
      minute: number,
      fixture: FixtureAnswer,
      asked: { position: number; prompt: string; generatorPromptVersion: string } & ({ questionId: string } | { parentAnswerId: string }),
    ) {
      const raw = fixture.raw ?? fixture.corrected;
      const duration = durationMs(language, raw);
      const questionId = "questionId" in asked ? asked.questionId : null;
      const answered =
        questionId === null
          ? []
          : await tx
              .select({ id: s.answers.id })
              .from(s.answers)
              .where(and(eq(s.answers.questionId, questionId), eq(s.answers.language, language)))
              .limit(1);
      await tx.insert(s.answers).values({
        id: id(key),
        roundId,
        userId,
        questionId,
        parentAnswerId: "parentAnswerId" in asked ? asked.parentAnswerId : null,
        promptText: asked.prompt,
        position: asked.position,
        language,
        isFirstAttempt: questionId !== null && answered.length === 0,
        // No recording was made: History says so rather than breaking (04 §5).
        audioS3Key: null,
        audioDurationMs: duration,
        transcriptRaw: raw,
        transcriptCorrected: fixture.corrected,
        rewriteMagnitude: rewriteMagnitude(raw, fixture.corrected),
        wordsPerMinute: pace(language, raw, duration),
        transcriberModelId: null,
        createdAt: at(minute),
      });

      const status = typeof fixture.scoring === "string" ? fixture.scoring : "ok";
      await tx.insert(s.scoringAttempts).values({
        id: id(`${key}:attempt`),
        answerId: id(key),
        userId,
        status,
        cvVersionId: cv!.version.id,
        rubricVersionId: rubric.id,
        generatorPromptVersion: asked.generatorPromptVersion,
        modelId: SYNTHETIC_MODEL_ID,
        scoringPromptVersion: SYNTHETIC_PROMPT_VERSIONS.score[language],
        answeredLanguage: status === "ok" ? language : null,
        errorClass: status === "failed" ? "upstream_timeout" : null,
        createdAt: at(minute + 1),
      });
      if (typeof fixture.scoring === "string") return;
      if (fixture.scoring.length !== dimensions.length) throw new Error(`${round.name}:${key} does not score every dimension.`);
      await tx.insert(s.scores).values(
        fixture.scoring.map((value, index) => ({ scoringAttemptId: id(`${key}:attempt`), dimension: dimensions[index], value })),
      );
    }

    for (const [index, question] of round.questions.entries()) {
      if (!question.answer) continue;
      const position = index + 1;
      const minute = index * 8 + 1;
      await answer(`q${position}`, minute, question.answer, {
        position,
        prompt: question.body,
        generatorPromptVersion: SYNTHETIC_QUESTIONS_VERSION[language],
        questionId: questionIds[index]!,
      });
      if (!question.followUp) continue;

      const generated = question.followUp === "missing" ? null : question.followUp;
      await tx.insert(s.followUps).values({
        id: id(`q${position}:follow-up`),
        parentAnswerId: id(`q${position}`),
        userId,
        status: generated ? "generated" : "missing",
        promptText: generated?.prompt ?? null,
        modelId: SYNTHETIC_MODEL_ID,
        promptVersion: SYNTHETIC_PROMPT_VERSIONS.followUp[language],
        errorClass: generated ? null : "upstream_timeout",
        createdAt: at(minute + 3),
      });
      if (!generated?.answer) continue;
      await answer(`q${position}:follow-up-answer`, minute + 4, generated.answer, {
        position,
        prompt: generated.prompt,
        generatorPromptVersion: SYNTHETIC_PROMPT_VERSIONS.followUp[language],
        parentAnswerId: id(`q${position}`),
      });
    }

    if (!round.feedback) continue;
    await tx.insert(s.roundFeedback).values({
      id: id("feedback"),
      roundId,
      toFix: round.feedback.toFix,
      whatWorked: round.feedback.whatWorked,
      language,
      bodyTranslated: round.feedback.translated ? { language: "en", ...round.feedback.translated } : null,
      untouchedClaimIds: [],
      modelId: SYNTHETIC_MODEL_ID,
      promptVersion: SYNTHETIC_PROMPT_VERSIONS.feedback[language],
      createdAt: at(30),
    });
  }
  return missing.length;
}
