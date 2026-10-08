ALTER TABLE "projects" ADD COLUMN "auto_schedule" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "reporting_target_task_id" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "forecast_needs_review" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "forecast_locked" boolean DEFAULT false NOT NULL;