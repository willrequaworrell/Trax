import {
  addDurationToStart,
  businessDayShiftGap,
  businessDaysInclusive,
  clampToBusinessDay,
  isoToday,
  maxIsoDate,
  minIsoDate,
  shiftBusinessDays,
} from "@/domain/date-utils";
import { computeCheckpointPercent } from "@/domain/checkpoints";
import type {
  Checkpoint,
  Dependency,
  PendingDeleteAction,
  PlannedTask,
  PlanningIssue,
  Project,
  ProjectPlan,
  Task,
  TaskStatus,
} from "@/domain/planner";

type Snapshot = {
  project: Project;
  tasks: Task[];
  dependencies: Dependency[];
  checkpoints: Checkpoint[];
  pendingDeleteActions?: PendingDeleteAction[];
};

function makeIssue(
  id: string,
  message: string,
  severity: PlanningIssue["severity"] = "warning",
  taskId?: string,
): PlanningIssue {
  return { id, message, severity, taskId };
}

function deriveLeafDuration(task: Task) {
  return deriveLeafDurationFromSchedule(
    task.type,
    task.plannedStart,
    task.plannedEnd,
    task.plannedDurationDays,
  );
}

function deriveBaselineLeafDuration(task: Task) {
  return deriveLeafDurationFromSchedule(
    task.type,
    task.baselinePlannedStart,
    task.baselinePlannedEnd,
    task.baselinePlannedDurationDays,
  );
}

function deriveLeafDurationFromSchedule(
  type: Task["type"],
  plannedStart: string | null,
  plannedEnd: string | null,
  plannedDurationDays: number | null,
) {
  if (type === "milestone") {
    return 0;
  }

  if (plannedDurationDays !== null) {
    return Math.max(plannedDurationDays, 1);
  }

  if (plannedStart && plannedEnd) {
    return businessDaysInclusive(plannedStart, plannedEnd);
  }

  return 1;
}

function deriveStatus(_taskStatus: TaskStatus, percentComplete: number, actualStart: string | null, actualEnd: string | null) {
  if (actualEnd) {
    return "done" satisfies TaskStatus;
  }

  if (percentComplete > 0 || actualStart) {
    return "in_progress" satisfies TaskStatus;
  }

  return "not_started" satisfies TaskStatus;
}

function topologicalSort(tasks: Task[], dependencies: Dependency[]) {
  const leafTaskIds = new Set(tasks.filter((task) => task.type !== "summary").map((task) => task.id));
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, string[]>();

  for (const id of leafTaskIds) {
    incoming.set(id, 0);
    outgoing.set(id, []);
  }

  const issues: PlanningIssue[] = [];

  for (const dependency of dependencies) {
    if (!leafTaskIds.has(dependency.predecessorTaskId) || !leafTaskIds.has(dependency.successorTaskId)) {
      issues.push(
        makeIssue(
          `dependency-${dependency.id}-non-leaf`,
          "Dependencies must connect leaf tasks only.",
          "error",
          dependency.successorTaskId,
        ),
      );
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

  const cyclicIds = [...incoming.entries()].filter(([, count]) => count > 0).map(([id]) => id);

  for (const taskId of cyclicIds) {
    issues.push(
      makeIssue(
        `cycle-${taskId}`,
        "This task is part of a dependency cycle and could not be scheduled safely.",
        "error",
        taskId,
      ),
    );
  }

  return { order: [...order, ...cyclicIds], issues };
}

function buildChildren(tasks: Task[]) {
  const children = new Map<string | null, string[]>();

  for (const task of tasks) {
    const bucket = children.get(task.parentId) ?? [];
    bucket.push(task.id);
    children.set(task.parentId, bucket);
  }

  return children;
}

function buildDepths(children: Map<string | null, string[]>) {
  const depths = new Map<string, number>();

  function visit(parentId: string | null, depth: number) {
    for (const childId of children.get(parentId) ?? []) {
      depths.set(childId, depth);
      visit(childId, depth + 1);
    }
  }

  visit(null, 0);
  return depths;
}

function displayedStart(task: PlannedTask) {
  return task.computedPlannedStart ?? task.plannedStart;
}

function deriveProjectedLeafRange(task: Task, durationDays: number) {
  const actualStart = task.actualStart ? clampToBusinessDay(task.actualStart) : null;
  const actualEnd = task.actualEnd ? clampToBusinessDay(task.actualEnd) : null;

  if (actualStart || actualEnd) {
    const projectedStart = actualStart ?? actualEnd ?? clampToBusinessDay(task.plannedStart ?? isoToday());

    if (actualEnd) {
      return {
        start: projectedStart,
        end: actualEnd,
      };
    }

    if (task.type === "milestone") {
      return {
        start: projectedStart,
        end: projectedStart,
      };
    }

    return {
      start: projectedStart,
      end: addDurationToStart(projectedStart, Math.max(durationDays, 1)),
    };
  }

  const projectedStart = clampToBusinessDay(task.plannedStart ?? isoToday());
  const projectedEnd =
    task.type === "milestone"
      ? projectedStart
      : addDurationToStart(projectedStart, Math.max(durationDays, 1));

  return {
    start: projectedStart,
    end: projectedEnd,
  };
}

function derivedActualStart(task: Task) {
  return task.actualStart ?? task.actualEnd;
}

export function computeProjectPlan(snapshot: Snapshot): ProjectPlan {
  const tasks = [...snapshot.tasks].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  const taskMap = new Map(tasks.map((task) => [task.id, task]));
  const children = buildChildren(tasks);
  const depths = buildDepths(children);
  const checkpointsByTaskId = new Map<string, Checkpoint[]>();
  const dependenciesBySuccessor = new Map<string, Dependency[]>();
  const dependenciesByPredecessor = new Map<string, Dependency[]>();
  const issues: PlanningIssue[] = [];

  for (const checkpoint of [...(snapshot.checkpoints ?? [])].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name) || a.createdAt.localeCompare(b.createdAt),
  )) {
    const bucket = checkpointsByTaskId.get(checkpoint.taskId) ?? [];
    bucket.push(checkpoint);
    checkpointsByTaskId.set(checkpoint.taskId, bucket);
  }

  for (const dependency of snapshot.dependencies) {
    const blockedBy = dependenciesBySuccessor.get(dependency.successorTaskId) ?? [];
    blockedBy.push(dependency);
    dependenciesBySuccessor.set(dependency.successorTaskId, blockedBy);

    const blocking = dependenciesByPredecessor.get(dependency.predecessorTaskId) ?? [];
    blocking.push(dependency);
    dependenciesByPredecessor.set(dependency.predecessorTaskId, blocking);
  }

  const { order, issues: topologyIssues } = topologicalSort(tasks, snapshot.dependencies);
  issues.push(...topologyIssues);

  const planned = new Map<string, PlannedTask>();

  for (const taskId of order) {
    const task = taskMap.get(taskId);

    if (!task || task.type === "summary") {
      continue;
    }

    const taskIssues: PlanningIssue[] = [];
    const checkpoints = checkpointsByTaskId.get(task.id) ?? [];
    const hasCheckpoints = task.type === "task" && checkpoints.length > 0;
    const durationDays = deriveLeafDuration(task);
    const baselineDurationDays = deriveBaselineLeafDuration(task);
    const projectedRange = deriveProjectedLeafRange(task, durationDays);
    const baseStart = projectedRange.start;
    const baseEnd = projectedRange.end;

    let requiredStart = baseStart;
    let requiredEnd = baseEnd;

    for (const dependency of dependenciesBySuccessor.get(taskId) ?? []) {
      const predecessor = planned.get(dependency.predecessorTaskId);

      if (!predecessor?.computedPlannedStart || !predecessor.computedPlannedEnd) {
        taskIssues.push(
          makeIssue(
            `missing-predecessor-${dependency.id}`,
            "A predecessor could not be scheduled before this task.",
            "warning",
            task.id,
          ),
        );
        continue;
      }

      switch (dependency.type) {
        case "FS":
          requiredStart = maxIsoDate([
            requiredStart,
            shiftBusinessDays(predecessor.computedPlannedEnd, dependency.lagDays),
          ])!;
          break;
        case "SS":
          requiredStart = maxIsoDate([
            requiredStart,
            shiftBusinessDays(predecessor.computedPlannedStart, dependency.lagDays),
          ])!;
          break;
        case "FF":
          requiredEnd = maxIsoDate([
            requiredEnd,
            shiftBusinessDays(predecessor.computedPlannedEnd, dependency.lagDays),
          ])!;
          break;
        case "SF":
          requiredEnd = maxIsoDate([
            requiredEnd,
            shiftBusinessDays(predecessor.computedPlannedStart, dependency.lagDays),
          ])!;
          break;
      }
    }

    const computedStart =
      task.actualStart || task.actualEnd
        ? projectedRange.start
        : shiftBusinessDays(
            baseStart,
            Math.max(
              businessDayShiftGap(baseStart, requiredStart),
              businessDayShiftGap(baseEnd, requiredEnd),
            ),
          );
    const computedEnd =
      task.actualEnd
        ? clampToBusinessDay(task.actualEnd)
        : task.type === "milestone"
          ? computedStart
          : task.actualStart
            ? projectedRange.end
            : addDurationToStart(
                computedStart,
                task.plannedMode === "start_end" && task.plannedEnd
                  ? businessDaysInclusive(baseStart, baseEnd)
                  : Math.max(durationDays, 1),
              );
    const percentComplete = hasCheckpoints ? computeCheckpointPercent(checkpoints) : task.percentComplete;
    const leafStatus = deriveStatus(task.status, percentComplete, task.actualStart, task.actualEnd);
    const computedBaselineStart = task.baselinePlannedStart
      ? clampToBusinessDay(task.baselinePlannedStart)
      : null;
    const computedBaselineEnd = computedBaselineStart
      ? task.type === "milestone"
        ? computedBaselineStart
        : task.baselinePlannedEnd
          ? clampToBusinessDay(task.baselinePlannedEnd)
          : addDurationToStart(computedBaselineStart, Math.max(baselineDurationDays, 1))
      : null;

    if (task.type !== "milestone" && task.plannedStart === null) {
      taskIssues.push(
        makeIssue(
          `missing-start-${task.id}`,
          "Leaf tasks should include a planned start date for stable scheduling.",
          "warning",
          task.id,
        ),
      );
    }

    if (task.plannedEnd && task.plannedDurationDays !== null && task.plannedStart === null) {
      taskIssues.push(
        makeIssue(
          `invalid-anchor-${task.id}`,
          "A task cannot rely on planned end and duration without a planned start date.",
          "error",
          task.id,
        ),
      );
    }

    planned.set(task.id, {
      ...task,
      percentComplete,
      isSummary: false,
      childIds: [],
      depth: depths.get(task.id) ?? 0,
      hasChildren: false,
      blockedBy: dependenciesBySuccessor.get(task.id) ?? [],
      blocking: dependenciesByPredecessor.get(task.id) ?? [],
      computedPlannedStart: computedStart,
      computedPlannedEnd: computedEnd,
      computedPlannedDurationDays:
        task.type === "milestone" ? 0 : businessDaysInclusive(computedStart, computedEnd),
      computedBaselinePlannedStart: computedBaselineStart,
      computedBaselinePlannedEnd: computedBaselineEnd,
      computedBaselinePlannedDurationDays:
        computedBaselineStart && computedBaselineEnd
          ? task.type === "milestone"
            ? 0
            : businessDaysInclusive(computedBaselineStart, computedBaselineEnd)
          : null,
      computedActualStart: derivedActualStart(task),
      computedActualEnd: task.actualEnd,
      rolledUpEffortDays: task.type === "milestone" ? 0 : Math.max(durationDays, 1),
      rolledUpPercentComplete: percentComplete,
      rolledUpStatus: leafStatus,
      checkpoints,
      isProgressDerived: hasCheckpoints,
      issues: taskIssues,
    });
  }

  function rollup(taskId: string): PlannedTask {
    const current = taskMap.get(taskId);

    if (!current) {
      throw new Error(`Unknown task ${taskId}`);
    }

    if (planned.has(taskId)) {
      return planned.get(taskId)!;
    }

    const childIds = children.get(taskId) ?? [];
    const childPlans = childIds.map(rollup);
    const plannedStart = minIsoDate(childPlans.map((child) => child.computedPlannedStart));
    const plannedEnd = maxIsoDate(childPlans.map((child) => child.computedPlannedEnd));
    const baselinePlannedStart = minIsoDate(childPlans.map((child) => child.computedBaselinePlannedStart));
    const baselinePlannedEnd = maxIsoDate(childPlans.map((child) => child.computedBaselinePlannedEnd));
    const actualStart = minIsoDate(childPlans.map((child) => child.computedActualStart));
    const actualEnd = maxIsoDate(childPlans.map((child) => child.computedActualEnd));
    const rolledUpEffortDays = childPlans.reduce((total, child) => total + child.rolledUpEffortDays, 0);
    const weightedPercent =
      rolledUpEffortDays === 0
        ? Math.round(childPlans.reduce((total, child) => total + child.rolledUpPercentComplete, 0) / Math.max(childPlans.length, 1))
        : Math.round(
            childPlans.reduce(
              (total, child) => total + child.rolledUpPercentComplete * child.rolledUpEffortDays,
              0,
            ) / rolledUpEffortDays,
          );
    const allDone = childPlans.length > 0 && childPlans.every((child) => child.rolledUpStatus === "done");
    const someStarted = childPlans.some(
      (child) =>
        child.rolledUpPercentComplete > 0 || child.computedActualStart !== null || child.rolledUpStatus === "in_progress",
    );

    const summaryStatus: TaskStatus = allDone
      ? "done"
      : someStarted
        ? "in_progress"
        : "not_started";

    const summaryPlan: PlannedTask = {
      ...current,
      plannedMode: null,
      plannedStart: null,
      plannedEnd: null,
      plannedDurationDays: null,
      actualStart: null,
      actualEnd: null,
      status: summaryStatus,
      percentComplete: weightedPercent,
      isSummary: true,
      childIds,
      depth: depths.get(taskId) ?? 0,
      hasChildren: childIds.length > 0,
      blockedBy: [],
      blocking: [],
      computedPlannedStart: plannedStart,
      computedPlannedEnd: plannedEnd,
      computedPlannedDurationDays:
        plannedStart && plannedEnd ? businessDaysInclusive(plannedStart, plannedEnd) : null,
      computedBaselinePlannedStart: baselinePlannedStart,
      computedBaselinePlannedEnd: baselinePlannedEnd,
      computedBaselinePlannedDurationDays:
        baselinePlannedStart && baselinePlannedEnd
          ? businessDaysInclusive(baselinePlannedStart, baselinePlannedEnd)
          : null,
      computedActualStart: actualStart,
      computedActualEnd: actualEnd,
      rolledUpEffortDays,
      rolledUpPercentComplete: weightedPercent,
      rolledUpStatus: summaryStatus,
      checkpoints: [],
      isProgressDerived: false,
      issues: childPlans.flatMap((child) => child.issues),
    };

    planned.set(taskId, summaryPlan);
    return summaryPlan;
  }

  for (const rootTaskId of children.get(null) ?? []) {
    rollup(rootTaskId);
  }

  const orderedChildren = new Map<string | null, string[]>();

  for (const [parentId, childIds] of children.entries()) {
    orderedChildren.set(
      parentId,
      [...childIds].sort((leftId, rightId) => {
        const left = planned.get(leftId) ?? rollup(leftId);
        const right = planned.get(rightId) ?? rollup(rightId);
        const leftStart = displayedStart(left);
        const rightStart = displayedStart(right);

        if (leftStart && rightStart && leftStart !== rightStart) {
          return leftStart.localeCompare(rightStart);
        }

        if (leftStart && !rightStart) {
          return -1;
        }

        if (!leftStart && rightStart) {
          return 1;
        }

        const leftTask = taskMap.get(leftId);
        const rightTask = taskMap.get(rightId);
        return (
          (leftTask?.sortOrder ?? 0) - (rightTask?.sortOrder ?? 0) ||
          (leftTask?.name ?? leftId).localeCompare(rightTask?.name ?? rightId)
        );
      }),
    );
  }

  for (const plannedTask of planned.values()) {
    const childIds = orderedChildren.get(plannedTask.id) ?? [];
    plannedTask.childIds = childIds;
    plannedTask.hasChildren = childIds.length > 0;
  }

  const rootPlans = (orderedChildren.get(null) ?? []).map((taskId) => planned.get(taskId) ?? rollup(taskId));

  const allTasks = tasks.map((task) => planned.get(task.id) ?? rollup(task.id));
  const rows: ProjectPlan["rows"] = [];

  function appendRows(taskId: string) {
    const task = planned.get(taskId);

    if (!task) {
      return;
    }

    rows.push({
      taskId,
      depth: task.depth,
      hasChildren: task.hasChildren,
      isExpanded: task.isExpanded,
    });

    if (!task.isExpanded) {
      return;
    }

    for (const childId of task.childIds) {
      appendRows(childId);
    }
  }

  for (const rootTaskId of orderedChildren.get(null) ?? []) {
    appendRows(rootTaskId);
  }

  for (const task of allTasks) {
    issues.push(...task.issues);
  }

  const blockedTaskIds = allTasks
    .filter((task) => task.issues.some((issue) => issue.severity === "error"))
    .map((task) => task.id);
  const upcomingTaskIds = allTasks
    .filter((task) => !task.isSummary && task.rolledUpStatus !== "done")
    .sort((a, b) => (a.computedPlannedStart ?? "").localeCompare(b.computedPlannedStart ?? ""))
    .slice(0, 5)
    .map((task) => task.id);
  const rootEffortDays = rootPlans.reduce((total, task) => total + task.rolledUpEffortDays, 0);
  const projectPercentComplete =
    rootPlans.length === 0
      ? 0
      : rootEffortDays === 0
        ? Math.round(rootPlans.reduce((total, task) => total + task.rolledUpPercentComplete, 0) / rootPlans.length)
        : Math.round(
            rootPlans.reduce((total, task) => total + task.rolledUpPercentComplete * task.rolledUpEffortDays, 0) /
              rootEffortDays,
          );

  return {
    project: snapshot.project,
    tasks: allTasks,
    dependencies: snapshot.dependencies,
    pendingUndoActions: (snapshot.pendingDeleteActions ?? []).map((action) => ({
      id: action.id,
      kind: action.kind,
      subjectType: action.subjectType,
      subjectLabel: action.subjectLabel,
      expiresAt: action.expiresAt,
    })),
    rows,
    issues,
    projectPercentComplete,
    timelineStart: minIsoDate([
      ...allTasks.map((task) => task.computedPlannedStart),
      ...allTasks.map((task) => task.computedBaselinePlannedStart),
      ...allTasks.map((task) => task.computedActualStart),
    ]),
    timelineEnd: maxIsoDate([
      ...allTasks.map((task) => task.computedPlannedEnd),
      ...allTasks.map((task) => task.computedBaselinePlannedEnd),
      ...allTasks.map((task) => task.computedActualEnd),
      ...allTasks
        .filter((task) => task.computedActualStart && !task.computedActualEnd)
        .map(() => clampToBusinessDay(isoToday())),
    ]),
    upcomingTaskIds,
    blockedTaskIds,
  };
}
