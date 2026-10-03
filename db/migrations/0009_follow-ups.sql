CREATE TABLE "follow_ups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_answer_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"status" text NOT NULL,
	"prompt_text" text,
	"model_id" text NOT NULL,
	"prompt_version" text NOT NULL,
	"tokens_in" integer,
	"tokens_out" integer,
	"error_class" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "follow_ups_parent_answer_id_unique" UNIQUE("parent_answer_id"),
	CONSTRAINT "follow_ups_status_check" CHECK ("follow_ups"."status" in ('generated', 'missing')),
	CONSTRAINT "follow_ups_generated_has_text_check" CHECK (("follow_ups"."status" = 'generated') = ("follow_ups"."prompt_text" is not null)),
	CONSTRAINT "follow_ups_error_class_missing_check" CHECK ("follow_ups"."status" = 'missing' or "follow_ups"."error_class" is null)
);
--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_parent_answer_id_answers_id_fk" FOREIGN KEY ("parent_answer_id") REFERENCES "public"."answers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;