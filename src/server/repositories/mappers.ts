import type { Checkpoint, Dependency, PendingDeleteAction, Project, Task } from "@/domain/planner";
import type {
  CheckpointInsert,
  CheckpointRow,
  DependencyInsert,
  DependencyRow,
  PendingDeleteActionInsert,
  PendingDeleteActionRow,
  ProjectInsert,
  ProjectRow,
  TaskInsert,
  TaskRow,
} from "@/server/db/schema";

export function mapProjectRow(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    baselineCapturedAt: row.baselineCapturedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function mapTaskRow(row: TaskRow): Task {
  return {
    id: row.id,
    projectId: row.projectId,
    parentId: row.parentId,
    name: row.name,
    notes: row.notes,
    sortOrder: row.sortOrder,
    type: row.type as Task["type"],
    plannedMode: (row.plannedMode as Task["plannedMode"]) ?? null,
    plannedStart: row.plannedStart,
    plannedEnd: row.plannedEnd,
    plannedDurationDays: row.plannedDurationDays,
    baselinePlannedStart: row.baselinePlannedStart,
    baselinePlannedEnd: row.baselinePlannedEnd,
    baselinePlannedDurationDays: row.baselinePlannedDurationDays,
    actualStart: row.actualStart,
    actualEnd: row.actualEnd,
    status: row.status as Task["status"],
    percentComplete: row.percentComplete,
    isExpanded: row.isExpanded,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function mapDependencyRow(row: DependencyRow): Dependency {
  return {
    id: row.id,
    projectId: row.projectId,
    predecessorTaskId: row.predecessorTaskId,
    successorTaskId: row.successorTaskId,
    type: row.type as Dependency["type"],
    lagDays: row.lagDays,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function mapCheckpointRow(row: CheckpointRow): Checkpoint {
  return {
    id: row.id,
    taskId: row.taskId,
    name: row.name,
    percentComplete: row.percentComplete,
    weightPoints: row.weightPoints,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function mapPendingDeleteActionRow(row: PendingDeleteActionRow): PendingDeleteAction {
  return {
    id: row.id,
    projectId: row.projectId,
    kind: row.kind as PendingDeleteAction["kind"],
    subjectType: row.subjectType as PendingDeleteAction["subjectType"],
    subjectLabel: row.subjectLabel,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    payload: JSON.parse(row.payloadJson) as PendingDeleteAction["payload"],
  };
}

export function toProjectInsert(project: Project): ProjectInsert {
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    baselineCapturedAt: project.baselineCapturedAt,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}

export function toTaskInsert(task: Task): TaskInsert {
  return {
    id: task.id,
    projectId: task.projectId,
    parentId: task.parentId,
    name: task.name,
    notes: task.notes,
    sortOrder: task.sortOrder,
    type: task.type,
    plannedMode: task.plannedMode,
    plannedStart: task.plannedStart,
    plannedEnd: task.plannedEnd,
    plannedDurationDays: task.plannedDurationDays,
    baselinePlannedStart: task.baselinePlannedStart,
    baselinePlannedEnd: task.baselinePlannedEnd,
    baselinePlannedDurationDays: task.baselinePlannedDurationDays,
    actualStart: task.actualStart,
    actualEnd: task.actualEnd,
    status: task.status,
    percentComplete: task.percentComplete,
    isExpanded: task.isExpanded,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

export function toDependencyInsert(dependency: Dependency): DependencyInsert {
  return {
    id: dependency.id,
    projectId: dependency.projectId,
    predecessorTaskId: dependency.predecessorTaskId,
    successorTaskId: dependency.successorTaskId,
    type: dependency.type,
    lagDays: dependency.lagDays,
    createdAt: dependency.createdAt,
    updatedAt: dependency.updatedAt,
  };
}

export function toCheckpointInsert(checkpoint: Checkpoint): CheckpointInsert {
  return {
    id: checkpoint.id,
    taskId: checkpoint.taskId,
    name: checkpoint.name,
    percentComplete: checkpoint.percentComplete,
    weightPoints: checkpoint.weightPoints,
    sortOrder: checkpoint.sortOrder,
    createdAt: checkpoint.createdAt,
    updatedAt: checkpoint.updatedAt,
  };
}

export function toPendingDeleteActionInsert(action: PendingDeleteAction): PendingDeleteActionInsert {
  return {
    id: action.id,
    projectId: action.projectId,
    kind: action.kind,
    subjectType: action.subjectType,
    subjectLabel: action.subjectLabel,
    payloadJson: JSON.stringify(action.payload),
    createdAt: action.createdAt,
    expiresAt: action.expiresAt,
  };
}
