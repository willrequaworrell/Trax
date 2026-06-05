CREATE TABLE "project_share_links" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"show_baseline_variance" boolean DEFAULT false NOT NULL,
	"revoked_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_share_links" ADD CONSTRAINT "project_share_links_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_share_links_project_idx" ON "project_share_links" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_share_links_token_hash_idx" ON "project_share_links" USING btree ("token_hash");