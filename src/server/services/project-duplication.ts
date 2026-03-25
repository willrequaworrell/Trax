import type { Checkpoint, Dependency, Project, Task } from "@/domain/planner";

type Snapshot = {
  project: Project;
  tasks: Task[];
  dependencies: Dependency[];
  checkpoints: Checkpoint[];
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
    baselineCapturedAt: null,
    createdAt: options.now,
    updatedAt: options.now,
  };

  const tasks: Task[] = snapshot.tasks.map((task) => ({
    ...task,
    id: taskIdMap.get(task.id) ?? options.createId("task"),
    projectId: options.projectId,
    parentId: task.parentId ? (taskIdMap.get(task.parentId) ?? null) : null,
    baselinePlannedStart: null,
    baselinePlannedEnd: null,
    baselinePlannedDurationDays: null,
    actualStart: null,
    actualEnd: null,
    status: "not_started",
    percentComplete: 0,
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

  const checkpointTaskIds = new Map(snapshot.tasks.map((task) => [task.id, taskIdMap.get(task.id) ?? task.id]));
  const checkpoints: Checkpoint[] = snapshot.checkpoints.map((checkpoint) => ({
    ...checkpoint,
    id: options.createId("checkpoint"),
    taskId: checkpointTaskIds.get(checkpoint.taskId) ?? checkpoint.taskId,
    percentComplete: 0,
    createdAt: options.now,
    updatedAt: options.now,
  }));

  return { project, tasks, dependencies, checkpoints };
}
