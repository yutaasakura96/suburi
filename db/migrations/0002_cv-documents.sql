CREATE TABLE "cv_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cv_version_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"title" text,
	"source_filename" text,
	"position" integer NOT NULL,
	"start" integer NOT NULL,
	"end" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cv_documents_cv_version_id_position_unique" UNIQUE("cv_version_id","position"),
	CONSTRAINT "cv_documents_kind_check" CHECK ("cv_documents"."kind" in ('rirekisho', 'shokumu_keirekisho', 'cv', 'additional')),
	CONSTRAINT "cv_documents_range_order_check" CHECK ("cv_documents"."end" > "cv_documents"."start"),
	CONSTRAINT "cv_documents_title_check" CHECK (("cv_documents"."kind" = 'additional') = ("cv_documents"."title" is not null))
);
--> statement-breakpoint
ALTER TABLE "cv_documents" ADD CONSTRAINT "cv_documents_cv_version_id_cv_versions_id_fk" FOREIGN KEY ("cv_version_id") REFERENCES "public"."cv_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cv_documents" ADD CONSTRAINT "cv_documents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cv_versions_user_id_language_version_label_uniq" ON "cv_versions" USING btree ("user_id","language","version_label");--> statement-breakpoint
CREATE INDEX "cv_versions_user_id_language_created_at_idx" ON "cv_versions" USING btree ("user_id","language","created_at" DESC NULLS LAST);