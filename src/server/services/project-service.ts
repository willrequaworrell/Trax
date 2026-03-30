import { and, eq, inArray, or } from "drizzle-orm";
import { addDurationToStart, businessDaysInclusive, clampToBusinessDay, shiftBusinessDays } from "@/domain/date-utils";
import {
  checkpointCreateSchema,
  checkpointMoveSchema,
  checkpointUpdateSchema,
  projectCreateSchema,
  projectUpdateSchema,
  taskCreateSchema,
  taskUpdateSchema,
  taskWrapSchema,
  dependencyCreateSchema,
  dependencyUpdateSchema,
  type Checkpoint,
  type CheckpointCreateInput,
  type CheckpointMoveInput,
  type CheckpointUpdateInput,
  type Dependency,
  type DependencyCreateInput,
  type DependencyUpdateInput,
  type DependencyPendingDeletePayload,
  type PendingDeleteAction,
  type PendingDeletePayload,
  type PlannedMode,
  type Project,
  type ProjectCreateInput,
  type ProjectExport,
  type ProjectPlan,
  type ProjectUpdateInput,
  type TaskPendingDeletePayload,
  type Task,
  type TaskCreateInput,
  type TaskCreateResult,
  type TaskUpdateInput,
  type TaskWrapInput,
  type UndoSubjectType,
} from "@/domain/planner";
import { computeCheckpointPercent } from "@/domain/checkpoints";
import { computeProjectPlan } from "@/domain/scheduler";
import { checkpoints, dependencies, pendingDeleteActions, projects, tasks } from "@/server/db/schema";
import { ActualEndRequiredError, ActualStartRequiredError, BaselineRequiredError, CorruptedProjectError, ValidationError } from "@/server/errors";
import { toCheckpointInsert, toDependencyInsert, toPendingDeleteActionInsert, toTaskInsert } from "@/server/repositories/mappers";
import { projectRepository } from "@/server/repositories/project-repository";
import { cascadeForecastFromSeeds, rebaseForecastTasks } from "@/server/services/forecast-schedule";
import { duplicateProjectSnapshot } from "@/server/services/project-duplication";
import { normalizeStoredTaskStatus } from "@/server/services/task-normalization";

const DELETE_UNDO_WINDOW_MS = 15_000;
let nowOverride: string | null = null;

function now() {
  return nowOverride ?? new Date().toISOString();
}

function createId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function expiresAt(createdAt: string) {
  return new Date(Date.parse(createdAt) + DELETE_UNDO_WINDOW_MS).toISOString();
}

type ProjectSnapshot = NonNullable<Awaited<ReturnType<typeof projectRepository.getProjectSnapshot>>>;

function areTaskForecastFieldsEqual(a: Task, b: Task) {
  return (
    a.plannedMode === b.plannedMode &&
    a.plannedStart === b.plannedStart &&
    a.plannedEnd === b.plannedEnd &&
    a.plannedDurationDays === b.plannedDurationDays
  );
}

function hasForecastPatch(input: TaskUpdateInput) {
  return (
    input.type !== undefined ||
    input.plannedMode !== undefined ||
    input.plannedStart !== undefined ||
    input.plannedEnd !== undefined ||
    input.plannedDurationDays !== undefined
  );
}

function deriveTaskForecastDuration(task: Task) {
  if (task.type === "milestone") {
    return 0;
  }

  if (task.plannedMode === "start_end" && task.plannedStart && task.plannedEnd) {
    return businessDaysInclusive(task.plannedStart, task.plannedEnd);
  }

  return Math.max(task.plannedDurationDays ?? 1, 1);
}

function hasExecutionSignalChange(existing: Task, patch: TaskUpdateInput) {
  const nextPercent = patch.percentComplete ?? existing.percentComplete;
  const nextActualStart = patch.actualStart ?? existing.actualStart;
  const nextActualEnd = patch.actualEnd ?? existing.actualEnd;

  return (
    (patch.actualStart !== undefined && nextActualStart !== null) ||
    (patch.actualEnd !== undefined && nextActualEnd !== null) ||
    nextPercent > 0
  );
}

function ensureBaselineCaptured(project: Project, existing: Task, patch: TaskUpdateInput) {
  if (existing.type === "summary" || project.baselineCapturedAt || !hasExecutionSignalChange(existing, patch)) {
    return;
  }

  throw new BaselineRequiredError();
}

function ensureActualEndForCompletion(existing: Task, patch: TaskUpdateInput) {
  if (existing.type === "summary") {
    return;
  }

  const nextPercent = patch.percentComplete ?? existing.percentComplete;
  const nextActualEnd =
    patch.percentComplete !== undefined && patch.percentComplete < 100 && patch.actualEnd === undefined
      ? null
      : patch.actualEnd ?? existing.actualEnd;

  if (nextPercent >= 100 && !nextActualEnd) {
    throw new ActualEndRequiredError();
  }
}

function ensureActualStartForExecution(existing: Task, patch: TaskUpdateInput) {
  if (existing.type === "summary") {
    return;
  }

  const nextPercent = patch.percentComplete ?? existing.percentComplete;
  const nextActualStart = patch.actualStart ?? existing.actualStart;
  const nextActualEnd =
    patch.percentComplete !== undefined && patch.percentComplete < 100 && patch.actualEnd === undefined
      ? null
      : patch.actualEnd ?? existing.actualEnd;

  if ((nextPercent > 0 || nextActualEnd) && !nextActualStart) {
    throw new ActualStartRequiredError();
  }
}

async function persistForecastChanges(projectId: string, tasks: Task[]) {
  const snapshot = await projectRepository.getProjectSnapshot(projectId);

  if (!snapshot) {
    throw new ValidationError("Project not found.");
  }

  const previousById = new Map(snapshot.tasks.map((task) => [task.id, task]));
  const updatedAt = now();

  for (const task of tasks) {
    const previous = previousById.get(task.id);

    if (!previous) {
      continue;
    }

    if (areTaskForecastFieldsEqual(previous, task)) {
      continue;
    }

    await projectRepository.updateTask(task.id, {
      plannedMode: task.plannedMode,
      plannedStart: task.plannedStart,
      plannedEnd: task.plannedEnd,
      plannedDurationDays: task.plannedDurationDays,
      updatedAt,
    });
  }

  await projectRepository.updateProject(projectId, { updatedAt });
}

async function cascadeProjectForecast(projectId: string, seedTaskIds: string[], includeSeeds = false) {
  const snapshot = await projectRepository.getProjectSnapshot(projectId);

  if (!snapshot) {
    throw new ValidationError("Project not found.");
  }

  const nextTasks = cascadeForecastFromSeeds(snapshot, seedTaskIds, { includeSeeds });
  await persistForecastChanges(projectId, nextTasks);
}

function exportDate(value: string | null) {
  return value ?? "TBD";
}

function exportTaskType(task: ProjectPlan["tasks"][number]) {
  return task.isSummary ? "section" : task.type;
}

function exportTaskStatus(task: ProjectPlan["tasks"][number]) {
  return task.rolledUpStatus;
}

function exportTaskProgress(task: ProjectPlan["tasks"][number]) {
  return task.isSummary ? task.rolledUpPercentComplete : task.percentComplete;
}

function exportTaskCurrentDates(task: ProjectPlan["tasks"][number]) {
  const actualStart = task.computedActualStart;
  const actualEnd = task.computedActualEnd;
  const forecastStart = task.computedPlannedStart;
  const forecastEnd = task.computedPlannedEnd;

  if (actualStart && actualEnd) {
    return {
      start: actualStart,
      end: actualEnd,
      mode: "actual" as const,
    };
  }

  if (actualStart) {
    return {
      start: actualStart,
      end: forecastEnd,
      mode: "actual_start_forecast_end" as const,
    };
  }

  return {
    start: forecastStart,
    end: forecastEnd,
    mode: "forecast" as const,
  };
}

function signedBusinessDayGap(from: string, to: string) {
  if (from === to) {
    return 0;
  }

  if (to > from) {
    let cursor = from;
    let offset = 0;

    while (cursor < to) {
      cursor = shiftBusinessDays(cursor, 1);
      offset += 1;
    }

    return offset;
  }

  let cursor = from;
  let offset = 0;

  while (cursor > to) {
    cursor = shiftBusinessDays(cursor, -1);
    offset -= 1;
  }

  return offset;
}

function exportBaselineVariance(task: ProjectPlan["tasks"][number]) {
  const current = exportTaskCurrentDates(task);
  const baselineEnd = task.computedBaselinePlannedEnd;

  if (!current.end || !baselineEnd) {
    return "n/a";
  }

  const delta = signedBusinessDayGap(baselineEnd, current.end);

  if (delta === 0) {
    return "on baseline";
  }

  return delta > 0 ? `+${delta} business days after baseline` : `${Math.abs(delta)} business days before baseline`;
}

function exportMarkdown(plan: ProjectPlan) {
  const taskMap = new Map(plan.tasks.map((task) => [task.id, task]));
  const blockedTasks = plan.blockedTaskIds
    .map((id) => taskMap.get(id))
    .filter((task): task is NonNullable<typeof task> => Boolean(task));
  const upcomingTasks = plan.upcomingTaskIds
    .map((id) => taskMap.get(id))
    .filter((task): task is NonNullable<typeof task> => Boolean(task));
  const tasksByStatus = {
    done: plan.tasks.filter((task) => task.rolledUpStatus === "done").length,
    inProgress: plan.tasks.filter((task) => task.rolledUpStatus === "in_progress").length,
    notStarted: plan.tasks.filter((task) => task.rolledUpStatus === "not_started").length,
  };
  const lines = [
    `# ${plan.project.name}`,
    "",
    plan.project.description || "_No description_",
    "",
    "## Current Project Status",
    `- Progress: ${plan.projectPercentComplete}% complete`,
    `- Forecast timeline: ${exportDate(plan.timelineStart)} -> ${exportDate(plan.timelineEnd)}`,
    `- Baseline: ${plan.project.baselineCapturedAt ? `captured ${plan.project.baselineCapturedAt}` : "not frozen"}`,
    `- Tasks: ${tasksByStatus.inProgress} in progress, ${tasksByStatus.notStarted} not started, ${tasksByStatus.done} done`,
    `- Upcoming work: ${upcomingTasks.length}`,
    `- Blocked or risky tasks: ${blockedTasks.length}`,
    "",
    "## Blocked Or Risky Work",
    ...(blockedTasks.length > 0
      ? blockedTasks.map((task) => {
          const current = exportTaskCurrentDates(task);

          return `- ${task.name} | status ${exportTaskStatus(task)} | progress ${exportTaskProgress(task)}% | current ${exportDate(current.start)} -> ${exportDate(current.end)} | issues ${(task.issues ?? []).map((issue) => issue.message).join("; ") || "Blocked or invalid schedule state"}`;
        })
      : ["- None"]),
    "",
    "## Active Dependencies",
    ...(plan.dependencies.length > 0
      ? plan.dependencies.map(
          (dependency) =>
            `- ${taskMap.get(dependency.predecessorTaskId)?.name ?? dependency.predecessorTaskId} ${dependency.type} ${taskMap.get(dependency.successorTaskId)?.name ?? dependency.successorTaskId} (lag ${dependency.lagDays})`,
        )
      : ["- None"]),
    "",
    "## Task Hierarchy",
  ];

  for (const row of plan.rows) {
    const task = taskMap.get(row.taskId);

    if (!task) {
      continue;
    }

    const prefix = `${"  ".repeat(row.depth)}-`;
    const current = exportTaskCurrentDates(task);
    const dependencyCounts = `${task.blockedBy.length} blocked by / ${task.blocking.length} blocking`;

    lines.push(
      `${prefix} ${task.name} | type ${exportTaskType(task)} | status ${exportTaskStatus(task)} | progress ${exportTaskProgress(task)}% | current ${exportDate(current.start)} -> ${exportDate(current.end)} (${current.mode}) | forecast ${exportDate(task.computedPlannedStart)} -> ${exportDate(task.computedPlannedEnd)} | baseline ${exportDate(task.computedBaselinePlannedStart)} -> ${exportDate(task.computedBaselinePlannedEnd)} | actual ${exportDate(task.computedActualStart)} -> ${exportDate(task.computedActualEnd)} | variance vs baseline ${exportBaselineVariance(task)} | dependencies ${dependencyCounts}`,
    );

    if (task.issues.length > 0) {
      lines.push(`${"  ".repeat(row.depth + 1)}- issues: ${task.issues.map((issue) => issue.message).join("; ")}`);
    }

    if (task.checkpoints.length > 0) {
      for (const checkpoint of task.checkpoints) {
        lines.push(
          `${"  ".repeat(row.depth + 1)}- checkpoint ${checkpoint.name} | progress ${checkpoint.percentComplete}% | weight ${checkpoint.weightPoints}`,
        );
      }
    }
  }

  return lines.join("\n");
}

export async function listProjects() {
  return projectRepository.listProjects();
}

export async function getProjectPlan(projectId: string) {
  const snapshot = await projectRepository.getProjectSnapshot(projectId, now());

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
    baselineCapturedAt: null,
    createdAt,
    updatedAt: createdAt,
  };

  await projectRepository.insertProject(project);
  return getProjectPlan(project.id);
}

export async function duplicateProject(projectId: string, name?: string, startDate?: string | null) {
  const snapshot = await projectRepository.getProjectSnapshot(projectId);

  if (!snapshot) {
    return null;
  }

  assertProjectTreeIsValid(projectId, snapshot.tasks);
  const createdAt = now();
  const duplicatedSnapshot = duplicateProjectSnapshot(snapshot, {
    projectId: createId("project"),
    now: createdAt,
    createId,
    name: name?.trim() || `${snapshot.project.name} Copy`,
  });
  const duplicated = startDate
    ? {
        ...duplicatedSnapshot,
        tasks: rebaseForecastTasks(duplicatedSnapshot.tasks, startDate),
      }
    : duplicatedSnapshot;

  await projectRepository.insertProject(duplicated.project);
  await projectRepository.insertTasks(duplicated.tasks);
  await projectRepository.insertDependencies(duplicated.dependencies);
  await projectRepository.insertCheckpoints(duplicated.checkpoints);

  return getProjectPlan(duplicated.project.id);
}

export async function rebaseProjectForecast(projectId: string, startDate: string) {
  const snapshot = await projectRepository.getProjectSnapshot(projectId);

  if (!snapshot) {
    return null;
  }

  const nextTasks = rebaseForecastTasks(snapshot.tasks, startDate);
  await persistForecastChanges(projectId, nextTasks);
  return getProjectPlan(projectId);
}

export async function freezeProjectBaseline(projectId: string) {
  const snapshot = await projectRepository.getProjectSnapshot(projectId);

  if (!snapshot) {
    return null;
  }

  const capturedAt = now();

  for (const task of snapshot.tasks) {
    if (task.type === "summary") {
      continue;
    }

    await projectRepository.updateTask(task.id, {
      baselinePlannedStart: task.plannedStart,
      baselinePlannedEnd: task.plannedEnd,
      baselinePlannedDurationDays: task.plannedDurationDays,
      updatedAt: capturedAt,
    });
  }

  await projectRepository.updateProject(projectId, {
    baselineCapturedAt: capturedAt,
    updatedAt: capturedAt,
  });

  return getProjectPlan(projectId);
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

function nextCheckpointSortOrder(checkpoints: Checkpoint[]) {
  return Math.max(0, ...checkpoints.map((checkpoint) => checkpoint.sortOrder)) + 10;
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

function hasChildTasks(tasks: Task[], taskId: string) {
  return tasks.some((task) => task.parentId === taskId);
}

function hasTaskCheckpoints(checkpoints: Checkpoint[], taskId: string) {
  return checkpoints.some((checkpoint) => checkpoint.taskId === taskId);
}

function hasLinkedDependencies(taskId: string, dependencies: DependencyCreateInput[] | DependencyUpdateInput[] | { predecessorTaskId: string; successorTaskId: string }[]) {
  return dependencies.some(
    (dependency) => dependency.predecessorTaskId === taskId || dependency.successorTaskId === taskId,
  );
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

function sortTasksForInsert(taskList: Task[]) {
  const taskMap = new Map(taskList.map((task) => [task.id, task]));
  const children = buildChildren(taskList);
  const ordered: Task[] = [];

  function visit(task: Task) {
    ordered.push(task);

    for (const childId of (children.get(task.id) ?? []).sort((leftId, rightId) => {
      const left = taskMap.get(leftId);
      const right = taskMap.get(rightId);
      return (
        (left?.sortOrder ?? 0) - (right?.sortOrder ?? 0) ||
        (left?.name ?? leftId).localeCompare(right?.name ?? rightId)
      );
    })) {
      const child = taskMap.get(childId);

      if (child) {
        visit(child);
      }
    }
  }

  for (const task of taskList
    .filter((item) => item.parentId === null || !taskMap.has(item.parentId))
    .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name))) {
    visit(task);
  }

  return ordered;
}

function subjectTypeForTask(task: Task): UndoSubjectType {
  if (task.type === "summary") {
    return "section";
  }

  return task.type;
}

function buildTaskPendingDeletePayload(taskId: string, snapshot: ProjectSnapshot): TaskPendingDeletePayload {
  const deletedIds = new Set<string>([taskId, ...collectDescendantIds(taskId, snapshot.tasks)]);

  return {
    kind: "task",
    rootTaskId: taskId,
    tasks: sortTasksForInsert(snapshot.tasks.filter((task) => deletedIds.has(task.id))),
    dependencies: snapshot.dependencies.filter(
      (dependency) => deletedIds.has(dependency.predecessorTaskId) || deletedIds.has(dependency.successorTaskId),
    ),
    checkpoints: snapshot.checkpoints.filter((checkpoint) => deletedIds.has(checkpoint.taskId)),
  };
}

function buildCheckpointPendingDeletePayload(checkpoint: Checkpoint) {
  return {
    kind: "checkpoint" as const,
    checkpoint,
  };
}

function buildDependencyPendingDeletePayload(dependency: Dependency): DependencyPendingDeletePayload {
  return {
    kind: "dependency",
    dependency,
  };
}

function buildPendingDeleteAction(
  projectId: string,
  kind: PendingDeleteAction["kind"],
  subjectType: UndoSubjectType,
  subjectLabel: string,
  payload: PendingDeletePayload,
): PendingDeleteAction {
  const createdAt = now();

  return {
    id: createId("undo"),
    projectId,
    kind,
    subjectType,
    subjectLabel,
    createdAt,
    expiresAt: expiresAt(createdAt),
    payload,
  };
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

function requireSnapshot(snapshot: Awaited<ReturnType<typeof projectRepository.getProjectSnapshot>>) {
  if (!snapshot) {
    throw new ValidationError("Project not found.");
  }

  return snapshot;
}

function requireTaskInPayload(payload: TaskPendingDeletePayload, taskId: string) {
  const task = payload.tasks.find((item) => item.id === taskId);

  if (!task) {
    throw new ValidationError("Undo payload is missing the deleted task.");
  }

  return task;
}

async function restoreTaskPendingDeleteAction(action: PendingDeleteAction) {
  if (action.payload.kind !== "task") {
    throw new ValidationError("Undo payload did not match the deleted task action.");
  }

  const payload = action.payload;
  const snapshot = await projectRepository.getProjectSnapshot(action.projectId);

  if (!snapshot) {
    throw new ValidationError("Project not found.");
  }

  const deletedIds = new Set(payload.tasks.map((task) => task.id));
  const existingTaskIds = new Set(snapshot.tasks.map((task) => task.id));
  const rootTask = requireTaskInPayload(payload, payload.rootTaskId);

  if (payload.tasks.some((task) => existingTaskIds.has(task.id))) {
    throw new ValidationError("One or more deleted tasks already exist and cannot be restored.");
  }

  if (rootTask.parentId && !deletedIds.has(rootTask.parentId) && !existingTaskIds.has(rootTask.parentId)) {
    throw new ValidationError("The original parent section no longer exists, so this delete cannot be undone.");
  }

  for (const dependency of payload.dependencies) {
    if (!deletedIds.has(dependency.predecessorTaskId) && !existingTaskIds.has(dependency.predecessorTaskId)) {
      throw new ValidationError("A linked dependency predecessor no longer exists, so this delete cannot be undone.");
    }

    if (!deletedIds.has(dependency.successorTaskId) && !existingTaskIds.has(dependency.successorTaskId)) {
      throw new ValidationError("A linked dependency successor no longer exists, so this delete cannot be undone.");
    }
  }

  const restoredAt = now();

  await projectRepository.withTransaction(async (tx) => {
    await tx.insert(tasks).values(payload.tasks.map(toTaskInsert));

    if (payload.checkpoints.length > 0) {
      await tx.insert(checkpoints).values(payload.checkpoints.map(toCheckpointInsert));
    }

    if (payload.dependencies.length > 0) {
      await tx.insert(dependencies).values(payload.dependencies.map(toDependencyInsert));
    }

    await tx.delete(pendingDeleteActions).where(eq(pendingDeleteActions.id, action.id));
    await tx
      .update(projects)
      .set({ updatedAt: restoredAt })
      .where(eq(projects.id, action.projectId));
  });
}

async function restoreCheckpointPendingDeleteAction(action: PendingDeleteAction) {
  if (action.payload.kind !== "checkpoint") {
    throw new ValidationError("Undo payload did not match the deleted checkpoint action.");
  }

  const payload = action.payload;
  const task = await projectRepository.getTask(payload.checkpoint.taskId);

  if (!task || task.type !== "task") {
    throw new ValidationError("The checkpoint task no longer exists, so this delete cannot be undone.");
  }

  const existing = await projectRepository.getCheckpoint(payload.checkpoint.id);

  if (existing) {
    throw new ValidationError("This checkpoint already exists and cannot be restored.");
  }

  const restoredAt = now();

  await projectRepository.withTransaction(async (tx) => {
    await tx.insert(checkpoints).values(toCheckpointInsert(payload.checkpoint));
    await tx.delete(pendingDeleteActions).where(eq(pendingDeleteActions.id, action.id));
    await tx
      .update(projects)
      .set({ updatedAt: restoredAt })
      .where(eq(projects.id, action.projectId));
  });

  await syncTaskProgressFromCheckpoints(payload.checkpoint.taskId);
}

async function restoreDependencyPendingDeleteAction(action: PendingDeleteAction) {
  if (action.payload.kind !== "dependency") {
    throw new ValidationError("Undo payload did not match the deleted dependency action.");
  }

  const payload = action.payload;
  const existing = await projectRepository.getDependency(payload.dependency.id);

  if (existing) {
    throw new ValidationError("This dependency already exists and cannot be restored.");
  }

  await validateDependency(payload.dependency.projectId, payload.dependency);
  const restoredAt = now();

  await projectRepository.withTransaction(async (tx) => {
    await tx.insert(dependencies).values(toDependencyInsert(payload.dependency));
    await tx.delete(pendingDeleteActions).where(eq(pendingDeleteActions.id, action.id));
    await tx
      .update(projects)
      .set({ updatedAt: restoredAt })
      .where(eq(projects.id, action.projectId));
  });

  await cascadeProjectForecast(payload.dependency.projectId, [payload.dependency.successorTaskId], true);
}

function deriveTaskProgressFromCheckpoints(task: Task, checkpoints: Checkpoint[]) {
  const percentComplete = computeCheckpointPercent(checkpoints);
  const actualEnd = percentComplete >= 100 ? task.actualEnd : null;
  const status = normalizeStoredTaskStatus({
    type: task.type,
    status: task.status,
    percentComplete,
    actualStart: task.actualStart,
    actualEnd,
  });

  return { percentComplete, status, actualEnd };
}

async function syncTaskProgressFromCheckpoints(taskId: string) {
  const task = await projectRepository.getTask(taskId);

  if (!task || task.type !== "task") {
    return;
  }

  const checkpoints = await projectRepository.listCheckpointsForTask(taskId);

  if (checkpoints.length === 0) {
    return;
  }

  const { percentComplete, status, actualEnd } = deriveTaskProgressFromCheckpoints(task, checkpoints);

  await projectRepository.updateTask(taskId, {
    percentComplete,
    status,
    actualEnd,
    updatedAt: now(),
  });
}

function normalizeTaskPatch(existing: Task, patch: TaskUpdateInput): Partial<Task> {
  const merged = { ...existing, ...patch };
  const normalized: Partial<Task> = { ...patch };

  if (merged.type === "summary") {
    normalized.parentId = merged.parentId ?? null;
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

  const nextType = merged.type;
  const nextActualStart = patch.actualStart ?? existing.actualStart;
  const nextActualEnd =
    patch.percentComplete !== undefined && patch.percentComplete < 100 && patch.actualEnd === undefined
      ? null
      : patch.actualEnd ?? existing.actualEnd;

  if (patch.percentComplete !== undefined && patch.percentComplete < 100 && patch.actualEnd === undefined) {
    normalized.actualEnd = null;
  }

  if (nextType !== "summary" && patch.actualStart !== undefined && nextActualStart) {
    normalized.plannedStart = nextActualStart;

    if (!hasForecastPatch(patch)) {
      if (nextType === "milestone") {
        normalized.plannedMode = "start_duration";
        normalized.plannedEnd = null;
        normalized.plannedDurationDays = 0;
      } else if (existing.plannedMode === "start_end" && existing.plannedStart && existing.plannedEnd) {
        const originalDurationDays = Math.max(deriveTaskForecastDuration(existing), 1);
        normalized.plannedMode = "start_end";
        normalized.plannedEnd = addDurationToStart(clampToBusinessDay(nextActualStart), originalDurationDays);
        normalized.plannedDurationDays = originalDurationDays;
      } else {
        normalized.plannedMode = "start_duration";
        normalized.plannedEnd = null;
        normalized.plannedDurationDays = Math.max(deriveTaskForecastDuration(existing), 1);
      }
    }
  }

  if (nextType !== "summary" && nextActualEnd) {
    normalized.percentComplete = 100;

    if (!nextActualStart) {
      normalized.actualStart = existing.actualStart ?? existing.plannedStart ?? nextActualEnd;
    }
  }

  const normalizedTask = { ...merged, ...normalized };
  if (normalizedTask.type !== "summary") {
    const normalizedStatus = normalizeStoredTaskStatus(normalizedTask);
    if (
      normalizedStatus !== normalizedTask.status ||
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

  const normalizedParentId = parsed.parentId ?? null;
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
    baselinePlannedStart: null,
    baselinePlannedEnd: null,
    baselinePlannedDurationDays: null,
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

  const snapshot = await projectRepository.getProjectSnapshot(existing.projectId);

  if (!snapshot) {
    throw new ValidationError("Project not found.");
  }

  const nextType = parsed.type ?? existing.type;
  const nextParentId = parsed.parentId ?? existing.parentId;
  const taskHasCheckpoints = hasTaskCheckpoints(snapshot.checkpoints, existing.id);

  if (existing.type === "summary" && nextType !== "summary" && hasChildTasks(snapshot.tasks, existing.id)) {
    throw new ValidationError("Summary sections with children cannot be converted to leaf tasks.");
  }

  if (taskHasCheckpoints && nextType !== "task") {
    throw new ValidationError("Tasks with checkpoints must remain tasks until their checkpoints are removed.");
  }

  if (existing.type !== "summary" && nextType === "summary" && hasLinkedDependencies(existing.id, snapshot.dependencies)) {
    throw new ValidationError("Tasks with dependencies cannot be converted directly to sections. Wrap the task in a section instead.");
  }

  if (taskHasCheckpoints && parsed.percentComplete !== undefined) {
    throw new ValidationError("Tasks with checkpoints derive percent complete from their checkpoints.");
  }

  ensureBaselineCaptured(snapshot.project, existing, parsed);
  ensureActualStartForExecution(existing, parsed);
  ensureActualEndForCompletion(existing, parsed);
  validateTaskParent(snapshot.tasks, existing.id, nextParentId);
  const normalized = normalizeTaskPatch(existing, parsed);
  await projectRepository.updateTask(taskId, { ...normalized, updatedAt: now() });
  const nextTask = { ...existing, ...normalized };

  if (nextTask.type !== "summary" && (hasForecastPatch(parsed) || parsed.actualStart !== undefined || parsed.actualEnd !== undefined)) {
    await cascadeProjectForecast(existing.projectId, [taskId]);
  }

  return getProjectPlan(existing.projectId);
}

export async function deleteTask(taskId: string) {
  const task = await projectRepository.getTask(taskId);

  if (!task) {
    return null;
  }

  await projectRepository.purgeExpiredPendingDeleteActions(task.projectId, now());
  const snapshot = requireSnapshot(await projectRepository.getProjectSnapshot(task.projectId));
  const payload = buildTaskPendingDeletePayload(taskId, snapshot);
  const action = buildPendingDeleteAction(
    task.projectId,
    "task",
    subjectTypeForTask(task),
    task.name,
    payload,
  );
  const deletedIds = payload.tasks.map((item) => item.id);
  const deletedAt = now();

  await projectRepository.withTransaction(async (tx) => {
    await tx.insert(pendingDeleteActions).values(toPendingDeleteActionInsert(action));
    await tx
      .delete(dependencies)
      .where(
        and(
          eq(dependencies.projectId, task.projectId),
          or(
            inArray(dependencies.predecessorTaskId, deletedIds),
            inArray(dependencies.successorTaskId, deletedIds),
          ),
        ),
      );
    await tx.delete(tasks).where(inArray(tasks.id, deletedIds));
    await tx
      .update(projects)
      .set({ updatedAt: deletedAt })
      .where(eq(projects.id, task.projectId));
  });

  return getProjectPlan(task.projectId);
}

export async function wrapTaskInSection(taskId: string, input: TaskWrapInput = {}) {
  const parsed = taskWrapSchema.parse(input);
  const existing = await projectRepository.getTask(taskId);

  if (!existing) {
    return null;
  }

  if (existing.type === "summary") {
    throw new ValidationError("Only leaf tasks can be wrapped in a section.");
  }

  const snapshot = await projectRepository.getProjectSnapshot(existing.projectId);

  if (!snapshot) {
    throw new ValidationError("Project not found.");
  }

  const createdAt = now();
  const childName = parsed.childName?.trim() || "Execution";
  const section: Task = {
    id: createId("task"),
    projectId: existing.projectId,
    parentId: existing.parentId,
    name: existing.name,
    notes: "",
    sortOrder: existing.sortOrder,
    type: "summary",
    plannedMode: null,
    plannedStart: null,
    plannedEnd: null,
    plannedDurationDays: null,
    baselinePlannedStart: null,
    baselinePlannedEnd: null,
    baselinePlannedDurationDays: null,
    actualStart: null,
    actualEnd: null,
    status: "not_started",
    percentComplete: 0,
    isExpanded: true,
    createdAt,
    updatedAt: createdAt,
  };

  await projectRepository.createTask(section);
  await projectRepository.updateTask(existing.id, {
    parentId: section.id,
    name: childName,
    sortOrder: 10,
    updatedAt: createdAt,
  });

  return getProjectPlan(existing.projectId);
}

export async function createCheckpoint(taskId: string, input: CheckpointCreateInput) {
  const parsed = checkpointCreateSchema.parse(input);
  const task = await projectRepository.getTask(taskId);

  if (!task) {
    return null;
  }

  if (task.type !== "task") {
    throw new ValidationError("Checkpoints can only be added to tasks.");
  }

  if (input.percentComplete !== undefined && input.percentComplete > 0) {
    const project = await projectRepository.getProject(task.projectId);

    if (!project?.baselineCapturedAt) {
      throw new BaselineRequiredError();
    }
  }

  const existingCheckpoints = await projectRepository.listCheckpointsForTask(taskId);
  const nextTaskPercent = computeCheckpointPercent([
    ...existingCheckpoints,
    {
      percentComplete: parsed.percentComplete,
      weightPoints: parsed.weightPoints,
    },
  ]);

  if (nextTaskPercent > 0 && !task.actualStart) {
    throw new ActualStartRequiredError();
  }

  if (nextTaskPercent >= 100 && !task.actualEnd) {
    throw new ActualEndRequiredError();
  }
  const createdAt = now();

  await projectRepository.createCheckpoint({
    id: createId("checkpoint"),
    taskId,
    name: parsed.name,
    percentComplete: parsed.percentComplete,
    weightPoints: parsed.weightPoints,
    sortOrder: nextCheckpointSortOrder(existingCheckpoints),
    createdAt,
    updatedAt: createdAt,
  });

  await syncTaskProgressFromCheckpoints(taskId);
  return getProjectPlan(task.projectId);
}

export async function updateCheckpoint(checkpointId: string, input: CheckpointUpdateInput) {
  const parsed = checkpointUpdateSchema.parse(input);
  const checkpoint = await projectRepository.getCheckpoint(checkpointId);

  if (!checkpoint) {
    return null;
  }

  const task = await projectRepository.getTask(checkpoint.taskId);

  if (!task) {
    throw new ValidationError("Checkpoint task was not found.");
  }

  if (task.type !== "task") {
    throw new ValidationError("Checkpoints can only belong to tasks.");
  }

  const project = await projectRepository.getProject(task.projectId);
  const nextCheckpointPercent = input.percentComplete ?? checkpoint.percentComplete;

  if (nextCheckpointPercent > 0 && !project?.baselineCapturedAt) {
    throw new BaselineRequiredError();
  }

  const existingCheckpoints = await projectRepository.listCheckpointsForTask(checkpoint.taskId);
  const nextCheckpoints = existingCheckpoints.map((item) =>
    item.id === checkpoint.id
      ? {
          ...item,
          percentComplete: input.percentComplete ?? item.percentComplete,
          weightPoints: input.weightPoints ?? item.weightPoints,
        }
      : item,
  );
  const nextTaskPercent = computeCheckpointPercent(nextCheckpoints);

  if (nextTaskPercent > 0 && !task.actualStart) {
    throw new ActualStartRequiredError();
  }

  if (nextTaskPercent >= 100 && !task.actualEnd) {
    throw new ActualEndRequiredError();
  }

  await projectRepository.updateCheckpoint(checkpointId, { ...parsed, updatedAt: now() });
  await syncTaskProgressFromCheckpoints(checkpoint.taskId);
  return getProjectPlan(task.projectId);
}

export async function deleteCheckpoint(checkpointId: string) {
  const checkpoint = await projectRepository.getCheckpoint(checkpointId);

  if (!checkpoint) {
    return null;
  }

  const task = await projectRepository.getTask(checkpoint.taskId);

  if (!task) {
    throw new ValidationError("Checkpoint task was not found.");
  }

  await projectRepository.purgeExpiredPendingDeleteActions(task.projectId, now());
  const taskId = checkpoint.taskId;
  const deletedAt = now();
  const action = buildPendingDeleteAction(
    task.projectId,
    "checkpoint",
    "checkpoint",
    checkpoint.name,
    buildCheckpointPendingDeletePayload(checkpoint),
  );

  await projectRepository.withTransaction(async (tx) => {
    await tx.insert(pendingDeleteActions).values(toPendingDeleteActionInsert(action));
    await tx.delete(checkpoints).where(eq(checkpoints.id, checkpointId));
    await tx
      .update(projects)
      .set({ updatedAt: deletedAt })
      .where(eq(projects.id, task.projectId));
  });

  await syncTaskProgressFromCheckpoints(taskId);
  return getProjectPlan(task.projectId);
}

export async function moveCheckpoint(checkpointId: string, input: CheckpointMoveInput) {
  const parsed = checkpointMoveSchema.parse(input);
  const checkpoint = await projectRepository.getCheckpoint(checkpointId);

  if (!checkpoint) {
    return null;
  }

  const task = await projectRepository.getTask(checkpoint.taskId);

  if (!task) {
    throw new ValidationError("Checkpoint task was not found.");
  }

  const checkpoints = await projectRepository.listCheckpointsForTask(checkpoint.taskId);
  const currentIndex = checkpoints.findIndex((item) => item.id === checkpointId);

  if (currentIndex === -1) {
    return getProjectPlan(task.projectId);
  }

  const swapIndex = parsed.direction === "up" ? currentIndex - 1 : currentIndex + 1;

  if (swapIndex < 0 || swapIndex >= checkpoints.length) {
    return getProjectPlan(task.projectId);
  }

  const neighbor = checkpoints[swapIndex];
  const updatedAt = now();

  await projectRepository.updateCheckpoint(checkpointId, {
    sortOrder: neighbor.sortOrder,
    updatedAt,
  });
  await projectRepository.updateCheckpoint(neighbor.id, {
    sortOrder: checkpoint.sortOrder,
    updatedAt,
  });

  return getProjectPlan(task.projectId);
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

  await cascadeProjectForecast(projectId, [parsed.successorTaskId], true);
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
  await cascadeProjectForecast(dependency.projectId, [merged.successorTaskId], true);
  return getProjectPlan(dependency.projectId);
}

export async function deleteDependency(dependencyId: string) {
  const dependency = await projectRepository.getDependency(dependencyId);
  const deletedAt = now();

  if (dependency) {
    await projectRepository.purgeExpiredPendingDeleteActions(dependency.projectId, deletedAt);
    const action = buildPendingDeleteAction(
      dependency.projectId,
      "dependency",
      "dependency",
      `${dependency.predecessorTaskId} -> ${dependency.successorTaskId}`,
      buildDependencyPendingDeletePayload(dependency),
    );

    await projectRepository.withTransaction(async (tx) => {
      await tx.insert(pendingDeleteActions).values(toPendingDeleteActionInsert(action));
      await tx.delete(dependencies).where(eq(dependencies.id, dependencyId));
      await tx
        .update(projects)
        .set({ updatedAt: deletedAt })
        .where(eq(projects.id, dependency.projectId));
    });
  }

  if (dependency) {
    await cascadeProjectForecast(dependency.projectId, [dependency.successorTaskId], true);
  }

  return dependency ? getProjectPlan(dependency.projectId) : null;
}

export async function undoPendingDeleteAction(actionId: string) {
  const action = await projectRepository.getPendingDeleteAction(actionId);

  if (!action) {
    return null;
  }

  if (action.expiresAt <= now()) {
    await projectRepository.deletePendingDeleteAction(actionId);
    throw new ValidationError("This undo action has expired.");
  }

  switch (action.kind) {
    case "task":
      await restoreTaskPendingDeleteAction(action);
      break;
    case "checkpoint":
      await restoreCheckpointPendingDeleteAction(action);
      break;
    case "dependency":
      await restoreDependencyPendingDeleteAction(action);
      break;
  }

  return getProjectPlan(action.projectId);
}

export async function exportProject(projectId: string): Promise<ProjectExport | null> {
  const plan = await getProjectPlan(projectId);

  if (!plan) {
    return null;
  }

  const generatedAt = now();

  return {
    json: {
      exportVersion: 2,
      generatedAt,
      project: plan.project,
      timeline: {
        start: plan.timelineStart,
        end: plan.timelineEnd,
      },
      projectPercentComplete: plan.projectPercentComplete,
      issues: plan.issues,
      tasks: plan.tasks,
      dependencies: plan.dependencies,
      rows: plan.rows,
      blockedTaskIds: plan.blockedTaskIds,
      upcomingTaskIds: plan.upcomingTaskIds,
      pendingUndoActions: plan.pendingUndoActions,
    },
    markdown: exportMarkdown(plan),
  };
}

export const __testUtils = {
  buildTaskDates,
  collectProjectTreeIssues,
  hasChildTasks,
  normalizeTaskPatch,
  setNowOverride(value: string | null) {
    nowOverride = value;
  },
  validateTaskParent,
};
