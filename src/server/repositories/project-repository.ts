import { and, asc, eq, gt, inArray, lte, or } from "drizzle-orm";

import type { Checkpoint, Dependency, PendingDeleteAction, Project, Task } from "@/domain/planner";
import { type AppDatabase, getDb } from "@/server/db/client";
import { type CheckpointRow, checkpoints, dependencies, pendingDeleteActions, projects, tasks } from "@/server/db/schema";
import {
  mapCheckpointRow,
  mapDependencyRow,
  mapPendingDeleteActionRow,
  mapProjectRow,
  mapTaskRow,
  toCheckpointInsert,
  toDependencyInsert,
  toPendingDeleteActionInsert,
  toProjectInsert,
  toTaskInsert,
} from "@/server/repositories/mappers";

function isMissingRelationError(error: unknown, relationName: string) {
  const visited = new Set<unknown>();
  const queue: unknown[] = [error];
  const quotedRelation = `"${relationName}"`;

  while (queue.length > 0) {
    const current = queue.shift();

    if (!current || visited.has(current)) {
      continue;
    }

    visited.add(current);

    if (typeof current === "object") {
      const record = current as Record<string, unknown>;
      const message = typeof record.message === "string" ? record.message : "";
      const code = typeof record.code === "string" ? record.code : "";

      if (
        code === "42P01" ||
        message.includes(`relation ${quotedRelation} does not exist`) ||
        message.includes(`table ${quotedRelation} does not exist`)
      ) {
        return true;
      }

      if ("cause" in record) {
        queue.push(record.cause);
      }
    }
  }

  return false;
}

function isUnsupportedTransactionError(error: unknown) {
  const visited = new Set<unknown>();
  const queue: unknown[] = [error];

  while (queue.length > 0) {
    const current = queue.shift();

    if (!current || visited.has(current)) {
      continue;
    }

    visited.add(current);

    if (typeof current === "object") {
      const record = current as Record<string, unknown>;
      const message = typeof record.message === "string" ? record.message : "";

      if (message.includes("No transactions support in neon-http driver")) {
        return true;
      }

      if ("cause" in record) {
        queue.push(record.cause);
      }
    }
  }

  return false;
}

export class ProjectRepository {
  async withTransaction<T>(run: (tx: AppDatabase) => Promise<T>) {
    const db = await getDb();

    try {
      return await db.transaction((tx) => run(tx as unknown as AppDatabase));
    } catch (error) {
      if (!isUnsupportedTransactionError(error)) {
        throw error;
      }

      return run(db);
    }
  }

  async listProjects() {
    const db = await getDb();
    const rows = await db.select().from(projects).orderBy(asc(projects.updatedAt));
    return rows.map(mapProjectRow);
  }

  async getProject(projectId: string) {
    const db = await getDb();
    const row = await db.query.projects.findFirst({
      where: eq(projects.id, projectId),
    });

    return row ? mapProjectRow(row) : null;
  }

  async getProjectSnapshot(projectId: string, currentTime = new Date().toISOString()) {
    const db = await getDb();
    const project = await this.getProject(projectId);

    if (!project) {
      return null;
    }

    await this.purgeExpiredPendingDeleteActions(projectId, currentTime);
    const nowIso = currentTime;

    const taskRows = await db
      .select()
      .from(tasks)
      .where(eq(tasks.projectId, projectId))
      .orderBy(asc(tasks.sortOrder), asc(tasks.createdAt));
    const dependencyRows = await db
      .select()
      .from(dependencies)
      .where(eq(dependencies.projectId, projectId))
      .orderBy(asc(dependencies.createdAt));
    let checkpointRows: CheckpointRow[];

    if (taskRows.length === 0) {
      checkpointRows = [];
    } else {
      try {
        checkpointRows = await db
          .select()
          .from(checkpoints)
          .where(
            inArray(
              checkpoints.taskId,
              taskRows.map((row) => row.id),
            ),
          )
          .orderBy(asc(checkpoints.taskId), asc(checkpoints.sortOrder), asc(checkpoints.createdAt));
      } catch (error) {
        if (!isMissingRelationError(error, "checkpoints")) {
          throw error;
        }

        console.warn('Checkpoint table is missing; returning project plans without checkpoints until the latest migration is applied.');
        checkpointRows = [];
      }
    }

    let pendingDeleteActionRows: PendingDeleteAction[];

    try {
      pendingDeleteActionRows = (
        await db
          .select()
          .from(pendingDeleteActions)
          .where(and(eq(pendingDeleteActions.projectId, projectId), gt(pendingDeleteActions.expiresAt, nowIso)))
          .orderBy(asc(pendingDeleteActions.expiresAt), asc(pendingDeleteActions.createdAt))
      ).map(mapPendingDeleteActionRow);
    } catch (error) {
      if (!isMissingRelationError(error, "pending_delete_actions")) {
        throw error;
      }

      console.warn("Pending delete actions table is missing; returning project plans without undo metadata until the latest migration is applied.");
      pendingDeleteActionRows = [];
    }

    return {
      project,
      tasks: taskRows.map(mapTaskRow),
      dependencies: dependencyRows.map(mapDependencyRow),
      checkpoints: checkpointRows.map(mapCheckpointRow),
      pendingDeleteActions: pendingDeleteActionRows,
    };
  }

  async insertProject(project: Project) {
    const db = await getDb();
    await db.insert(projects).values(toProjectInsert(project));
    return project;
  }

  async updateProject(projectId: string, values: Partial<Project>) {
    const db = await getDb();
    await db
      .update(projects)
      .set({
        name: values.name,
        description: values.description,
        baselineCapturedAt: values.baselineCapturedAt,
        updatedAt: values.updatedAt,
      })
      .where(eq(projects.id, projectId));
  }

  async deleteProject(projectId: string) {
    const db = await getDb();
    await db.delete(projects).where(eq(projects.id, projectId));
  }

  async insertTasks(taskList: Task[]) {
    if (taskList.length === 0) {
      return;
    }

    const db = await getDb();
    await db.insert(tasks).values(taskList.map(toTaskInsert));
  }

  async insertDependencies(dependencyList: Dependency[]) {
    if (dependencyList.length === 0) {
      return;
    }

    const db = await getDb();
    await db.insert(dependencies).values(dependencyList.map(toDependencyInsert));
  }

  async insertCheckpoints(checkpointList: Checkpoint[]) {
    if (checkpointList.length === 0) {
      return;
    }

    const db = await getDb();
    await db.insert(checkpoints).values(checkpointList.map(toCheckpointInsert));
  }

  async createPendingDeleteAction(action: PendingDeleteAction) {
    const db = await getDb();
    try {
      await db.insert(pendingDeleteActions).values(toPendingDeleteActionInsert(action));
    } catch (error) {
      if (!isMissingRelationError(error, "pending_delete_actions")) {
        throw error;
      }

      console.warn("Pending delete actions table is missing; skipping undo capture until the latest migration is applied.");
    }

    return action;
  }

  async getPendingDeleteAction(actionId: string) {
    const db = await getDb();
    let row;

    try {
      [row] = await db
        .select()
        .from(pendingDeleteActions)
        .where(eq(pendingDeleteActions.id, actionId))
        .limit(1);
    } catch (error) {
      if (!isMissingRelationError(error, "pending_delete_actions")) {
        throw error;
      }

      console.warn("Pending delete actions table is missing; undo is unavailable until the latest migration is applied.");
      return null;
    }

    return row ? mapPendingDeleteActionRow(row) : null;
  }

  async purgeExpiredPendingDeleteActions(projectId?: string, currentTime = new Date().toISOString()) {
    const db = await getDb();
    const where = projectId
      ? and(eq(pendingDeleteActions.projectId, projectId), lte(pendingDeleteActions.expiresAt, currentTime))
      : lte(pendingDeleteActions.expiresAt, currentTime);

    try {
      await db.delete(pendingDeleteActions).where(where);
    } catch (error) {
      if (!isMissingRelationError(error, "pending_delete_actions")) {
        throw error;
      }

      console.warn("Pending delete actions table is missing; skipping undo expiry cleanup until the latest migration is applied.");
    }
  }

  async deletePendingDeleteAction(actionId: string) {
    const db = await getDb();
    try {
      await db.delete(pendingDeleteActions).where(eq(pendingDeleteActions.id, actionId));
    } catch (error) {
      if (!isMissingRelationError(error, "pending_delete_actions")) {
        throw error;
      }

      console.warn("Pending delete actions table is missing; nothing to delete for undo metadata.");
    }
  }

  async getTask(taskId: string) {
    const db = await getDb();
    const row = await db.query.tasks.findFirst({
      where: eq(tasks.id, taskId),
    });

    return row ? mapTaskRow(row) : null;
  }

  async createTask(task: Task) {
    const db = await getDb();
    await db.insert(tasks).values(toTaskInsert(task));
    return task;
  }

  async updateTask(taskId: string, values: Partial<Task>) {
    const db = await getDb();
    await db
      .update(tasks)
      .set({
        parentId: values.parentId,
        name: values.name,
        notes: values.notes,
        sortOrder: values.sortOrder,
        type: values.type,
        plannedMode: values.plannedMode,
        plannedStart: values.plannedStart,
        plannedEnd: values.plannedEnd,
        plannedDurationDays: values.plannedDurationDays,
        baselinePlannedStart: values.baselinePlannedStart,
        baselinePlannedEnd: values.baselinePlannedEnd,
        baselinePlannedDurationDays: values.baselinePlannedDurationDays,
        actualStart: values.actualStart,
        actualEnd: values.actualEnd,
        status: values.status,
        percentComplete: values.percentComplete,
        isExpanded: values.isExpanded,
        updatedAt: values.updatedAt,
      })
      .where(eq(tasks.id, taskId));
  }

  async deleteTask(taskId: string) {
    const db = await getDb();
    const task = await this.getTask(taskId);

    if (!task) {
      return null;
    }

    const descendantRows = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(eq(tasks.projectId, task.projectId))
      .orderBy(asc(tasks.sortOrder));
    const parentMap = new Map<string | null, string[]>();

    for (const row of descendantRows) {
      const full = await this.getTask(row.id);

      if (!full) {
        continue;
      }

      const bucket = parentMap.get(full.parentId) ?? [];
      bucket.push(full.id);
      parentMap.set(full.parentId, bucket);
    }

    const idsToDelete = new Set<string>();
    const stack = [taskId];

    while (stack.length > 0) {
      const current = stack.pop();

      if (!current || idsToDelete.has(current)) {
        continue;
      }

      idsToDelete.add(current);

      for (const childId of parentMap.get(current) ?? []) {
        stack.push(childId);
      }
    }

    const ids = [...idsToDelete];

    await db
      .delete(dependencies)
      .where(
        and(
          eq(dependencies.projectId, task.projectId),
          or(
            inArray(dependencies.predecessorTaskId, ids),
            inArray(dependencies.successorTaskId, ids),
          ),
        ),
      );
    await db.delete(tasks).where(inArray(tasks.id, ids));

    return task.projectId;
  }

  async getDependency(dependencyId: string) {
    const db = await getDb();
    const row = await db.query.dependencies.findFirst({
      where: eq(dependencies.id, dependencyId),
    });

    return row ? mapDependencyRow(row) : null;
  }

  async createDependency(dependency: Dependency) {
    const db = await getDb();
    await db.insert(dependencies).values(toDependencyInsert(dependency));
    return dependency;
  }

  async listCheckpointsForTask(taskId: string) {
    const db = await getDb();
    const rows = await db
      .select()
      .from(checkpoints)
      .where(eq(checkpoints.taskId, taskId))
      .orderBy(asc(checkpoints.sortOrder), asc(checkpoints.createdAt));

    return rows.map(mapCheckpointRow);
  }

  async getCheckpoint(checkpointId: string) {
    const db = await getDb();
    const row = await db.query.checkpoints.findFirst({
      where: eq(checkpoints.id, checkpointId),
    });

    return row ? mapCheckpointRow(row) : null;
  }

  async createCheckpoint(checkpoint: Checkpoint) {
    const db = await getDb();
    await db.insert(checkpoints).values(toCheckpointInsert(checkpoint));
    return checkpoint;
  }

  async updateCheckpoint(checkpointId: string, values: Partial<Checkpoint>) {
    const db = await getDb();
    await db
      .update(checkpoints)
      .set({
        name: values.name,
        percentComplete: values.percentComplete,
        weightPoints: values.weightPoints,
        sortOrder: values.sortOrder,
        updatedAt: values.updatedAt,
      })
      .where(eq(checkpoints.id, checkpointId));
  }

  async deleteCheckpoint(checkpointId: string) {
    const db = await getDb();
    const checkpoint = await this.getCheckpoint(checkpointId);

    if (!checkpoint) {
      return null;
    }

    await db.delete(checkpoints).where(eq(checkpoints.id, checkpointId));
    return checkpoint.taskId;
  }

  async updateDependency(dependencyId: string, values: Partial<Dependency>) {
    const db = await getDb();
    await db
      .update(dependencies)
      .set({
        predecessorTaskId: values.predecessorTaskId,
        successorTaskId: values.successorTaskId,
        type: values.type,
        lagDays: values.lagDays,
        updatedAt: values.updatedAt,
      })
      .where(eq(dependencies.id, dependencyId));
  }

  async deleteDependency(dependencyId: string) {
    const db = await getDb();
    const dependency = await this.getDependency(dependencyId);

    if (!dependency) {
      return null;
    }

    await db.delete(dependencies).where(eq(dependencies.id, dependencyId));
    return dependency.projectId;
  }
}

export const projectRepository = new ProjectRepository();
