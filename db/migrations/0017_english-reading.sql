CREATE TABLE "english_readings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"answer_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"status" text NOT NULL,
	"source_code_points" integer NOT NULL,
	"model_id" text NOT NULL,
	"prompt_version" text NOT NULL,
	"tokens_in" integer,
	"tokens_out" integer,
	"error_class" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "english_readings_status_check" CHECK ("english_readings"."status" in ('ok', 'failed')),
	CONSTRAINT "english_readings_error_class_check" CHECK ("english_readings"."status" = 'failed' or "english_readings"."error_class" is null),
	CONSTRAINT "english_readings_source_code_points_check" CHECK ("english_readings"."source_code_points" between 1 and 8000)
);
--> statement-breakpoint
ALTER TABLE "rate_limit_windows" DROP CONSTRAINT "rate_limit_windows_route_check";--> statement-breakpoint
ALTER TABLE "english_readings" ADD CONSTRAINT "english_readings_answer_id_answers_id_fk" FOREIGN KEY ("answer_id") REFERENCES "public"."answers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "english_readings" ADD CONSTRAINT "english_readings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "english_readings_user_id_created_at_idx" ON "english_readings" USING btree ("user_id","created_at");--> statement-breakpoint
ALTER TABLE "rate_limit_windows" ADD CONSTRAINT "rate_limit_windows_route_check" CHECK ("rate_limit_windows"."route" in ('cv-versions', 'rounds', 'transcribe', 'submit', 'complete', 'feedback', 'speech', 'scoring-attempts', 'scoring-run', 'model-answers', 'english-reading'));