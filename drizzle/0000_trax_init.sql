CREATE TABLE `projects` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `description` text DEFAULT '' NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tasks` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `parent_id` text,
  `name` text NOT NULL,
  `notes` text DEFAULT '' NOT NULL,
  `sort_order` integer DEFAULT 0 NOT NULL,
  `type` text NOT NULL,
  `planned_mode` text,
  `planned_start` text,
  `planned_end` text,
  `planned_duration_days` integer,
  `actual_start` text,
  `actual_end` text,
  `status` text DEFAULT 'not_started' NOT NULL,
  `percent_complete` integer DEFAULT 0 NOT NULL,
  `is_expanded` integer DEFAULT 1 NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`parent_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `dependencies` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `predecessor_task_id` text NOT NULL,
  `successor_task_id` text NOT NULL,
  `type` text NOT NULL,
  `lag_days` integer DEFAULT 0 NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`predecessor_task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`successor_task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `tasks_project_sort_idx` ON `tasks` (`project_id`,`sort_order`);
--> statement-breakpoint
CREATE INDEX `tasks_parent_idx` ON `tasks` (`parent_id`);
--> statement-breakpoint
CREATE INDEX `dependencies_project_idx` ON `dependencies` (`project_id`);
