import type { Dependency, Project, Task } from "@/domain/planner";

type Snapshot = {
  project: Project;
  tasks: Task[];
  dependencies: Dependency[];
};

type Options = {
  projectId: string;
  now: string;
  createId: (prefix: string) => string;
  name?: string;
  description?: string;
};

export function duplicateProjectSnapshot(snapshot: Snapshot, options: Options): Snapshot {
  const taskIdMap = new Map<string, string>();

  for (const task of snapshot.tasks) {
    taskIdMap.set(task.id, options.createId("task"));
  }

  const project: Project = {
    ...snapshot.project,
    id: options.projectId,
    name: options.name ?? `${snapshot.project.name} Copy`,
    description: options.description ?? snapshot.project.description,
    createdAt: options.now,
    updatedAt: options.now,
  };

  const tasks: Task[] = snapshot.tasks.map((task) => ({
    ...task,
    id: taskIdMap.get(task.id) ?? options.createId("task"),
    projectId: options.projectId,
    parentId: task.parentId ? (taskIdMap.get(task.parentId) ?? null) : null,
    createdAt: options.now,
    updatedAt: options.now,
  }));

  const dependencies: Dependency[] = snapshot.dependencies.map((dependency) => ({
    ...dependency,
    id: options.createId("dep"),
    projectId: options.projectId,
    predecessorTaskId: taskIdMap.get(dependency.predecessorTaskId) ?? dependency.predecessorTaskId,
    successorTaskId: taskIdMap.get(dependency.successorTaskId) ?? dependency.successorTaskId,
    createdAt: options.now,
    updatedAt: options.now,
  }));

  return { project, tasks, dependencies };
}
