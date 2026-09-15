CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"round_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"question_id" uuid,
	"parent_answer_id" uuid,
	"prompt_text" text NOT NULL,
	"position" integer NOT NULL,
	"language" text NOT NULL,
	"is_first_attempt" boolean DEFAULT false NOT NULL,
	"audio_s3_key" text,
	"audio_duration_ms" integer,
	"transcript_raw" text,
	"transcript_corrected" text,
	"rewrite_magnitude" real,
	"words_per_minute" real,
	"transcriber_model_id" text,
	"retry_of_answer_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "answers_question_xor_follow_up_check" CHECK (("answers"."question_id" is null) <> ("answers"."parent_answer_id" is null)),
	CONSTRAINT "answers_follow_up_not_first_attempt_check" CHECK ("answers"."question_id" is not null or "answers"."is_first_attempt" = false),
	CONSTRAINT "answers_language_check" CHECK ("answers"."language" in ('ja', 'en'))
);
--> statement-breakpoint
CREATE TABLE "claim_citations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"answer_id" uuid NOT NULL,
	"cv_claim_id" uuid NOT NULL,
	"relation" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "claim_citations_answer_id_cv_claim_id_relation_unique" UNIQUE("answer_id","cv_claim_id","relation"),
	CONSTRAINT "claim_citations_relation_check" CHECK ("claim_citations"."relation" in ('supported_by', 'contradicted_by'))
);
--> statement-breakpoint
CREATE TABLE "cv_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cv_version_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"text_normalised" text NOT NULL,
	"span_start" integer NOT NULL,
	"span_end" integer NOT NULL,
	"supersedes_claim_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cv_claims_span_order_check" CHECK ("cv_claims"."span_end" > "cv_claims"."span_start")
);
--> statement-breakpoint
CREATE TABLE "cv_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"version_label" text NOT NULL,
	"language" text NOT NULL,
	"body" text NOT NULL,
	"source_filename" text,
	"extractor_model_id" text,
	"extractor_prompt_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cv_versions_language_check" CHECK ("cv_versions"."language" in ('ja', 'en'))
);
--> statement-breakpoint
CREATE TABLE "held_out_rescores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"answer_id" uuid NOT NULL,
	"baseline_attempt_id" uuid NOT NULL,
	"rescore_attempt_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"language" text NOT NULL,
	"round_type" text NOT NULL,
	"origin" text NOT NULL,
	"body" text NOT NULL,
	"embedding" vector(1536),
	"generator_model_id" text,
	"generator_prompt_version" text,
	"tokens_in" integer,
	"tokens_out" integer,
	"retired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "questions_language_check" CHECK ("questions"."language" in ('ja', 'en')),
	CONSTRAINT "questions_round_type_check" CHECK ("questions"."round_type" in ('behavioural', 'technical', 'hr', 'ceo')),
	CONSTRAINT "questions_origin_check" CHECK ("questions"."origin" in ('set_piece', 'generated'))
);
--> statement-breakpoint
CREATE TABLE "role_contexts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"company_name" text,
	"role_title" text,
	"body" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_contexts_kind_check" CHECK ("role_contexts"."kind" in ('posting', 'researched', 'general'))
);
--> statement-breakpoint
CREATE TABLE "round_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"round_id" uuid NOT NULL,
	"to_fix" jsonb NOT NULL,
	"what_worked" text NOT NULL,
	"language" text NOT NULL,
	"body_translated" jsonb,
	"model_id" text NOT NULL,
	"prompt_version" text NOT NULL,
	"tokens_in" integer,
	"tokens_out" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "round_feedback_round_id_unique" UNIQUE("round_id"),
	CONSTRAINT "round_feedback_language_check" CHECK ("round_feedback"."language" in ('ja', 'en'))
);
--> statement-breakpoint
CREATE TABLE "rounds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"round_type" text NOT NULL,
	"language" text NOT NULL,
	"mode" text NOT NULL,
	"length" integer NOT NULL,
	"per_answer_cap_seconds" integer NOT NULL,
	"cv_version_id" uuid NOT NULL,
	"role_context_id" uuid NOT NULL,
	"rubric_version_id" uuid NOT NULL,
	"felt_pressure" smallint,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "rounds_felt_pressure_range_check" CHECK ("rounds"."felt_pressure" between 1 and 5),
	CONSTRAINT "rounds_practice_no_pressure_check" CHECK ("rounds"."mode" <> 'practice' or "rounds"."felt_pressure" is null),
	CONSTRAINT "rounds_round_type_check" CHECK ("rounds"."round_type" in ('behavioural', 'technical', 'hr', 'ceo')),
	CONSTRAINT "rounds_language_check" CHECK ("rounds"."language" in ('ja', 'en')),
	CONSTRAINT "rounds_mode_check" CHECK ("rounds"."mode" in ('practice', 'realistic'))
);
--> statement-breakpoint
CREATE TABLE "rubric_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version_label" text NOT NULL,
	"language" text NOT NULL,
	"dimensions" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rubric_versions_version_label_language_unique" UNIQUE("version_label","language"),
	CONSTRAINT "rubric_versions_language_check" CHECK ("rubric_versions"."language" in ('ja', 'en'))
);
--> statement-breakpoint
CREATE TABLE "scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scoring_attempt_id" uuid NOT NULL,
	"dimension" text NOT NULL,
	"value" smallint NOT NULL,
	"justification" text,
	CONSTRAINT "scores_scoring_attempt_id_dimension_unique" UNIQUE("scoring_attempt_id","dimension"),
	CONSTRAINT "scores_value_range_check" CHECK ("scores"."value" between 1 and 5)
);
--> statement-breakpoint
CREATE TABLE "scoring_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"answer_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"cv_version_id" uuid NOT NULL,
	"rubric_version_id" uuid NOT NULL,
	"generator_prompt_version" text,
	"model_id" text NOT NULL,
	"scoring_prompt_version" text NOT NULL,
	"tokens_in" integer,
	"tokens_out" integer,
	"error_class" text,
	"is_superseding" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scoring_attempts_status_check" CHECK ("scoring_attempts"."status" in ('pending', 'ok', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answers" ADD CONSTRAINT "answers_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answers" ADD CONSTRAINT "answers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answers" ADD CONSTRAINT "answers_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answers" ADD CONSTRAINT "answers_parent_answer_id_answers_id_fk" FOREIGN KEY ("parent_answer_id") REFERENCES "public"."answers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answers" ADD CONSTRAINT "answers_retry_of_answer_id_answers_id_fk" FOREIGN KEY ("retry_of_answer_id") REFERENCES "public"."answers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_citations" ADD CONSTRAINT "claim_citations_answer_id_answers_id_fk" FOREIGN KEY ("answer_id") REFERENCES "public"."answers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_citations" ADD CONSTRAINT "claim_citations_cv_claim_id_cv_claims_id_fk" FOREIGN KEY ("cv_claim_id") REFERENCES "public"."cv_claims"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cv_claims" ADD CONSTRAINT "cv_claims_cv_version_id_cv_versions_id_fk" FOREIGN KEY ("cv_version_id") REFERENCES "public"."cv_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cv_claims" ADD CONSTRAINT "cv_claims_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cv_claims" ADD CONSTRAINT "cv_claims_supersedes_claim_id_cv_claims_id_fk" FOREIGN KEY ("supersedes_claim_id") REFERENCES "public"."cv_claims"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cv_versions" ADD CONSTRAINT "cv_versions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "held_out_rescores" ADD CONSTRAINT "held_out_rescores_answer_id_answers_id_fk" FOREIGN KEY ("answer_id") REFERENCES "public"."answers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "held_out_rescores" ADD CONSTRAINT "held_out_rescores_baseline_attempt_id_scoring_attempts_id_fk" FOREIGN KEY ("baseline_attempt_id") REFERENCES "public"."scoring_attempts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "held_out_rescores" ADD CONSTRAINT "held_out_rescores_rescore_attempt_id_scoring_attempts_id_fk" FOREIGN KEY ("rescore_attempt_id") REFERENCES "public"."scoring_attempts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_contexts" ADD CONSTRAINT "role_contexts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "round_feedback" ADD CONSTRAINT "round_feedback_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_cv_version_id_cv_versions_id_fk" FOREIGN KEY ("cv_version_id") REFERENCES "public"."cv_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_role_context_id_role_contexts_id_fk" FOREIGN KEY ("role_context_id") REFERENCES "public"."role_contexts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_rubric_version_id_rubric_versions_id_fk" FOREIGN KEY ("rubric_version_id") REFERENCES "public"."rubric_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scores" ADD CONSTRAINT "scores_scoring_attempt_id_scoring_attempts_id_fk" FOREIGN KEY ("scoring_attempt_id") REFERENCES "public"."scoring_attempts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scoring_attempts" ADD CONSTRAINT "scoring_attempts_answer_id_answers_id_fk" FOREIGN KEY ("answer_id") REFERENCES "public"."answers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scoring_attempts" ADD CONSTRAINT "scoring_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scoring_attempts" ADD CONSTRAINT "scoring_attempts_cv_version_id_cv_versions_id_fk" FOREIGN KEY ("cv_version_id") REFERENCES "public"."cv_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scoring_attempts" ADD CONSTRAINT "scoring_attempts_rubric_version_id_rubric_versions_id_fk" FOREIGN KEY ("rubric_version_id") REFERENCES "public"."rubric_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_user_id_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "answers_first_attempt_uniq" ON "answers" USING btree ("question_id","language") WHERE "answers"."is_first_attempt";--> statement-breakpoint
CREATE INDEX "answers_round_id_position_idx" ON "answers" USING btree ("round_id","position");--> statement-breakpoint
CREATE INDEX "answers_user_id_created_at_idx" ON "answers" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "claim_citations_cv_claim_id_idx" ON "claim_citations" USING btree ("cv_claim_id");--> statement-breakpoint
CREATE INDEX "cv_claims_cv_version_id_idx" ON "cv_claims" USING btree ("cv_version_id");--> statement-breakpoint
CREATE INDEX "cv_claims_text_normalised_cv_version_id_idx" ON "cv_claims" USING btree ("text_normalised","cv_version_id");--> statement-breakpoint
CREATE INDEX "questions_active_slice_idx" ON "questions" USING btree ("user_id","language","round_type") WHERE "questions"."retired_at" is null;--> statement-breakpoint
CREATE INDEX "questions_embedding_hnsw_idx" ON "questions" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "rounds_user_id_started_at_idx" ON "rounds" USING btree ("user_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "rounds_user_id_language_round_type_started_at_idx" ON "rounds" USING btree ("user_id","language","round_type","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "scores_scoring_attempt_id_idx" ON "scores" USING btree ("scoring_attempt_id");--> statement-breakpoint
CREATE INDEX "scoring_attempts_answer_id_created_at_idx" ON "scoring_attempts" USING btree ("answer_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "scoring_attempts_user_id_model_id_rubric_version_id_idx" ON "scoring_attempts" USING btree ("user_id","model_id","rubric_version_id");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verifications_identifier_idx" ON "verifications" USING btree ("identifier");