import assert from "node:assert/strict";
import test from "node:test";

import type { Dependency, Task } from "@/domain/planner";
import { reconcileOverdueForecast } from "@/server/services/forecast-schedule";

function makeTask(overrides: Partial<Task> & Pick<Task, "id">): Task {
  return {
    id: overrides.id,
    projectId: "project",
    parentId: null,
    name: overrides.id,
    notes: "",
    sortOrder: 0,
    type: "task",
    plannedMode: "start_duration",
    plannedStart: "2026-07-01",
    plannedEnd: null,
    plannedDurationDays: 3,
    baselinePlannedStart: null,
    baselinePlannedEnd: null,
    baselinePlannedDurationDays: null,
    actualStart: null,
    actualEnd: null,
    status: "not_started",
    percentComplete: 0,
    isExpanded: true,
    createdAt: "2026-07-01T12:00:00.000Z",
    updatedAt: "2026-07-01T12:00:00.000Z",
    ...overrides,
  };
}

function fsDependency(predecessorTaskId: string, successorTaskId: string): Dependency {
  return {
    id: `${predecessorTaskId}-${successorTaskId}`,
    projectId: "project",
    predecessorTaskId,
    successorTaskId,
    type: "FS",
    lagDays: 0,
    createdAt: "2026-07-01T12:00:00.000Z",
    updatedAt: "2026-07-01T12:00:00.000Z",
  };
}

test("expands a started overdue task through the status date and cascades successors", () => {
  const tasks = [
    makeTask({ id: "started", actualStart: "2026-07-01", percentComplete: 60, status: "in_progress" }),
    makeTask({ id: "successor", plannedStart: "2026-07-06", plannedDurationDays: 2 }),
    makeTask({ id: "unrelated", plannedStart: "2026-07-20", plannedDurationDays: 2 }),
  ];

  const reconciled = reconcileOverdueForecast(
    { tasks, dependencies: [fsDependency("started", "successor")] },
    "2026-07-10",
  );
  const byId = new Map(reconciled.map((task) => [task.id, task]));

  assert.equal(byId.get("started")?.plannedStart, "2026-07-01");
  assert.equal(byId.get("started")?.plannedDurationDays, 8);
  assert.equal(byId.get("successor")?.plannedStart, "2026-07-13");
  assert.equal(byId.get("unrelated")?.plannedStart, "2026-07-20");
});

test("moves never-started overdue work from today while preserving duration", () => {
  const tasks = [
    makeTask({ id: "first" }),
    makeTask({ id: "second", plannedStart: "2026-07-06", plannedDurationDays: 2 }),
  ];

  const reconciled = reconcileOverdueForecast(
    { tasks, dependencies: [fsDependency("first", "second")] },
    "2026-07-10",
  );
  const byId = new Map(reconciled.map((task) => [task.id, task]));

  assert.equal(byId.get("first")?.plannedStart, "2026-07-10");
  assert.equal(byId.get("first")?.plannedDurationDays, 3);
  assert.equal(byId.get("second")?.plannedStart, "2026-07-15");
  assert.equal(byId.get("second")?.plannedDurationDays, 2);
});

test("handles completion, milestones, and weekend status dates", () => {
  const tasks = [
    makeTask({ id: "complete", actualEnd: "2026-07-03", percentComplete: 100, status: "done" }),
    makeTask({ id: "unstarted-milestone", type: "milestone", plannedDurationDays: 0 }),
    makeTask({
      id: "started-milestone",
      type: "milestone",
      plannedDurationDays: 0,
      actualStart: "2026-07-01",
      status: "in_progress",
    }),
  ];

  const reconciled = reconcileOverdueForecast({ tasks, dependencies: [] }, "2026-07-11");
  const byId = new Map(reconciled.map((task) => [task.id, task]));

  assert.equal(byId.get("complete")?.plannedStart, "2026-07-01");
  assert.equal(byId.get("unstarted-milestone")?.plannedStart, "2026-07-13");
  assert.equal(byId.get("started-milestone")?.plannedStart, "2026-07-01");
});

