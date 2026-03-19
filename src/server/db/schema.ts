import { relations } from "drizzle-orm";
import { type AnySQLiteColumn, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const tasks = sqliteTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    parentId: text("parent_id").references((): AnySQLiteColumn => tasks.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    notes: text("notes").notNull().default(""),
    sortOrder: integer("sort_order").notNull().default(0),
    type: text("type").notNull(),
    plannedMode: text("planned_mode"),
    plannedStart: text("planned_start"),
    plannedEnd: text("planned_end"),
    plannedDurationDays: integer("planned_duration_days"),
    actualStart: text("actual_start"),
    actualEnd: text("actual_end"),
    status: text("status").notNull().default("not_started"),
    percentComplete: integer("percent_complete").notNull().default(0),
    isExpanded: integer("is_expanded", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    projectSortIdx: index("tasks_project_sort_idx").on(table.projectId, table.sortOrder),
    parentIdx: index("tasks_parent_idx").on(table.parentId),
  }),
);

export const dependencies = sqliteTable(
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

export const projectRelations = relations(projects, ({ many }) => ({
  tasks: many(tasks),
  dependencies: many(dependencies),
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

export type ProjectRow = typeof projects.$inferSelect;
export type TaskRow = typeof tasks.$inferSelect;
export type DependencyRow = typeof dependencies.$inferSelect;
export type ProjectInsert = typeof projects.$inferInsert;
export type TaskInsert = typeof tasks.$inferInsert;
export type DependencyInsert = typeof dependencies.$inferInsert;
