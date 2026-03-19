import { and, asc, eq, inArray, sql } from "drizzle-orm";

import type { Dependency, Project, Task } from "@/domain/planner";
import { db } from "@/server/db/client";
import { dependencies, projects, tasks } from "@/server/db/schema";
import {
  mapDependencyRow,
  mapProjectRow,
  mapTaskRow,
  toDependencyInsert,
  toProjectInsert,
  toTaskInsert,
} from "@/server/repositories/mappers";

export class ProjectRepository {
  async listProjects() {
    const rows = await db.select().from(projects).orderBy(asc(projects.updatedAt));
    return rows.map(mapProjectRow);
  }

  async getProject(projectId: string) {
    const row = await db.query.projects.findFirst({
      where: eq(projects.id, projectId),
    });

    return row ? mapProjectRow(row) : null;
  }

  async getProjectSnapshot(projectId: string) {
    const project = await this.getProject(projectId);

    if (!project) {
      return null;
    }

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

    return {
      project,
      tasks: taskRows.map(mapTaskRow),
      dependencies: dependencyRows.map(mapDependencyRow),
    };
  }

  async insertProject(project: Project) {
    await db.insert(projects).values(toProjectInsert(project));
    return project;
  }

  async updateProject(projectId: string, values: Partial<Project>) {
    await db
      .update(projects)
      .set({
        name: values.name,
        description: values.description,
        updatedAt: values.updatedAt,
      })
      .where(eq(projects.id, projectId));
  }

  async deleteProject(projectId: string) {
    await db.delete(projects).where(eq(projects.id, projectId));
  }

  async insertTasks(taskList: Task[]) {
    if (taskList.length === 0) {
      return;
    }

    await db.insert(tasks).values(taskList.map(toTaskInsert));
  }

  async insertDependencies(dependencyList: Dependency[]) {
    if (dependencyList.length === 0) {
      return;
    }

    await db.insert(dependencies).values(dependencyList.map(toDependencyInsert));
  }

  async getTask(taskId: string) {
    const row = await db.query.tasks.findFirst({
      where: eq(tasks.id, taskId),
    });

    return row ? mapTaskRow(row) : null;
  }

  async createTask(task: Task) {
    await db.insert(tasks).values(toTaskInsert(task));
    return task;
  }

  async updateTask(taskId: string, values: Partial<Task>) {
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
          sql`${dependencies.predecessorTaskId} in ${ids} or ${dependencies.successorTaskId} in ${ids}`,
        ),
      );
    await db.delete(tasks).where(inArray(tasks.id, ids));

    return task.projectId;
  }

  async getDependency(dependencyId: string) {
    const row = await db.query.dependencies.findFirst({
      where: eq(dependencies.id, dependencyId),
    });

    return row ? mapDependencyRow(row) : null;
  }

  async createDependency(dependency: Dependency) {
    await db.insert(dependencies).values(toDependencyInsert(dependency));
    return dependency;
  }

  async updateDependency(dependencyId: string, values: Partial<Dependency>) {
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
    const dependency = await this.getDependency(dependencyId);

    if (!dependency) {
      return null;
    }

    await db.delete(dependencies).where(eq(dependencies.id, dependencyId));
    return dependency.projectId;
  }
}

export const projectRepository = new ProjectRepository();
