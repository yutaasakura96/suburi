CREATE TABLE "model_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"answer_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"body" text NOT NULL,
	"unsupported_spans" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"body_translated" jsonb,
	"model_id" text NOT NULL,
	"prompt_version" text NOT NULL,
	"tokens_in" integer,
	"tokens_out" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "model_answers_answer_id_unique" UNIQUE("answer_id")
);
--> statement-breakpoint
ALTER TABLE "rate_limit_windows" DROP CONSTRAINT "rate_limit_windows_route_check";--> statement-breakpoint
ALTER TABLE "model_answers" ADD CONSTRAINT "model_answers_answer_id_answers_id_fk" FOREIGN KEY ("answer_id") REFERENCES "public"."answers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_answers" ADD CONSTRAINT "model_answers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_limit_windows" ADD CONSTRAINT "rate_limit_windows_route_check" CHECK ("rate_limit_windows"."route" in ('cv-versions', 'rounds', 'transcribe', 'submit', 'complete', 'feedback', 'speech', 'scoring-attempts', 'scoring-run', 'model-answers'));