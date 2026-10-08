import { businessDayShiftGap } from "@/domain/date-utils";
import type { ProjectPlan } from "@/domain/planner";

function signedGap(from: string, to: string) {
  return to < from ? -businessDayShiftGap(to, from) : businessDayShiftGap(from, to);
}


export function forecastMovements(previous: ProjectPlan, next: ProjectPlan) {
  const previousById = new Map(previous.tasks.map((task) => [task.id, task]));
  const movements: Record<string, { start: number; end: number }> = {};
  for (const task of next.tasks) {
    const old = previousById.get(task.id);
    if (!old) continue;
    const start = old.computedPlannedStart && task.computedPlannedStart
      ? signedGap(old.computedPlannedStart, task.computedPlannedStart) : 0;
    const end = old.computedPlannedEnd && task.computedPlannedEnd
      ? signedGap(old.computedPlannedEnd, task.computedPlannedEnd) : 0;
    if (start || end) movements[task.id] = { start, end };
  }
  return movements;
}

export function deploymentForecast(plan: ProjectPlan, targetId = plan.project.reportingTargetTaskId) {
  const target = plan.tasks.find((task) => task.id === targetId && !task.isSummary) ?? null;
  const connected = new Set<string>(target ? [target.id] : []);
  const incoming = new Map<string, string[]>();
  for (const dependency of plan.dependencies) {
    const predecessors = incoming.get(dependency.successorTaskId) ?? [];
    predecessors.push(dependency.predecessorTaskId);
    incoming.set(dependency.successorTaskId, predecessors);
  }
  const stack = [...connected];
  while (stack.length) {
    for (const id of incoming.get(stack.pop()!) ?? []) {
      if (!connected.has(id)) { connected.add(id); stack.push(id); }
    }
  }
  const reviewTasks = plan.tasks.filter((task) => !task.isSummary &&
    (!target || connected.has(task.id)) && task.issues.some((issue) =>
      issue.id.startsWith("forecast-review-") || issue.id.startsWith("fixed-date-conflict-") || issue.severity === "error"));
  const date = target ? target.computedActualEnd ?? target.computedPlannedEnd : null;
  const baseline = target?.computedBaselinePlannedEnd ?? null;
  return {
    target, date, baseline, reviewTasks,
    needsReview: reviewTasks.length > 0 || Boolean(targetId && !target) || plan.issues.some((issue) =>
      issue.severity === "error" && (!issue.taskId || !target || connected.has(issue.taskId))),
    variance: baseline && date ? signedGap(baseline, date) : null,
  };
}
