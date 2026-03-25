import {
  addDurationToStart,
  businessDaysInclusive,
  clampToBusinessDay,
  compareIsoDates,
  maxIsoDate,
  shiftBusinessDays,
} from "@/domain/date-utils";
import type { Dependency, Task } from "@/domain/planner";
import { ValidationError } from "@/server/errors";

type Snapshot = {
  tasks: Task[];
  dependencies: Dependency[];
};

function isLeafTask(task: Task) {
  return task.type !== "summary";
}

function deriveForecastDuration(task: Task) {
  if (task.type === "milestone") {
    return 0;
  }

  if (task.plannedMode === "start_end" && task.plannedStart && task.plannedEnd) {
    return businessDaysInclusive(task.plannedStart, task.plannedEnd);
  }

  return Math.max(task.plannedDurationDays ?? 1, 1);
}

function deriveForecastStart(task: Task) {
  if (task.type === "summary") {
    return null;
  }

  return task.actualStart
    ? clampToBusinessDay(task.actualStart)
    : task.actualEnd
      ? clampToBusinessDay(task.actualEnd)
      : task.plannedStart
        ? clampToBusinessDay(task.plannedStart)
        : null;
}

function deriveForecastEnd(task: Task) {
  const start = deriveForecastStart(task);

  if (task.type === "summary" || !start) {
    return null;
  }

  if (task.actualEnd) {
    return clampToBusinessDay(task.actualEnd);
  }

  if (task.type === "milestone") {
    return start;
  }

  if (task.plannedMode === "start_end" && task.plannedStart && task.plannedEnd) {
    return addDurationToStart(start, Math.max(businessDaysInclusive(task.plannedStart, task.plannedEnd), 1));
  }

  return addDurationToStart(start, deriveForecastDuration(task));
}

function buildDependencyIndex(dependencies: Dependency[]) {
  const bySuccessor = new Map<string, Dependency[]>();
  const byPredecessor = new Map<string, string[]>();

  for (const dependency of dependencies) {
    const incoming = bySuccessor.get(dependency.successorTaskId) ?? [];
    incoming.push(dependency);
    bySuccessor.set(dependency.successorTaskId, incoming);

    const outgoing = byPredecessor.get(dependency.predecessorTaskId) ?? [];
    outgoing.push(dependency.successorTaskId);
    byPredecessor.set(dependency.predecessorTaskId, outgoing);
  }

  return { bySuccessor, byPredecessor };
}

function topologicalLeafOrder(tasks: Task[], dependencies: Dependency[]) {
  const leafTaskIds = new Set(tasks.filter(isLeafTask).map((task) => task.id));
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, string[]>();

  for (const task of tasks) {
    if (!leafTaskIds.has(task.id)) {
      continue;
    }

    incoming.set(task.id, 0);
    outgoing.set(task.id, []);
  }

  for (const dependency of dependencies) {
    if (!leafTaskIds.has(dependency.predecessorTaskId) || !leafTaskIds.has(dependency.successorTaskId)) {
      continue;
    }

    outgoing.get(dependency.predecessorTaskId)?.push(dependency.successorTaskId);
    incoming.set(
      dependency.successorTaskId,
      (incoming.get(dependency.successorTaskId) ?? 0) + 1,
    );
  }

  const queue = [...incoming.entries()]
    .filter(([, count]) => count === 0)
    .map(([id]) => id);
  const order: string[] = [];

  while (queue.length > 0) {
    const current = queue.shift();

    if (!current) {
      continue;
    }

    order.push(current);

    for (const next of outgoing.get(current) ?? []) {
      const remaining = (incoming.get(next) ?? 0) - 1;
      incoming.set(next, remaining);

      if (remaining === 0) {
        queue.push(next);
      }
    }
  }

  return order;
}

function collectSuccessorClosure(
  dependencies: Dependency[],
  seedTaskIds: string[],
  includeSeeds = false,
) {
  const { byPredecessor } = buildDependencyIndex(dependencies);
  const visited = new Set<string>(includeSeeds ? seedTaskIds : []);
  const stack = [...seedTaskIds];

  while (stack.length > 0) {
    const current = stack.pop();

    if (!current) {
      continue;
    }

    for (const successorId of byPredecessor.get(current) ?? []) {
      if (visited.has(successorId)) {
        continue;
      }

      visited.add(successorId);
      stack.push(successorId);
    }
  }

  return visited;
}

function resolveTaskStart(
  task: Task,
  durationDays: number,
  requiredStart: string | null,
  requiredEnd: string | null,
) {
  const fixedActualStart = task.actualStart ? clampToBusinessDay(task.actualStart) : null;

  if (fixedActualStart) {
    return fixedActualStart;
  }

  if (task.actualEnd) {
    return clampToBusinessDay(task.actualEnd);
  }

  const fallbackStart = task.plannedStart ? clampToBusinessDay(task.plannedStart) : null;

  if (task.type === "milestone") {
    return clampToBusinessDay(requiredStart ?? requiredEnd ?? fallbackStart ?? new Date().toISOString().slice(0, 10));
  }

  if (!requiredStart && !requiredEnd) {
    return fallbackStart;
  }

  const earliestByEnd =
    requiredEnd && durationDays > 0
      ? shiftBusinessDays(requiredEnd, -(durationDays - 1))
      : requiredEnd;

  return clampToBusinessDay(maxIsoDate([requiredStart, earliestByEnd]) ?? fallbackStart ?? new Date().toISOString().slice(0, 10));
}

function signedBusinessDayOffset(from: string, to: string) {
  if (from === to) {
    return 0;
  }

  if (compareIsoDates(to, from) > 0) {
    let cursor = from;
    let offset = 0;

    while (compareIsoDates(cursor, to) < 0) {
      cursor = shiftBusinessDays(cursor, 1);
      offset += 1;
    }

    return offset;
  }

  let cursor = from;
  let offset = 0;

  while (compareIsoDates(cursor, to) > 0) {
    cursor = shiftBusinessDays(cursor, -1);
    offset -= 1;
  }

  return offset;
}

export function resolveForecastAnchorTask(tasks: Task[]) {
  const anchor = tasks
    .filter((task) => isLeafTask(task) && task.plannedStart)
    .sort(
      (a, b) =>
        (a.plannedStart ?? "").localeCompare(b.plannedStart ?? "") ||
        a.sortOrder - b.sortOrder ||
        a.name.localeCompare(b.name),
    )
    .at(0);

  if (!anchor?.plannedStart) {
    throw new ValidationError("Project forecast could not be shifted because it has no planned leaf start date.");
  }

  return anchor;
}

export function shiftForecastTasks(tasks: Task[], offset: number) {
  return tasks.map((task) => {
    if (!isLeafTask(task) || !task.plannedStart || task.actualStart || task.actualEnd) {
      return task;
    }

    return {
      ...task,
      plannedStart: shiftBusinessDays(clampToBusinessDay(task.plannedStart), offset),
      plannedEnd:
        task.plannedMode === "start_end" && task.plannedEnd
          ? shiftBusinessDays(clampToBusinessDay(task.plannedEnd), offset)
          : null,
    };
  });
}

export function rebaseForecastTasks(tasks: Task[], startDate: string) {
  const anchor = resolveForecastAnchorTask(tasks);
  const normalizedStartDate = clampToBusinessDay(startDate);
  const offset = signedBusinessDayOffset(clampToBusinessDay(anchor.plannedStart!), normalizedStartDate);
  return shiftForecastTasks(tasks, offset);
}

export function cascadeForecastFromSeeds(
  snapshot: Snapshot,
  seedTaskIds: string[],
  options: { includeSeeds?: boolean } = {},
) {
  const affectedIds = collectSuccessorClosure(snapshot.dependencies, seedTaskIds, options.includeSeeds);

  if (affectedIds.size === 0) {
    return snapshot.tasks;
  }

  const order = topologicalLeafOrder(snapshot.tasks, snapshot.dependencies).filter((taskId) => affectedIds.has(taskId));
  const taskMap = new Map(snapshot.tasks.map((task) => [task.id, { ...task }]));
  const { bySuccessor } = buildDependencyIndex(snapshot.dependencies);

  for (const taskId of order) {
    const task = taskMap.get(taskId);

    if (!task || !isLeafTask(task)) {
      continue;
    }

    if (task.actualStart || task.actualEnd) {
      continue;
    }

    const durationDays = deriveForecastDuration(task);
    let requiredStart: string | null = null;
    let requiredEnd: string | null = null;

    for (const dependency of bySuccessor.get(taskId) ?? []) {
      const predecessor = taskMap.get(dependency.predecessorTaskId);

      if (!predecessor || predecessor.type === "summary") {
        continue;
      }

      const predecessorStart = deriveForecastStart(predecessor);
      const predecessorEnd = deriveForecastEnd(predecessor);

      switch (dependency.type) {
        case "FS":
          if (predecessorEnd) {
            requiredStart = maxIsoDate([requiredStart, shiftBusinessDays(predecessorEnd, dependency.lagDays)]);
          }
          break;
        case "SS":
          if (predecessorStart) {
            requiredStart = maxIsoDate([requiredStart, shiftBusinessDays(predecessorStart, dependency.lagDays)]);
          }
          break;
        case "FF":
          if (predecessorEnd) {
            requiredEnd = maxIsoDate([requiredEnd, shiftBusinessDays(predecessorEnd, dependency.lagDays)]);
          }
          break;
        case "SF":
          if (predecessorStart) {
            requiredEnd = maxIsoDate([requiredEnd, shiftBusinessDays(predecessorStart, dependency.lagDays)]);
          }
          break;
      }
    }

    const nextStart = resolveTaskStart(task, durationDays, requiredStart, requiredEnd);

    if (!nextStart) {
      continue;
    }

    taskMap.set(taskId, {
      ...task,
      plannedStart: nextStart,
      plannedEnd:
        task.type === "milestone"
          ? null
          : task.plannedMode === "start_end"
            ? addDurationToStart(nextStart, Math.max(durationDays, 1))
            : null,
      plannedDurationDays: task.type === "milestone" ? 0 : durationDays,
    });
  }

  return snapshot.tasks.map((task) => taskMap.get(task.id) ?? task);
}
