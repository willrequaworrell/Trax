import { projectCreateSchema, projectUpdateSchema, taskCreateSchema, taskUpdateSchema, dependencyCreateSchema, dependencyUpdateSchema, type DependencyCreateInput, type DependencyUpdateInput, type PlannedMode, type Project, type ProjectCreateInput, type ProjectExport, type ProjectPlan, type ProjectUpdateInput, type Task, type TaskCreateInput, type TaskCreateResult, type TaskUpdateInput } from "@/domain/planner";
import { computeProjectPlan } from "@/domain/scheduler";
import { CorruptedProjectError, ValidationError } from "@/server/errors";
import { projectRepository } from "@/server/repositories/project-repository";
import { duplicateProjectSnapshot } from "@/server/services/project-duplication";
import { normalizeStoredTaskStatus } from "@/server/services/task-normalization";

function now() {
  return new Date().toISOString();
}

function createId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function exportMarkdown(plan: ProjectPlan) {
  const taskMap = new Map(plan.tasks.map((task) => [task.id, task]));
  const blockedTasks = plan.blockedTaskIds.map((id) => taskMap.get(id)).filter(Boolean);
  const upcomingTasks = plan.upcomingTaskIds.map((id) => taskMap.get(id)).filter(Boolean);
  const timelineLine = `${plan.timelineStart ?? "TBD"} -> ${plan.timelineEnd ?? "TBD"}`;

  return [
    `# ${plan.project.name}`,
    "",
    plan.project.description,
    "",
    `Timeline: ${timelineLine}`,
    "",
    "## Upcoming Work",
    ...upcomingTasks.map(
      (task) =>
        `- ${task?.name}: ${task?.computedPlannedStart ?? "TBD"} to ${task?.computedPlannedEnd ?? "TBD"} (${task?.computedPlannedDurationDays ?? 0} business days)`,
    ),
    "",
    "## Blocked Or Risky Tasks",
    ...(blockedTasks.length > 0
      ? blockedTasks.map(
          (task) =>
            `- ${task?.name}: ${(task?.issues ?? []).map((issue) => issue.message).join("; ") || "Blocked or invalid schedule state"}`,
        )
      : ["- None"]),
    "",
    "## Active Dependencies",
    ...plan.dependencies.map(
      (dependency) =>
        `- ${taskMap.get(dependency.predecessorTaskId)?.name ?? dependency.predecessorTaskId} ${dependency.type} ${taskMap.get(dependency.successorTaskId)?.name ?? dependency.successorTaskId} (lag ${dependency.lagDays})`,
    ),
    "",
    "## Task Snapshot",
    ...plan.rows.map((row) => {
      const task = taskMap.get(row.taskId);
      const prefix = `${"  ".repeat(row.depth)}-`;
      return `${prefix} ${task?.name} | planned ${task?.computedPlannedStart ?? "TBD"} -> ${task?.computedPlannedEnd ?? "TBD"} | actual ${task?.computedActualStart ?? "TBD"} -> ${task?.computedActualEnd ?? "TBD"} | status ${task?.rolledUpStatus}`;
    }),
  ].join("\n");
}

export async function listProjects() {
  return projectRepository.listProjects();
}

export async function getProjectPlan(projectId: string) {
  const snapshot = await projectRepository.getProjectSnapshot(projectId);

  if (!snapshot) {
    return null;
  }

  assertProjectTreeIsValid(projectId, snapshot.tasks);
  return computeProjectPlan(snapshot);
}

export async function createProject(input: ProjectCreateInput) {
  const parsed = projectCreateSchema.parse(input);
  const createdAt = now();
  const project: Project = {
    id: createId("project"),
    name: parsed.name,
    description: parsed.description,
    createdAt,
    updatedAt: createdAt,
  };

  await projectRepository.insertProject(project);
  return getProjectPlan(project.id);
}

export async function duplicateProject(projectId: string, name?: string) {
  const snapshot = await projectRepository.getProjectSnapshot(projectId);

  if (!snapshot) {
    return null;
  }

  assertProjectTreeIsValid(projectId, snapshot.tasks);
  const createdAt = now();
  const duplicated = duplicateProjectSnapshot(snapshot, {
    projectId: createId("project"),
    now: createdAt,
    createId,
    name: name?.trim() || `${snapshot.project.name} Copy`,
  });

  await projectRepository.insertProject(duplicated.project);
  await projectRepository.insertTasks(duplicated.tasks);
  await projectRepository.insertDependencies(duplicated.dependencies);

  return getProjectPlan(duplicated.project.id);
}

export async function updateProject(projectId: string, input: ProjectUpdateInput) {
  const parsed = projectUpdateSchema.parse(input);
  await projectRepository.updateProject(projectId, { ...parsed, updatedAt: now() });
  return getProjectPlan(projectId);
}

export async function deleteProject(projectId: string) {
  await projectRepository.deleteProject(projectId);
}

function nextSortOrder(siblings: Task[]) {
  return Math.max(0, ...siblings.map((task) => task.sortOrder)) + 10;
}

function buildChildren(tasks: Task[]) {
  const children = new Map<string, string[]>();

  for (const task of tasks) {
    if (!task.parentId) {
      continue;
    }

    const bucket = children.get(task.parentId) ?? [];
    bucket.push(task.id);
    children.set(task.parentId, bucket);
  }

  return children;
}

function collectDescendantIds(taskId: string, tasks: Task[]) {
  const children = buildChildren(tasks);
  const descendants = new Set<string>();
  const stack = [...(children.get(taskId) ?? [])];

  while (stack.length > 0) {
    const current = stack.pop();

    if (!current || descendants.has(current)) {
      continue;
    }

    descendants.add(current);

    for (const childId of children.get(current) ?? []) {
      stack.push(childId);
    }
  }

  return descendants;
}

function validateTaskParent(tasks: Task[], taskId: string | null, parentId: string | null) {
  if (parentId === null) {
    return;
  }

  if (taskId && parentId === taskId) {
    throw new ValidationError("A task cannot be its own parent.");
  }

  const parent = tasks.find((task) => task.id === parentId);

  if (!parent) {
    throw new ValidationError("Parent task was not found in this project.");
  }

  if (parent.type !== "summary") {
    throw new ValidationError("Parent task must be a summary section.");
  }

  const descendantIds = taskId ? collectDescendantIds(taskId, tasks) : new Set<string>();

  if (taskId && descendantIds.has(parentId)) {
    throw new ValidationError("A task cannot move under one of its own descendants.");
  }
}

function collectProjectTreeIssues(tasks: Task[]) {
  const taskMap = new Map(tasks.map((task) => [task.id, task]));
  const issues: string[] = [];
  const cycleTaskIds = new Set<string>();

  for (const task of tasks) {
    if (task.parentId === null) {
      continue;
    }

    if (task.parentId === task.id) {
      issues.push(`Task "${task.name}" cannot be its own parent.`);
      continue;
    }

    const parent = taskMap.get(task.parentId);

    if (!parent) {
      issues.push(`Task "${task.name}" points to a missing parent task.`);
      continue;
    }

    if (parent.type !== "summary") {
      issues.push(`Task "${task.name}" points to "${parent.name}", which is not a summary section.`);
    }
  }

  const visitState = new Map<string, "visiting" | "done">();
  const path: string[] = [];

  function visit(taskId: string) {
    const state = visitState.get(taskId);

    if (state === "done") {
      return;
    }

    if (state === "visiting") {
      const cycleStart = path.indexOf(taskId);
      const cycleIds = cycleStart >= 0 ? path.slice(cycleStart) : [taskId];
      for (const cycleId of cycleIds) {
        cycleTaskIds.add(cycleId);
      }
      return;
    }

    visitState.set(taskId, "visiting");
    path.push(taskId);

    const parentId = taskMap.get(taskId)?.parentId;
    if (parentId && taskMap.has(parentId)) {
      visit(parentId);
    }

    path.pop();
    visitState.set(taskId, "done");
  }

  for (const task of tasks) {
    visit(task.id);
  }

  for (const taskId of cycleTaskIds) {
    const task = taskMap.get(taskId);
    issues.push(`Task "${task?.name ?? taskId}" is part of a parent cycle.`);
  }

  return [...new Set(issues)];
}

function assertProjectTreeIsValid(projectId: string, tasks: Task[]) {
  const issues = collectProjectTreeIssues(tasks);

  if (issues.length > 0) {
    throw new CorruptedProjectError(projectId, issues);
  }
}

function normalizeTaskPatch(existing: Task, patch: TaskUpdateInput): Partial<Task> {
  const merged = { ...existing, ...patch };
  const normalized: Partial<Task> = { ...patch };

  if (merged.type === "summary") {
    normalized.parentId = null;
    normalized.plannedMode = null;
    normalized.plannedStart = null;
    normalized.plannedEnd = null;
    normalized.plannedDurationDays = null;
    normalized.actualStart = null;
    normalized.actualEnd = null;
    normalized.percentComplete = existing.percentComplete;
    normalized.status = existing.status;
  } else if (merged.type === "milestone") {
    normalized.plannedDurationDays = 0;
    normalized.plannedMode = "start_duration";
    normalized.plannedEnd = null;
  } else if ((patch.plannedStart !== undefined && patch.plannedEnd !== undefined) || merged.plannedMode === "start_end") {
    normalized.plannedMode = "start_end";
    if (merged.plannedStart && merged.plannedEnd) {
      normalized.plannedDurationDays = Math.max(1, merged.plannedDurationDays ?? 1);
    }
  } else if (
    patch.plannedMode === "start_duration" ||
    patch.plannedDurationDays !== undefined ||
    patch.plannedStart !== undefined
  ) {
    normalized.plannedMode = "start_duration";
    normalized.plannedEnd = null;
    normalized.plannedDurationDays = Math.max(1, merged.plannedDurationDays ?? 1);
  }

  const normalizedTask = { ...merged, ...normalized };
  if (normalizedTask.type !== "summary") {
    const normalizedStatus = normalizeStoredTaskStatus(normalizedTask);
    if (
      normalizedStatus !== normalizedTask.status ||
      patch.status !== undefined ||
      patch.percentComplete !== undefined ||
      patch.actualStart !== undefined ||
      patch.actualEnd !== undefined
    ) {
      normalized.status = normalizedStatus;
    }
  }

  return normalized;
}

function buildTaskDates(
  type: Task["type"],
  input: Pick<TaskCreateInput, "plannedMode" | "plannedStart" | "plannedEnd" | "plannedDurationDays">,
): Pick<Task, "plannedMode" | "plannedStart" | "plannedEnd" | "plannedDurationDays"> {
  if (type === "summary") {
    return {
      plannedMode: null,
      plannedStart: null,
      plannedEnd: null,
      plannedDurationDays: null,
    };
  }

  const plannedStart = input.plannedStart ?? new Date().toISOString().slice(0, 10);

  if (type === "milestone") {
    return {
      plannedMode: "start_duration" satisfies PlannedMode,
      plannedStart,
      plannedEnd: null,
      plannedDurationDays: 0,
    };
  }

  if (input.plannedMode === "start_end") {
    return {
      plannedMode: "start_end" satisfies PlannedMode,
      plannedStart,
      plannedEnd: input.plannedEnd ?? null,
      plannedDurationDays: Math.max(1, input.plannedDurationDays ?? 1),
    };
  }

  return {
    plannedMode: "start_duration" satisfies PlannedMode,
    plannedStart,
    plannedEnd: null,
    plannedDurationDays: Math.max(1, input.plannedDurationDays ?? 1),
  };
}

export async function createTask(projectId: string, input: TaskCreateInput): Promise<TaskCreateResult | null> {
  const parsed = taskCreateSchema.parse(input);
  const snapshot = await projectRepository.getProjectSnapshot(projectId);

  if (!snapshot) {
    return null;
  }

  const normalizedParentId = parsed.type === "summary" ? null : parsed.parentId ?? null;
  validateTaskParent(snapshot.tasks, null, normalizedParentId);
  const siblings = snapshot.tasks.filter((task) => task.parentId === normalizedParentId);
  const createdAt = now();
  const dates = buildTaskDates(parsed.type, parsed);
  const task: Task = {
    id: createId("task"),
    projectId,
    parentId: normalizedParentId,
    name: parsed.name,
    notes: parsed.notes ?? "",
    sortOrder: nextSortOrder(siblings),
    type: parsed.type,
    plannedMode: dates.plannedMode,
    plannedStart: dates.plannedStart,
    plannedEnd: dates.plannedEnd,
    plannedDurationDays: dates.plannedDurationDays,
    actualStart: null,
    actualEnd: null,
    status: "not_started",
    percentComplete: 0,
    isExpanded: true,
    createdAt,
    updatedAt: createdAt,
  };

  await projectRepository.createTask(task);
  const plan = await getProjectPlan(projectId);
  return plan ? { plan, taskId: task.id } : null;
}

export async function updateTask(taskId: string, input: TaskUpdateInput) {
  const parsed = taskUpdateSchema.parse(input);
  const existing = await projectRepository.getTask(taskId);

  if (!existing) {
    return null;
  }

  const nextParentId = (parsed.type ?? existing.type) === "summary" ? null : (parsed.parentId ?? existing.parentId);
  validateTaskParent(await getProjectTasks(existing.projectId), existing.id, nextParentId);
  const normalized = normalizeTaskPatch(existing, parsed);
  await projectRepository.updateTask(taskId, { ...normalized, updatedAt: now() });
  return getProjectPlan(existing.projectId);
}

export async function deleteTask(taskId: string) {
  const projectId = await projectRepository.deleteTask(taskId);
  return projectId ? getProjectPlan(projectId) : null;
}

async function getProjectTasks(projectId: string) {
  const snapshot = await projectRepository.getProjectSnapshot(projectId);

  if (!snapshot) {
    throw new ValidationError("Project not found.");
  }

  return snapshot.tasks;
}

async function validateDependency(projectId: string, input: DependencyCreateInput | DependencyUpdateInput) {
  const snapshot = await projectRepository.getProjectSnapshot(projectId);

  if (!snapshot) {
    throw new Error("Project not found.");
  }

  const predecessor = snapshot.tasks.find((task) => task.id === input.predecessorTaskId);
  const successor = snapshot.tasks.find((task) => task.id === input.successorTaskId);

  if (!predecessor || !successor) {
    throw new Error("Dependency tasks were not found.");
  }

  if (predecessor.type === "summary" || successor.type === "summary") {
    throw new Error("Dependencies may only connect leaf tasks.");
  }

  if (predecessor.id === successor.id) {
    throw new Error("A task cannot depend on itself.");
  }
}

export async function createDependency(projectId: string, input: DependencyCreateInput) {
  const parsed = dependencyCreateSchema.parse(input);
  await validateDependency(projectId, parsed);
  const createdAt = now();

  await projectRepository.createDependency({
    id: createId("dep"),
    projectId,
    predecessorTaskId: parsed.predecessorTaskId,
    successorTaskId: parsed.successorTaskId,
    type: parsed.type,
    lagDays: parsed.lagDays,
    createdAt,
    updatedAt: createdAt,
  });

  return getProjectPlan(projectId);
}

export async function updateDependency(dependencyId: string, input: DependencyUpdateInput) {
  const parsed = dependencyUpdateSchema.parse(input);
  const dependency = await projectRepository.getDependency(dependencyId);

  if (!dependency) {
    return null;
  }

  const merged = { ...dependency, ...parsed };
  await validateDependency(dependency.projectId, merged);
  await projectRepository.updateDependency(dependencyId, { ...parsed, updatedAt: now() });
  return getProjectPlan(dependency.projectId);
}

export async function deleteDependency(dependencyId: string) {
  const projectId = await projectRepository.deleteDependency(dependencyId);
  return projectId ? getProjectPlan(projectId) : null;
}

export async function exportProject(projectId: string): Promise<ProjectExport | null> {
  const plan = await getProjectPlan(projectId);

  if (!plan) {
    return null;
  }

  return {
    json: {
      project: plan.project,
      timeline: {
        start: plan.timelineStart,
        end: plan.timelineEnd,
      },
      issues: plan.issues,
      tasks: plan.tasks,
      dependencies: plan.dependencies,
    },
    markdown: exportMarkdown(plan),
  };
}

export const __testUtils = {
  buildTaskDates,
  collectProjectTreeIssues,
  normalizeTaskPatch,
  validateTaskParent,
};
