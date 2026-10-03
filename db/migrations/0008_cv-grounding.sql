CREATE TABLE "answer_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"answer_id" uuid NOT NULL,
	"scoring_attempt_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"span_start" integer NOT NULL,
	"span_end" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "answer_flags_kind_check" CHECK ("answer_flags"."kind" in ('unsupported')),
	CONSTRAINT "answer_flags_span_order_check" CHECK ("answer_flags"."span_end" > "answer_flags"."span_start")
);
--> statement-breakpoint
ALTER TABLE "round_feedback" ADD COLUMN "untouched_claim_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "scoring_attempts" ADD COLUMN "answered_language" text;--> statement-breakpoint
ALTER TABLE "answer_flags" ADD CONSTRAINT "answer_flags_answer_id_answers_id_fk" FOREIGN KEY ("answer_id") REFERENCES "public"."answers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answer_flags" ADD CONSTRAINT "answer_flags_scoring_attempt_id_scoring_attempts_id_fk" FOREIGN KEY ("scoring_attempt_id") REFERENCES "public"."scoring_attempts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answer_flags" ADD CONSTRAINT "answer_flags_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "answer_flags_answer_id_idx" ON "answer_flags" USING btree ("answer_id");--> statement-breakpoint
ALTER TABLE "scoring_attempts" ADD CONSTRAINT "scoring_attempts_answered_language_check" CHECK ("scoring_attempts"."answered_language" in ('ja', 'en'));--> statement-breakpoint
ALTER TABLE "scoring_attempts" ADD CONSTRAINT "scoring_attempts_answered_language_ok_check" CHECK ("scoring_attempts"."answered_language" is null or "scoring_attempts"."status" = 'ok');