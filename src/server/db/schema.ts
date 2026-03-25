import { relations } from "drizzle-orm";
import { type AnyPgColumn, boolean, index, integer, pgTable, text } from "drizzle-orm/pg-core";

export const projects = pgTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  baselineCapturedAt: text("baseline_captured_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const tasks = pgTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    parentId: text("parent_id").references((): AnyPgColumn => tasks.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    notes: text("notes").notNull().default(""),
    sortOrder: integer("sort_order").notNull().default(0),
    type: text("type").notNull(),
    plannedMode: text("planned_mode"),
    plannedStart: text("planned_start"),
    plannedEnd: text("planned_end"),
    plannedDurationDays: integer("planned_duration_days"),
    baselinePlannedStart: text("baseline_planned_start"),
    baselinePlannedEnd: text("baseline_planned_end"),
    baselinePlannedDurationDays: integer("baseline_planned_duration_days"),
    actualStart: text("actual_start"),
    actualEnd: text("actual_end"),
    status: text("status").notNull().default("not_started"),
    percentComplete: integer("percent_complete").notNull().default(0),
    isExpanded: boolean("is_expanded").notNull().default(true),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    projectSortIdx: index("tasks_project_sort_idx").on(table.projectId, table.sortOrder),
    parentIdx: index("tasks_parent_idx").on(table.parentId),
  }),
);

export const dependencies = pgTable(
  "dependencies",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    predecessorTaskId: text("predecessor_task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    successorTaskId: text("successor_task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    lagDays: integer("lag_days").notNull().default(0),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    projectIdx: index("dependencies_project_idx").on(table.projectId),
  }),
);

export const checkpoints = pgTable(
  "checkpoints",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    percentComplete: integer("percent_complete").notNull().default(0),
    weightPoints: integer("weight_points").notNull().default(1),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    taskSortIdx: index("checkpoints_task_sort_idx").on(table.taskId, table.sortOrder),
  }),
);

export const pendingDeleteActions = pgTable(
  "pending_delete_actions",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    subjectType: text("subject_type").notNull(),
    subjectLabel: text("subject_label").notNull(),
    payloadJson: text("payload_json").notNull(),
    createdAt: text("created_at").notNull(),
    expiresAt: text("expires_at").notNull(),
  },
  (table) => ({
    projectExpiresIdx: index("pending_delete_actions_project_expires_idx").on(table.projectId, table.expiresAt),
    expiresIdx: index("pending_delete_actions_expires_idx").on(table.expiresAt),
  }),
);

export const projectRelations = relations(projects, ({ many }) => ({
  tasks: many(tasks),
  dependencies: many(dependencies),
  pendingDeleteActions: many(pendingDeleteActions),
}));

export const taskRelations = relations(tasks, ({ one, many }) => ({
  project: one(projects, {
    fields: [tasks.projectId],
    references: [projects.id],
  }),
  parent: one(tasks, {
    fields: [tasks.parentId],
    references: [tasks.id],
    relationName: "task_children",
  }),
  children: many(tasks, {
    relationName: "task_children",
  }),
  predecessorLinks: many(dependencies, {
    relationName: "predecessor_links",
  }),
  successorLinks: many(dependencies, {
    relationName: "successor_links",
  }),
  checkpoints: many(checkpoints),
}));

export const dependencyRelations = relations(dependencies, ({ one }) => ({
  project: one(projects, {
    fields: [dependencies.projectId],
    references: [projects.id],
  }),
  predecessor: one(tasks, {
    fields: [dependencies.predecessorTaskId],
    references: [tasks.id],
    relationName: "predecessor_links",
  }),
  successor: one(tasks, {
    fields: [dependencies.successorTaskId],
    references: [tasks.id],
    relationName: "successor_links",
  }),
}));

export const checkpointRelations = relations(checkpoints, ({ one }) => ({
  task: one(tasks, {
    fields: [checkpoints.taskId],
    references: [tasks.id],
  }),
}));

export const pendingDeleteActionRelations = relations(pendingDeleteActions, ({ one }) => ({
  project: one(projects, {
    fields: [pendingDeleteActions.projectId],
    references: [projects.id],
  }),
}));

export type ProjectRow = typeof projects.$inferSelect;
export type TaskRow = typeof tasks.$inferSelect;
export type DependencyRow = typeof dependencies.$inferSelect;
export type CheckpointRow = typeof checkpoints.$inferSelect;
export type PendingDeleteActionRow = typeof pendingDeleteActions.$inferSelect;
export type ProjectInsert = typeof projects.$inferInsert;
export type TaskInsert = typeof tasks.$inferInsert;
export type DependencyInsert = typeof dependencies.$inferInsert;
export type CheckpointInsert = typeof checkpoints.$inferInsert;
export type PendingDeleteActionInsert = typeof pendingDeleteActions.$inferInsert;
