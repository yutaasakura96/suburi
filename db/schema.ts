import { sql, type SQL } from "drizzle-orm";
import {
  boolean,
  check,
  doublePrecision,
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
export const ANSWER_FLAG_KINDS = ["unsupported"] as const;
export const CV_DOCUMENT_KINDS = ["rirekisho", "shokumu_keirekisho", "cv", "additional"] as const;
// Every ⚡ route (07 §1 rule 5). A new one extends this list in its own migration.
export const RATE_LIMITED_ROUTES = ["cv-versions", "rounds", "transcribe", "submit", "complete", "feedback"] as const;
// 12 §6's monitoring jobs and what they read (04 cron_readings). #47 adds the near-miss row; #56
// added the daily dump's.
export const CRON_JOBS = ["self-check", "digest"] as const;
export const SELF_CHECK_SIGNALS = [
  "scoring_pending_over_24h",
  "scoring_failed_unsuperseded",
  "spend_week_to_date_usd",
  "cv_spans_rejected",
  "cv_claims_split",
  "cv_claims_duplicated",
  "cv_unclaimed_run_max",
  "cv_quotes_outside_window",
  "round_feedback_missing_over_24h",
  "backup_dump_failed",
] as const;
export const DIGEST_FIGURES = [
  "digest_rounds_started",
  "digest_rounds_completed",
  "digest_tokens_in",
  "digest_tokens_out",
  "digest_spend_usd",
] as const;
export const CRON_SIGNALS = [...SELF_CHECK_SIGNALS, ...DIGEST_FIGURES] as const;

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
    // Retired (04): always null, not dropped — migrations are expand-only. See cv_documents.
    sourceFilename: text("source_filename"),
    extractorModelId: text("extractor_model_id"),
    extractorPromptVersion: text("extractor_prompt_version"),
    // The save's reading counters (07 §5.2), written in the version's insert and never updated, so
    // 12 §6's self-check can read them. Null before the columns existed and on develop's seed.
    spansRejected: integer("spans_rejected"),
    claimsSplit: integer("claims_split"),
    claimsDuplicated: integer("claims_duplicated"),
    unclaimedRunMax: integer("unclaimed_run_max"),
    quotesOutsideWindow: integer("quotes_outside_window"),
    createdAt: createdAt(),
  },
  (t) => [
    oneOf("cv_versions", "language", t.language, LANGUAGES),
    // Per-language v{n} numbering is race-safe: two saves that both compute v4 cannot both land.
    uniqueIndex("cv_versions_user_id_language_version_label_uniq").on(
      t.userId,
      t.language,
      t.versionLabel,
    ),
    // The current CV version in a language, and the version history below it.
    index("cv_versions_user_id_language_created_at_idx").on(
      t.userId,
      t.language,
      t.createdAt.desc(),
    ),
  ],
);

// Immutable, like its version: written in the same transaction, never updated, never deleted.
export const cvDocuments = pgTable(
  "cv_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cvVersionId: uuid("cv_version_id")
      .notNull()
      .references(() => cvVersions.id, { onDelete: "restrict" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    kind: text("kind", { enum: CV_DOCUMENT_KINDS }).notNull(),
    // Required for additional, null for every other kind. The user types it.
    title: text("title"),
    sourceFilename: text("source_filename"),
    position: integer("position").notNull(),
    // [start, end) into cv_versions.body, in characters (code points).
    start: integer("start").notNull(),
    end: integer("end").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    oneOf("cv_documents", "kind", t.kind, CV_DOCUMENT_KINDS),
    check("cv_documents_range_order_check", sql`${t.end} > ${t.start}`),
    check(
      "cv_documents_title_check",
      sql`(${t.kind} = 'additional') = (${t.title} is not null)`,
    ),
    unique("cv_documents_cv_version_id_position_unique").on(t.cvVersionId, t.position),
  ],
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
  (t) => [
    oneOf("role_contexts", "kind", t.kind, ROLE_CONTEXT_KINDS),
    // General practice is one row per user (04), so its rounds are never grouped as two.
    uniqueIndex("role_contexts_general_uniq")
      .on(t.userId)
      .where(sql`${t.kind} = 'general'`),
  ],
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
    // Stamp 3's source: the generator prompt version, or a set piece's content version (06, 2026-09-27).
    generatorPromptVersion: text("generator_prompt_version").notNull(),
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

// Immutable: every bank question a round will ask, fixed in the transaction that creates the round
// (04). A refresh, a resume or a retry can only ever see the question already chosen.
export const roundQuestions = pgTable(
  "round_questions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roundId: uuid("round_id")
      .notNull()
      .references(() => rounds.id, { onDelete: "restrict" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    position: integer("position").notNull(),
    questionId: uuid("question_id")
      .notNull()
      .references(() => questions.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
  },
  (t) => [
    check("round_questions_position_check", sql`${t.position} >= 1`),
    unique("round_questions_round_id_position_unique").on(t.roundId, t.position),
    unique("round_questions_round_id_question_id_unique").on(t.roundId, t.questionId),
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
    // "Has this question been answered in this language, in either mode?" — first attempts and
    // unseen-first selection (04 §3).
    index("answers_question_id_language_idx").on(t.questionId, t.language),
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
    generatorPromptVersion: text("generator_prompt_version").notNull(),
    // Exact pinned string, never an alias.
    modelId: text("model_id").notNull(),
    scoringPromptVersion: text("scoring_prompt_version").notNull(),
    // As the scorer read the answer. Null until `ok`, and on attempts scored before score-*-1.1.
    answeredLanguage: text("answered_language", { enum: LANGUAGES }),
    tokensIn: integer("tokens_in"),
    tokensOut: integer("tokens_out"),
    // Class only, never the model's output.
    errorClass: text("error_class"),
    isSuperseding: boolean("is_superseding").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    oneOf("scoring_attempts", "status", t.status, SCORING_STATUSES),
    oneOf("scoring_attempts", "answered_language", t.answeredLanguage, LANGUAGES),
    check(
      "scoring_attempts_answered_language_ok_check",
      sql`${t.answeredLanguage} is null or ${t.status} = 'ok'`,
    ),
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
    // Untouched material: at most three cv_claims ids, validated against the round's never-cited set.
    untouchedClaimIds: jsonb("untouched_claim_ids").$type<string[]>().notNull().default([]),
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

// Append-only: a span of one answer's corrected text that one scoring attempt flagged (04). A span,
// never text — the quote is sliced from transcript_corrected, as a claim's is from cv_versions.body.
export const answerFlags = pgTable(
  "answer_flags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    answerId: uuid("answer_id")
      .notNull()
      .references(() => answers.id, { onDelete: "restrict" }),
    scoringAttemptId: uuid("scoring_attempt_id")
      .notNull()
      .references(() => scoringAttempts.id, { onDelete: "restrict" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    kind: text("kind", { enum: ANSWER_FLAG_KINDS }).notNull(),
    // [start, end) into answers.transcript_corrected, in characters (code points).
    spanStart: integer("span_start").notNull(),
    spanEnd: integer("span_end").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    oneOf("answer_flags", "kind", t.kind, ANSWER_FLAG_KINDS),
    check("answer_flags_span_order_check", sql`${t.spanEnd} > ${t.spanStart}`),
    index("answer_flags_answer_id_idx").on(t.answerId),
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

// 07 §1 rule 5: one fixed window per (session, route), advanced by one upsert (lib/api/rate-limit.ts).
// session_id is deliberately not a foreign key: Better Auth deletes expired sessions (04 §2).
export const rateLimitWindows = pgTable(
  "rate_limit_windows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    sessionId: text("session_id").notNull(),
    route: text("route", { enum: RATE_LIMITED_ROUTES }).notNull(),
    windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull(),
    count: integer("count").notNull(),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    oneOf("rate_limit_windows", "route", t.route, RATE_LIMITED_ROUTES),
    unique("rate_limit_windows_session_id_route_unique").on(t.sessionId, t.route),
  ],
);

// 12 §6: one row per monitoring-job invocation, appended with its readings, never updated (04).
// No user_id: a run is the job's own record; what it found about a user is in cron_readings.
export const cronRuns = pgTable(
  "cron_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    job: text("job", { enum: CRON_JOBS }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    oneOf("cron_runs", "job", t.job, CRON_JOBS),
    index("cron_runs_job_created_at_idx").on(t.job, t.createdAt.desc()),
  ],
);

// Numbers, thresholds and ids only — no column here can hold record text (12 §7).
export const cronReadings = pgTable(
  "cron_readings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => cronRuns.id, { onDelete: "restrict" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    signal: text("signal", { enum: CRON_SIGNALS }).notNull(),
    // Null is no reading, never zero.
    value: doublePrecision("value"),
    // Null exactly when the row is a digest figure: reported, not judged.
    threshold: doublePrecision("threshold"),
    isRed: boolean("is_red"),
    subjectIds: uuid("subject_ids")
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    unpricedModelIds: text("unpriced_model_ids").array().$type<(string | null)[]>().notNull().default(sql`'{}'::text[]`),
    windowStart: timestamp("window_start", { withTimezone: true }),
    windowEnd: timestamp("window_end", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    oneOf("cron_readings", "signal", t.signal, CRON_SIGNALS),
    check("cron_readings_judged_check", sql`(${t.threshold} is null) = (${t.isRed} is null)`),
    check("cron_readings_red_needs_value_check", sql`${t.value} is not null or ${t.isRed} is not true`),
    check("cron_readings_unpriced_models_spend_check", sql`cardinality(${t.unpricedModelIds}) = 0 or ${t.signal} in ('spend_week_to_date_usd', 'digest_spend_usd')`),
    unique("cron_readings_run_id_user_id_signal_unique").on(t.runId, t.userId, t.signal),
  ],
);
