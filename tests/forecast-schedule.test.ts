import assert from "node:assert/strict";
import test from "node:test";

import type { Dependency, Task } from "@/domain/planner";
import { cascadeForecastFromSeeds, reconcileOverdueForecast, reflowDownstreamForecast } from "@/server/services/forecast-schedule";

function makeTask(overrides: Partial<Task> & Pick<Task, "id">): Task {
  return {
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
    forecastNeedsReview: false,
    forecastLocked: false,
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

test("reflows unstarted descendants with baseline durations and preserves execution boundaries", () => {
  const tasks = [
    makeTask({
      id: "anchor",
      plannedMode: "start_end",
      plannedStart: "2026-08-03",
      plannedEnd: "2026-08-03",
      plannedDurationDays: 1,
    }),
    makeTask({
      id: "review",
      plannedMode: "start_end",
      plannedStart: "2026-08-03",
      plannedEnd: "2026-08-17",
      plannedDurationDays: 11,
      baselinePlannedStart: "2026-07-01",
      baselinePlannedEnd: "2026-07-01",
      baselinePlannedDurationDays: 1,
    }),
    makeTask({
      id: "next",
      plannedStart: "2026-08-18",
      plannedDurationDays: 6,
      baselinePlannedStart: "2026-07-02",
      baselinePlannedDurationDays: 2,
    }),
    makeTask({
      id: "started-boundary",
      plannedStart: "2026-07-21",
      plannedDurationDays: 8,
      baselinePlannedDurationDays: 1,
      actualStart: "2026-07-21",
      percentComplete: 25,
      status: "in_progress",
    }),
    makeTask({
      id: "after-boundary",
      plannedStart: "2026-08-20",
      plannedDurationDays: 4,
      baselinePlannedDurationDays: 1,
    }),
    makeTask({ id: "unrelated", plannedStart: "2026-09-01", plannedDurationDays: 3 }),
  ];
  const dependencies = [
    fsDependency("anchor", "review"),
    fsDependency("review", "next"),
    fsDependency("anchor", "started-boundary"),
    fsDependency("started-boundary", "after-boundary"),
  ];

  const reflowed = reflowDownstreamForecast({ tasks, dependencies }, "anchor");
  const byId = new Map(reflowed.map((task) => [task.id, task]));

  assert.equal(byId.get("review")?.plannedStart, "2026-08-04");
  assert.equal(byId.get("review")?.plannedDurationDays, 1);
  assert.equal(byId.get("next")?.plannedStart, "2026-08-05");
  assert.equal(byId.get("next")?.plannedDurationDays, 2);
  assert.equal(byId.get("started-boundary")?.plannedStart, "2026-07-21");
  assert.equal(byId.get("started-boundary")?.plannedDurationDays, 8);
  assert.equal(byId.get("after-boundary")?.plannedStart, "2026-07-31");
  assert.equal(byId.get("after-boundary")?.plannedDurationDays, 1);
  assert.equal(byId.get("unrelated")?.plannedStart, "2026-09-01");
});

test("rejects downstream reflow when the affected dependency graph contains a cycle", () => {
  const tasks = [makeTask({ id: "anchor" }), makeTask({ id: "a" }), makeTask({ id: "b" })];
  const dependencies = [
    fsDependency("anchor", "a"),
    fsDependency("a", "b"),
    fsDependency("b", "a"),
  ];

  assert.throws(
    () => reflowDownstreamForecast({ tasks, dependencies }, "anchor"),
    /contain a cycle/,
  );
});


test("automatic cascade pulls a chain earlier with current estimates and leaves unrelated and started work intact", () => {
  const tasks = [
    makeTask({ id: "development", actualStart: "2026-10-12", actualEnd: "2026-10-12", percentComplete: 100 }),
    makeTask({ id: "testing", plannedStart: "2026-10-15", plannedDurationDays: 2, baselinePlannedDurationDays: 1 }),
    makeTask({ id: "deployment", type: "milestone", plannedStart: "2026-10-19", plannedDurationDays: 0 }),
    makeTask({ id: "unrelated", plannedStart: "2026-10-22" }),
    makeTask({ id: "started", actualStart: "2026-10-15", percentComplete: 20 }),
  ];
  const dependencies = [fsDependency("development", "testing"), fsDependency("testing", "deployment"), fsDependency("development", "started")];
  const automatic = cascadeForecastFromSeeds({ tasks, dependencies }, ["development"], { automatic: true, statusDate: "2026-10-12" });
  assert.equal(automatic[1].plannedStart, "2026-10-13");
  assert.equal(automatic[1].plannedDurationDays, 2);
  assert.equal(automatic[2].plannedStart, "2026-10-15");
  assert.deepEqual(automatic[3], tasks[3]);
  assert.deepEqual(automatic[4], tasks[4]);
  assert.equal(automatic[1].baselinePlannedDurationDays, 1);
  const manual = cascadeForecastFromSeeds({ tasks, dependencies }, ["development"]);
  assert.equal(manual[1].plannedStart, "2026-10-15");
  assert.equal(manual[2].plannedStart, "2026-10-19");
});

test("automatic cascade respects the latest predecessor, lags, weekends, fixed dates and the status date", () => {
  const tasks = [
    makeTask({ id: "development", plannedStart: "2026-10-12", plannedDurationDays: 1 }),
    makeTask({ id: "approval", plannedStart: "2026-10-16", plannedDurationDays: 1 }),
    makeTask({ id: "testing", plannedStart: "2026-10-22", plannedDurationDays: 2 }),
    makeTask({ id: "deployment", type: "milestone", plannedStart: "2026-10-26", plannedDurationDays: 0, forecastLocked: true }),
  ];
  const dependencies = [fsDependency("development", "testing"), { ...fsDependency("approval", "testing"), lagDays: 1 }, fsDependency("testing", "deployment")];
  const next = cascadeForecastFromSeeds({ tasks, dependencies }, ["development"], { automatic: true });
  assert.equal(next[2].plannedStart, "2026-10-20");
  assert.deepEqual(next[3], tasks[3]);
  const today = cascadeForecastFromSeeds({ tasks, dependencies }, ["development"], { automatic: true, statusDate: "2026-10-23" });
  assert.equal(today[2].plannedStart, "2026-10-23");
});

test("automatic scheduling honors SS, FF and SF constraints with current durations", () => {
  for (const [type, expected] of [["SS", "2026-10-13"], ["FF", "2026-10-14"], ["SF", "2026-10-12"]] as const) {
    const tasks = [makeTask({ id: "a", plannedStart: "2026-10-12", plannedDurationDays: 3 }), makeTask({ id: "b", plannedStart: "2026-10-26", plannedDurationDays: 2 })];
    const next = cascadeForecastFromSeeds({ tasks, dependencies: [{ ...fsDependency("a", "b"), type, lagDays: 1 }] }, ["a"], { automatic: true });
    assert.equal(next[1].plannedStart, expected);
  }
});

test("overdue reconciliation marks forecasts for review without rewriting fixed dates or actuals", () => {
  const tasks = [makeTask({ id: "started", actualStart: "2026-07-01", percentComplete: 60 }), makeTask({ id: "fixed", forecastLocked: true })];
  const next = reconcileOverdueForecast({ tasks, dependencies: [] }, "2026-07-10");
  assert.equal(next[0].forecastNeedsReview, true);
  assert.equal(next[0].actualStart, "2026-07-01");
  assert.deepEqual(next[1], tasks[1]);
  const tomorrow = reconcileOverdueForecast({ tasks: next, dependencies: [] }, "2026-07-13");
  assert.equal(tomorrow[0].forecastNeedsReview, true);
});

test("automatic scheduling rejects cycles before returning partially changed forecasts", () => {
  assert.throws(() => cascadeForecastFromSeeds({ tasks: [makeTask({ id: "a" }), makeTask({ id: "b" })], dependencies: [fsDependency("a", "b"), fsDependency("b", "a")] }, ["a"], { automatic: true }), /cycle/);
});
