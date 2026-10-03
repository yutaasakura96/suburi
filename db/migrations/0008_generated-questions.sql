CREATE TABLE "near_duplicate_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"matched_question_id" uuid NOT NULL,
	"question_id" uuid,
	"similarity" double precision NOT NULL,
	"threshold" double precision NOT NULL,
	"embedding_model_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "near_duplicate_checks_decision_check" CHECK (("near_duplicate_checks"."question_id" is null) = ("near_duplicate_checks"."similarity" >= "near_duplicate_checks"."threshold")),
	CONSTRAINT "near_duplicate_checks_distinct_check" CHECK ("near_duplicate_checks"."question_id" <> "near_duplicate_checks"."matched_question_id")
);
--> statement-breakpoint
ALTER TABLE "cron_readings" DROP CONSTRAINT "cron_readings_signal_check";--> statement-breakpoint
ALTER TABLE "role_contexts" ADD COLUMN "source_filename" text;--> statement-breakpoint
ALTER TABLE "near_duplicate_checks" ADD CONSTRAINT "near_duplicate_checks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "near_duplicate_checks" ADD CONSTRAINT "near_duplicate_checks_matched_question_id_questions_id_fk" FOREIGN KEY ("matched_question_id") REFERENCES "public"."questions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "near_duplicate_checks" ADD CONSTRAINT "near_duplicate_checks_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "near_duplicate_checks_user_created_at_idx" ON "near_duplicate_checks" USING btree ("user_id","created_at");--> statement-breakpoint
ALTER TABLE "cron_readings" ADD CONSTRAINT "cron_readings_signal_check" CHECK ("cron_readings"."signal" in ('scoring_pending_over_24h', 'scoring_failed_unsuperseded', 'spend_week_to_date_usd', 'cv_spans_rejected', 'cv_claims_split', 'cv_claims_duplicated', 'cv_unclaimed_run_max', 'cv_quotes_outside_window', 'round_feedback_missing_over_24h', 'backup_dump_failed', 'digest_rounds_started', 'digest_rounds_completed', 'digest_tokens_in', 'digest_tokens_out', 'digest_spend_usd', 'digest_near_misses', 'digest_near_miss_similarity_min', 'digest_near_miss_similarity_median', 'digest_near_miss_similarity_max', 'digest_near_duplicates_reused'));