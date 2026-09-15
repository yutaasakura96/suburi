import { sql, type SQL } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  vector,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

// docs/04-database-schema.md in code. They change together; the doc changes first.

export const LANGUAGES = ["ja", "en"] as const;
export const ROUND_TYPES = ["behavioural", "technical", "hr", "ceo"] as const;
export const MODES = ["practice", "realistic"] as const;
export const QUESTION_ORIGINS = ["set_piece", "generated"] as const;
export const ROLE_CONTEXT_KINDS = ["posting", "researched", "general"] as const;
export const SCORING_STATUSES = ["pending", "ok", "failed"] as const;
export const CITATION_RELATIONS = ["supported_by", "contradicted_by"] as const;

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

// 04 §0: every enumerated text column is checked, named <table>_<column>_check.
function oneOf(table: string, column: string, target: AnyPgColumn, values: readonly string[]) {
  const list = sql.raw(values.map((value) => `'${value}'`).join(", "));
  return check(`${table}_${column}_check`, sql`${target} in (${list})` as SQL);
}

// ── Better Auth's tables: 1.7.4 core fields, plural and snake_cased (04 §0, §2) ──

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (t) => [index("sessions_user_id_idx").on(t.userId)],
);

export const accounts = pgTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("accounts_user_id_idx").on(t.userId)],
);

export const verifications = pgTable(
  "verifications",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("verifications_identifier_idx").on(t.identifier)],
);

// ── Application tables ──

export const cvVersions = pgTable(
  "cv_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    versionLabel: text("version_label").notNull(),
    language: text("language", { enum: LANGUAGES }).notNull(),
    // Immutable. Every cv_claims span indexes into this exact string.
    body: text("body").notNull(),
    sourceFilename: text("source_filename"),
    extractorModelId: text("extractor_model_id"),
    extractorPromptVersion: text("extractor_prompt_version"),
    createdAt: createdAt(),
  },
  (t) => [oneOf("cv_versions", "language", t.language, LANGUAGES)],
);

export const cvClaims = pgTable(
  "cv_claims",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cvVersionId: uuid("cv_version_id")
      .notNull()
      .references(() => cvVersions.id, { onDelete: "restrict" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    textNormalised: text("text_normalised").notNull(),
    spanStart: integer("span_start").notNull(),
    spanEnd: integer("span_end").notNull(),
    supersedesClaimId: uuid("supersedes_claim_id").references((): AnyPgColumn => cvClaims.id, {
      onDelete: "restrict",
    }),
    createdAt: createdAt(),
  },
  (t) => [
    check("cv_claims_span_order_check", sql`${t.spanEnd} > ${t.spanStart}`),
    index("cv_claims_cv_version_id_idx").on(t.cvVersionId),
    index("cv_claims_text_normalised_cv_version_id_idx").on(t.textNormalised, t.cvVersionId),
  ],
);

export const roleContexts = pgTable(
  "role_contexts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ROLE_CONTEXT_KINDS }).notNull(),
    companyName: text("company_name"),
    roleTitle: text("role_title"),
    body: text("body"),
    createdAt: createdAt(),
  },
  (t) => [oneOf("role_contexts", "kind", t.kind, ROLE_CONTEXT_KINDS)],
);

export const rubricVersions = pgTable(
  "rubric_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    versionLabel: text("version_label").notNull(),
    language: text("language", { enum: LANGUAGES }).notNull(),
    dimensions: jsonb("dimensions").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("rubric_versions_version_label_language_unique").on(t.versionLabel, t.language),
    oneOf("rubric_versions", "language", t.language, LANGUAGES),
  ],
);

export const questions = pgTable(
  "questions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    language: text("language", { enum: LANGUAGES }).notNull(),
    roundType: text("round_type", { enum: ROUND_TYPES }).notNull(),
    origin: text("origin", { enum: QUESTION_ORIGINS }).notNull(),
    body: text("body").notNull(),
    embedding: vector("embedding", { dimensions: 1536 }),
    generatorModelId: text("generator_model_id"),
    generatorPromptVersion: text("generator_prompt_version"),
    tokensIn: integer("tokens_in"),
    tokensOut: integer("tokens_out"),
    retiredAt: timestamp("retired_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    oneOf("questions", "language", t.language, LANGUAGES),
    oneOf("questions", "round_type", t.roundType, ROUND_TYPES),
    oneOf("questions", "origin", t.origin, QUESTION_ORIGINS),
    index("questions_active_slice_idx")
      .on(t.userId, t.language, t.roundType)
      .where(sql`${t.retiredAt} is null`),
    index("questions_embedding_hnsw_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
  ],
);

export const rounds = pgTable(
  "rounds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roundType: text("round_type", { enum: ROUND_TYPES }).notNull(),
    language: text("language", { enum: LANGUAGES }).notNull(),
    mode: text("mode", { enum: MODES }).notNull(),
    length: integer("length").notNull(),
    perAnswerCapSeconds: integer("per_answer_cap_seconds").notNull(),
    cvVersionId: uuid("cv_version_id")
      .notNull()
      .references(() => cvVersions.id, { onDelete: "restrict" }),
    roleContextId: uuid("role_context_id")
      .notNull()
      .references(() => roleContexts.id, { onDelete: "restrict" }),
    rubricVersionId: uuid("rubric_version_id")
      .notNull()
      .references(() => rubricVersions.id, { onDelete: "restrict" }),
    // Instrumentation, not feedback. Captured before any feedback; realistic only.
    feltPressure: smallint("felt_pressure"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    check("rounds_felt_pressure_range_check", sql`${t.feltPressure} between 1 and 5`),
    check(
      "rounds_practice_no_pressure_check",
      sql`${t.mode} <> 'practice' or ${t.feltPressure} is null`,
    ),
    oneOf("rounds", "round_type", t.roundType, ROUND_TYPES),
    oneOf("rounds", "language", t.language, LANGUAGES),
    oneOf("rounds", "mode", t.mode, MODES),
    index("rounds_user_id_started_at_idx").on(t.userId, t.startedAt.desc()),
    index("rounds_user_id_language_round_type_started_at_idx").on(
      t.userId,
      t.language,
      t.roundType,
      t.startedAt.desc(),
    ),
  ],
);

export const answers = pgTable(
  "answers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roundId: uuid("round_id")
      .notNull()
      .references(() => rounds.id, { onDelete: "restrict" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Null means follow-up.
    questionId: uuid("question_id").references(() => questions.id, { onDelete: "restrict" }),
    parentAnswerId: uuid("parent_answer_id").references((): AnyPgColumn => answers.id, {
      onDelete: "restrict",
    }),
    promptText: text("prompt_text").notNull(),
    position: integer("position").notNull(),
    // Denormalised from rounds for the first-attempt index; rounds.language is authoritative.
    language: text("language", { enum: LANGUAGES }).notNull(),
    isFirstAttempt: boolean("is_first_attempt").notNull().default(false),
    audioS3Key: text("audio_s3_key"),
    audioDurationMs: integer("audio_duration_ms"),
    // Never discarded in favour of the correction.
    transcriptRaw: text("transcript_raw"),
    transcriptCorrected: text("transcript_corrected"),
    rewriteMagnitude: real("rewrite_magnitude"),
    wordsPerMinute: real("words_per_minute"),
    transcriberModelId: text("transcriber_model_id"),
    retryOfAnswerId: uuid("retry_of_answer_id").references((): AnyPgColumn => answers.id, {
      onDelete: "restrict",
    }),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      "answers_question_xor_follow_up_check",
      sql`(${t.questionId} is null) <> (${t.parentAnswerId} is null)`,
    ),
    check(
      "answers_follow_up_not_first_attempt_check",
      sql`${t.questionId} is not null or ${t.isFirstAttempt} = false`,
    ),
    oneOf("answers", "language", t.language, LANGUAGES),
    uniqueIndex("answers_first_attempt_uniq")
      .on(t.questionId, t.language)
      .where(sql`${t.isFirstAttempt}`),
    index("answers_round_id_position_idx").on(t.roundId, t.position),
    index("answers_user_id_created_at_idx").on(t.userId, t.createdAt.desc()),
  ],
);

// Append-only. A re-score is a new row, never an update.
export const scoringAttempts = pgTable(
  "scoring_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    answerId: uuid("answer_id")
      .notNull()
      .references(() => answers.id, { onDelete: "restrict" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: text("status", { enum: SCORING_STATUSES }).notNull().default("pending"),
    // The four stamps, all not null.
    cvVersionId: uuid("cv_version_id")
      .notNull()
      .references(() => cvVersions.id, { onDelete: "restrict" }),
    rubricVersionId: uuid("rubric_version_id")
      .notNull()
      .references(() => rubricVersions.id, { onDelete: "restrict" }),
    generatorPromptVersion: text("generator_prompt_version"),
    // Exact pinned string, never an alias.
    modelId: text("model_id").notNull(),
    scoringPromptVersion: text("scoring_prompt_version").notNull(),
    tokensIn: integer("tokens_in"),
    tokensOut: integer("tokens_out"),
    // Class only, never the model's output.
    errorClass: text("error_class"),
    isSuperseding: boolean("is_superseding").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    oneOf("scoring_attempts", "status", t.status, SCORING_STATUSES),
    index("scoring_attempts_answer_id_created_at_idx").on(t.answerId, t.createdAt.desc()),
    index("scoring_attempts_user_id_model_id_rubric_version_id_idx").on(
      t.userId,
      t.modelId,
      t.rubricVersionId,
    ),
  ],
);

// No total, average or overall column, and no view that computes one (04 §6).
export const scores = pgTable(
  "scores",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scoringAttemptId: uuid("scoring_attempt_id")
      .notNull()
      .references(() => scoringAttempts.id, { onDelete: "restrict" }),
    dimension: text("dimension").notNull(),
    value: smallint("value").notNull(),
    justification: text("justification"),
  },
  (t) => [
    check("scores_value_range_check", sql`${t.value} between 1 and 5`),
    unique("scores_scoring_attempt_id_dimension_unique").on(t.scoringAttemptId, t.dimension),
    index("scores_scoring_attempt_id_idx").on(t.scoringAttemptId),
  ],
);

export const roundFeedback = pgTable(
  "round_feedback",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roundId: uuid("round_id")
      .notNull()
      .unique()
      .references(() => rounds.id, { onDelete: "restrict" }),
    toFix: jsonb("to_fix").notNull(),
    whatWorked: text("what_worked").notNull(),
    language: text("language", { enum: LANGUAGES }).notNull(),
    bodyTranslated: jsonb("body_translated"),
    modelId: text("model_id").notNull(),
    promptVersion: text("prompt_version").notNull(),
    tokensIn: integer("tokens_in"),
    tokensOut: integer("tokens_out"),
    createdAt: createdAt(),
  },
  (t) => [oneOf("round_feedback", "language", t.language, LANGUAGES)],
);

export const claimCitations = pgTable(
  "claim_citations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    answerId: uuid("answer_id")
      .notNull()
      .references(() => answers.id, { onDelete: "restrict" }),
    cvClaimId: uuid("cv_claim_id")
      .notNull()
      .references(() => cvClaims.id, { onDelete: "restrict" }),
    relation: text("relation", { enum: CITATION_RELATIONS }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    oneOf("claim_citations", "relation", t.relation, CITATION_RELATIONS),
    unique("claim_citations_answer_id_cv_claim_id_relation_unique").on(
      t.answerId,
      t.cvClaimId,
      t.relation,
    ),
    index("claim_citations_cv_claim_id_idx").on(t.cvClaimId),
  ],
);

export const heldOutRescores = pgTable("held_out_rescores", {
  id: uuid("id").primaryKey().defaultRandom(),
  answerId: uuid("answer_id")
    .notNull()
    .references(() => answers.id, { onDelete: "restrict" }),
  baselineAttemptId: uuid("baseline_attempt_id")
    .notNull()
    .references(() => scoringAttempts.id, { onDelete: "restrict" }),
  rescoreAttemptId: uuid("rescore_attempt_id")
    .notNull()
    .references(() => scoringAttempts.id, { onDelete: "restrict" }),
  createdAt: createdAt(),
});
