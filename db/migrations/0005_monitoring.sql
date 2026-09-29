CREATE TABLE "cron_readings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"signal" text NOT NULL,
	"value" double precision,
	"threshold" double precision,
	"is_red" boolean,
	"subject_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"unpriced_model_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"window_start" timestamp with time zone,
	"window_end" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cron_readings_run_id_user_id_signal_unique" UNIQUE("run_id","user_id","signal"),
	CONSTRAINT "cron_readings_signal_check" CHECK ("cron_readings"."signal" in ('scoring_pending_over_24h', 'scoring_failed_unsuperseded', 'spend_week_to_date_usd', 'cv_spans_rejected', 'cv_claims_split', 'cv_claims_duplicated', 'cv_unclaimed_run_max', 'cv_quotes_outside_window', 'round_feedback_missing_over_24h', 'digest_rounds_started', 'digest_rounds_completed', 'digest_tokens_in', 'digest_tokens_out', 'digest_spend_usd')),
	CONSTRAINT "cron_readings_judged_check" CHECK (("cron_readings"."threshold" is null) = ("cron_readings"."is_red" is null)),
	CONSTRAINT "cron_readings_red_needs_value_check" CHECK ("cron_readings"."value" is not null or "cron_readings"."is_red" is not true),
	CONSTRAINT "cron_readings_unpriced_models_spend_check" CHECK (cardinality("cron_readings"."unpriced_model_ids") = 0 or "cron_readings"."signal" in ('spend_week_to_date_usd', 'digest_spend_usd'))
);
--> statement-breakpoint
CREATE TABLE "cron_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cron_runs_job_check" CHECK ("cron_runs"."job" in ('self-check', 'digest'))
);
--> statement-breakpoint
ALTER TABLE "cv_versions" ADD COLUMN "spans_rejected" integer;--> statement-breakpoint
ALTER TABLE "cv_versions" ADD COLUMN "claims_split" integer;--> statement-breakpoint
ALTER TABLE "cv_versions" ADD COLUMN "claims_duplicated" integer;--> statement-breakpoint
ALTER TABLE "cv_versions" ADD COLUMN "unclaimed_run_max" integer;--> statement-breakpoint
ALTER TABLE "cv_versions" ADD COLUMN "quotes_outside_window" integer;--> statement-breakpoint
ALTER TABLE "cron_readings" ADD CONSTRAINT "cron_readings_run_id_cron_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."cron_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cron_readings" ADD CONSTRAINT "cron_readings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cron_runs_job_created_at_idx" ON "cron_runs" USING btree ("job","created_at" DESC NULLS LAST);