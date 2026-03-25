CREATE TABLE "pending_delete_actions" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"kind" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_label" text NOT NULL,
	"payload_json" text NOT NULL,
	"created_at" text NOT NULL,
	"expires_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pending_delete_actions" ADD CONSTRAINT "pending_delete_actions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pending_delete_actions_project_expires_idx" ON "pending_delete_actions" USING btree ("project_id","expires_at");--> statement-breakpoint
CREATE INDEX "pending_delete_actions_expires_idx" ON "pending_delete_actions" USING btree ("expires_at");