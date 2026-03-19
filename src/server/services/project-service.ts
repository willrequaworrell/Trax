import { projectCreateSchema, projectUpdateSchema, taskCreateSchema, taskUpdateSchema, dependencyCreateSchema, dependencyUpdateSchema, type DependencyCreateInput, type DependencyUpdateInput, type Project, type ProjectCreateInput, type ProjectExport, type ProjectPlan, type ProjectUpdateInput, type Task, type TaskCreateInput, type TaskCreateResult, type TaskUpdateInput } from "@/domain/planner";
import { computeProjectPlan } from "@/domain/scheduler";
import { projectRepository } from "@/server/repositories/project-repository";
import { duplicateProjectSnapshot } from "@/server/services/project-duplication";
import { findTaskNormalizationUpdates, normalizeStoredTaskStatus } from "@/server/services/task-normalization";

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

  return computeProjectPlan(snapshot);
}

async function normalizeProjectTasks(projectId: string) {
  const snapshot = await projectRepository.getProjectSnapshot(projectId);

  if (!snapshot) {
    return;
  }

  const updates = findTaskNormalizationUpdates(snapshot.tasks);

  for (const update of updates) {
    await projectRepository.updateTask(update.id, {
      ...update.values,
      updatedAt: now(),
    });
  }
}

async function getNormalizedProjectPlan(projectId: string) {
  await normalizeProjectTasks(projectId);
  return getProjectPlan(projectId);
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
  return getNormalizedProjectPlan(project.id);
}

export async function duplicateProject(projectId: string, name?: string) {
  const snapshot = await projectRepository.getProjectSnapshot(projectId);

  if (!snapshot) {
    return null;
  }

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

  return getNormalizedProjectPlan(duplicated.project.id);
}

export async function updateProject(projectId: string, input: ProjectUpdateInput) {
  const parsed = projectUpdateSchema.parse(input);
  await projectRepository.updateProject(projectId, { ...parsed, updatedAt: now() });
  return getNormalizedProjectPlan(projectId);
}

export async function deleteProject(projectId: string) {
  await projectRepository.deleteProject(projectId);
}

function nextSortOrder(siblings: Task[]) {
  return Math.max(0, ...siblings.map((task) => task.sortOrder)) + 10;
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
    normalized.percentComplete = merged.percentComplete;
    return normalized;
  }

  if (merged.type === "milestone") {
    normalized.plannedDurationDays = 0;
    normalized.plannedMode = "start_duration";
    if (merged.plannedStart) {
      normalized.plannedEnd = null;
    }
    return normalized;
  }

  if ((patch.plannedStart !== undefined && patch.plannedEnd !== undefined) || merged.plannedMode === "start_end") {
    normalized.plannedMode = "start_end";
    if (merged.plannedStart && merged.plannedEnd) {
      normalized.plannedDurationDays = Math.max(1, merged.plannedDurationDays ?? 1);
    }
    return normalized;
  }

  if (patch.plannedDurationDays !== undefined || patch.plannedStart !== undefined) {
    normalized.plannedMode = "start_duration";
    normalized.plannedEnd = null;
  }

  const normalizedStatus = normalizeStoredTaskStatus(merged);
  if (
    normalizedStatus !== merged.status ||
    patch.status !== undefined ||
    patch.percentComplete !== undefined ||
    patch.actualStart !== undefined ||
    patch.actualEnd !== undefined
  ) {
    normalized.status = normalizedStatus;
  }

  return normalized;
}

export async function createTask(projectId: string, input: TaskCreateInput): Promise<TaskCreateResult | null> {
  const parsed = taskCreateSchema.parse(input);
  const snapshot = await projectRepository.getProjectSnapshot(projectId);

  if (!snapshot) {
    return null;
  }

  const normalizedParentId = parsed.type === "summary" ? null : parsed.parentId ?? null;
  const siblings = snapshot.tasks.filter((task) => task.parentId === normalizedParentId);
  const createdAt = now();
  const task: Task = {
    id: createId("task"),
    projectId,
    parentId: normalizedParentId,
    name: parsed.name,
    notes: parsed.notes ?? "",
    sortOrder: nextSortOrder(siblings),
    type: parsed.type,
    plannedMode: parsed.type === "summary" ? null : "start_duration",
    plannedStart: parsed.type === "summary" ? null : parsed.plannedStart ?? new Date().toISOString().slice(0, 10),
    plannedEnd: null,
    plannedDurationDays:
      parsed.type === "summary" ? null : parsed.type === "milestone" ? 0 : parsed.plannedDurationDays ?? 1,
    actualStart: null,
    actualEnd: null,
    status: "not_started",
    percentComplete: 0,
    isExpanded: true,
    createdAt,
    updatedAt: createdAt,
  };

  await projectRepository.createTask(task);
  const plan = await getNormalizedProjectPlan(projectId);
  return plan ? { plan, taskId: task.id } : null;
}

export async function updateTask(taskId: string, input: TaskUpdateInput) {
  const parsed = taskUpdateSchema.parse(input);
  const existing = await projectRepository.getTask(taskId);

  if (!existing) {
    return null;
  }

  const normalized = normalizeTaskPatch(existing, parsed);
  await projectRepository.updateTask(taskId, { ...normalized, updatedAt: now() });
  return getNormalizedProjectPlan(existing.projectId);
}

export async function deleteTask(taskId: string) {
  const projectId = await projectRepository.deleteTask(taskId);
  return projectId ? getNormalizedProjectPlan(projectId) : null;
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

  return getNormalizedProjectPlan(projectId);
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
  return getNormalizedProjectPlan(dependency.projectId);
}

export async function deleteDependency(dependencyId: string) {
  const projectId = await projectRepository.deleteDependency(dependencyId);
  return projectId ? getNormalizedProjectPlan(projectId) : null;
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
