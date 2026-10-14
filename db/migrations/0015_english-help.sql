CREATE TABLE "question_translations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"language" text NOT NULL,
	"body" text NOT NULL,
	"source" text NOT NULL,
	"model_id" text,
	"prompt_version" text NOT NULL,
	"tokens_in" integer,
	"tokens_out" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "question_translations_language_check" CHECK ("question_translations"."language" in ('ja', 'en')),
	CONSTRAINT "question_translations_source_check" CHECK ("question_translations"."source" in ('generated', 'hand_written', 'translated')),
	CONSTRAINT "question_translations_body_not_blank_check" CHECK (btrim("question_translations"."body") <> ''),
	CONSTRAINT "question_translations_model_check" CHECK (("question_translations"."source" = 'hand_written') = ("question_translations"."model_id" is null)),
	CONSTRAINT "question_translations_tokens_check" CHECK ("question_translations"."source" = 'translated' or ("question_translations"."tokens_in" is null and "question_translations"."tokens_out" is null))
);
--> statement-breakpoint
CREATE TABLE "user_settings" (
	"user_id" text PRIMARY KEY NOT NULL,
	"english_help" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "question_translations" ADD CONSTRAINT "question_translations_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_translations" ADD CONSTRAINT "question_translations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "question_translations_question_id_language_created_at_idx" ON "question_translations" USING btree ("question_id","language","created_at" DESC NULLS LAST);