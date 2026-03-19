import type { Dependency, Project, Task } from "@/domain/planner";
import type { DependencyInsert, DependencyRow, ProjectInsert, ProjectRow, TaskInsert, TaskRow } from "@/server/db/schema";

export function mapProjectRow(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
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

export function toProjectInsert(project: Project): ProjectInsert {
  return {
    id: project.id,
    name: project.name,
    description: project.description,
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
