ALTER TABLE "projects" ADD COLUMN "baseline_captured_at" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "baseline_planned_start" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "baseline_planned_end" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "baseline_planned_duration_days" integer;