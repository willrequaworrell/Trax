import type { Task, TaskStatus } from "@/domain/planner";

export function normalizeStoredTaskStatus(task: Pick<Task, "type" | "status" | "percentComplete" | "actualStart" | "actualEnd">): TaskStatus {
  if (task.type === "summary") {
    return task.status;
  }

  if (task.status === "blocked") {
    return "blocked";
  }

  if (task.actualEnd || task.percentComplete >= 100) {
    return "done";
  }

  if ((task.percentComplete > 0 || task.actualStart) && task.status === "not_started") {
    return "in_progress";
  }

  return task.status;
}

export function findTaskNormalizationUpdates(tasks: Task[]) {
  return tasks.flatMap((task) => {
    const updates: Array<{
      id: string;
      values: Partial<Task>;
    }> = [];

    const normalizedStatus = normalizeStoredTaskStatus(task);
    if (normalizedStatus !== task.status) {
      updates.push({
        id: task.id,
        values: { status: normalizedStatus },
      });
    }

    return updates;
  });
}
