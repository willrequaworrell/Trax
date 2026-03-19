import { z } from "zod";

export const taskTypes = ["summary", "task", "milestone"] as const;
export const taskStatuses = ["not_started", "in_progress", "blocked", "done"] as const;
export const dependencyTypes = ["FS", "SS", "FF", "SF"] as const;
export const plannedModes = ["start_duration", "start_end"] as const;

export type TaskType = (typeof taskTypes)[number];
export type TaskStatus = (typeof taskStatuses)[number];
export type DependencyType = (typeof dependencyTypes)[number];
export type PlannedMode = (typeof plannedModes)[number];

export const projectSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  description: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const taskSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  parentId: z.string().nullable(),
  name: z.string().min(1),
  notes: z.string(),
  sortOrder: z.number().int(),
  type: z.enum(taskTypes),
  plannedMode: z.enum(plannedModes).nullable(),
  plannedStart: z.string().nullable(),
  plannedEnd: z.string().nullable(),
  plannedDurationDays: z.number().int().nullable(),
  actualStart: z.string().nullable(),
  actualEnd: z.string().nullable(),
  status: z.enum(taskStatuses),
  percentComplete: z.number().int().min(0).max(100),
  isExpanded: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const dependencySchema = z.object({
  id: z.string(),
  projectId: z.string(),
  predecessorTaskId: z.string(),
  successorTaskId: z.string(),
  type: z.enum(dependencyTypes),
  lagDays: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const projectCreateSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(1000).default(""),
});

export const projectUpdateSchema = projectCreateSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  "At least one field is required.",
);

export const taskCreateSchema = z.object({
  parentId: z.string().nullable().optional(),
  name: z.string().min(1).max(160),
  notes: z.string().max(4000).optional(),
  type: z.enum(taskTypes).default("task"),
  plannedMode: z.enum(plannedModes).nullable().optional(),
  plannedStart: z.string().nullable().optional(),
  plannedEnd: z.string().nullable().optional(),
  plannedDurationDays: z.number().int().min(0).nullable().optional(),
});

export const taskUpdateSchema = z
  .object({
    parentId: z.string().nullable().optional(),
    name: z.string().min(1).max(160).optional(),
    notes: z.string().max(4000).optional(),
    sortOrder: z.number().int().optional(),
    type: z.enum(taskTypes).optional(),
    plannedMode: z.enum(plannedModes).nullable().optional(),
    plannedStart: z.string().nullable().optional(),
    plannedEnd: z.string().nullable().optional(),
    plannedDurationDays: z.number().int().min(0).nullable().optional(),
    actualStart: z.string().nullable().optional(),
    actualEnd: z.string().nullable().optional(),
    status: z.enum(taskStatuses).optional(),
    percentComplete: z.number().int().min(0).max(100).optional(),
    isExpanded: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "At least one field is required.");

export const dependencyCreateSchema = z.object({
  predecessorTaskId: z.string(),
  successorTaskId: z.string(),
  type: z.enum(dependencyTypes),
  lagDays: z.number().int().default(0),
});

export const dependencyUpdateSchema = dependencyCreateSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, "At least one field is required.");

export type Project = z.infer<typeof projectSchema>;
export type Task = z.infer<typeof taskSchema>;
export type Dependency = z.infer<typeof dependencySchema>;
export type ProjectCreateInput = z.infer<typeof projectCreateSchema>;
export type ProjectUpdateInput = z.infer<typeof projectUpdateSchema>;
export type TaskCreateInput = z.infer<typeof taskCreateSchema>;
export type TaskUpdateInput = z.infer<typeof taskUpdateSchema>;
export type DependencyCreateInput = z.infer<typeof dependencyCreateSchema>;
export type DependencyUpdateInput = z.infer<typeof dependencyUpdateSchema>;

export type PlanningIssueSeverity = "error" | "warning" | "info";

export type PlanningIssue = {
  id: string;
  taskId?: string;
  severity: PlanningIssueSeverity;
  message: string;
};

export type PlannedTask = Task & {
  isSummary: boolean;
  childIds: string[];
  depth: number;
  hasChildren: boolean;
  blockedBy: Dependency[];
  blocking: Dependency[];
  computedPlannedStart: string | null;
  computedPlannedEnd: string | null;
  computedPlannedDurationDays: number | null;
  computedActualStart: string | null;
  computedActualEnd: string | null;
  rolledUpEffortDays: number;
  rolledUpPercentComplete: number;
  rolledUpStatus: TaskStatus;
  issues: PlanningIssue[];
};

export type PlannerRow = {
  taskId: string;
  depth: number;
  hasChildren: boolean;
  isExpanded: boolean;
};

export type ProjectPlan = {
  project: Project;
  tasks: PlannedTask[];
  dependencies: Dependency[];
  rows: PlannerRow[];
  issues: PlanningIssue[];
  projectPercentComplete: number;
  timelineStart: string | null;
  timelineEnd: string | null;
  upcomingTaskIds: string[];
  blockedTaskIds: string[];
};

export type ProjectExport = {
  json: {
    project: Project;
    timeline: { start: string | null; end: string | null };
    issues: PlanningIssue[];
    tasks: PlannedTask[];
    dependencies: Dependency[];
  };
  markdown: string;
};

export type TaskCreateResult = {
  plan: ProjectPlan;
  taskId: string;
};
