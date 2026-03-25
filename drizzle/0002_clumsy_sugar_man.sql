CREATE TABLE "checkpoints" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"name" text NOT NULL,
	"percent_complete" integer DEFAULT 0 NOT NULL,
	"weight_points" integer DEFAULT 1 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "checkpoints" ADD CONSTRAINT "checkpoints_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "checkpoints_task_sort_idx" ON "checkpoints" USING btree ("task_id","sort_order");