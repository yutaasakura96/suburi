CREATE TABLE "round_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"round_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"position" integer NOT NULL,
	"question_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "round_questions_round_id_position_unique" UNIQUE("round_id","position"),
	CONSTRAINT "round_questions_round_id_question_id_unique" UNIQUE("round_id","question_id"),
	CONSTRAINT "round_questions_position_check" CHECK ("round_questions"."position" >= 1)
);
--> statement-breakpoint
ALTER TABLE "rate_limit_windows" DROP CONSTRAINT "rate_limit_windows_route_check";--> statement-breakpoint
ALTER TABLE "questions" ALTER COLUMN "generator_prompt_version" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "scoring_attempts" ALTER COLUMN "generator_prompt_version" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "round_questions" ADD CONSTRAINT "round_questions_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "round_questions" ADD CONSTRAINT "round_questions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "round_questions" ADD CONSTRAINT "round_questions_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "answers_question_id_language_idx" ON "answers" USING btree ("question_id","language");--> statement-breakpoint
CREATE UNIQUE INDEX "role_contexts_general_uniq" ON "role_contexts" USING btree ("user_id") WHERE "role_contexts"."kind" = 'general';--> statement-breakpoint
ALTER TABLE "rate_limit_windows" ADD CONSTRAINT "rate_limit_windows_route_check" CHECK ("rate_limit_windows"."route" in ('cv-versions', 'rounds', 'transcribe', 'submit', 'complete', 'feedback'));