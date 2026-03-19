import assert from "node:assert/strict";
import test from "node:test";

import { computeProjectPlan } from "@/domain/scheduler";
import type { Dependency, Project, Task } from "@/domain/planner";

function makeProject(): Project {
  return {
    id: "project_1",
    name: "Planner",
    description: "",
    createdAt: "2026-03-18T00:00:00.000Z",
    updatedAt: "2026-03-18T00:00:00.000Z",
  };
}

function makeTask(task: Partial<Task> & Pick<Task, "id" | "name">): Task {
  return {
    projectId: "project_1",
    parentId: null,
    notes: "",
    sortOrder: 0,
    type: "task",
    plannedMode: "start_duration",
    plannedStart: "2026-03-16",
    plannedEnd: null,
    plannedDurationDays: 1,
    actualStart: null,
    actualEnd: null,
    status: "not_started",
    percentComplete: 0,
    isExpanded: true,
    createdAt: "2026-03-18T00:00:00.000Z",
    updatedAt: "2026-03-18T00:00:00.000Z",
    ...task,
  };
}

function makeDependency(dependency: Partial<Dependency> & Pick<Dependency, "id" | "predecessorTaskId" | "successorTaskId">): Dependency {
  return {
    projectId: "project_1",
    type: "FS",
    lagDays: 0,
    createdAt: "2026-03-18T00:00:00.000Z",
    updatedAt: "2026-03-18T00:00:00.000Z",
    ...dependency,
  };
}

test("supports finish-to-start rescheduling", () => {
    const plan = computeProjectPlan({
      project: makeProject(),
      tasks: [
        makeTask({ id: "a", name: "A", plannedStart: "2026-03-16", plannedDurationDays: 3 }),
        makeTask({ id: "b", name: "B", plannedStart: "2026-03-16", plannedDurationDays: 1 }),
      ],
      dependencies: [makeDependency({ id: "dep_1", predecessorTaskId: "a", successorTaskId: "b", type: "FS" })],
    });

    const taskB = plan.tasks.find((task) => task.id === "b");
    assert.equal(taskB?.computedPlannedStart, "2026-03-18");
  });

test("supports start-to-start dependencies", () => {
    const plan = computeProjectPlan({
      project: makeProject(),
      tasks: [
        makeTask({ id: "a", name: "A", plannedStart: "2026-03-16", plannedDurationDays: 3 }),
        makeTask({ id: "b", name: "B", plannedStart: "2026-03-14", plannedDurationDays: 2 }),
      ],
      dependencies: [makeDependency({ id: "dep_1", predecessorTaskId: "a", successorTaskId: "b", type: "SS" })],
    });

    const taskB = plan.tasks.find((task) => task.id === "b");
    assert.equal(taskB?.computedPlannedStart, "2026-03-16");
  });

test("supports lag offsets", () => {
    const plan = computeProjectPlan({
      project: makeProject(),
      tasks: [
        makeTask({ id: "a", name: "A", plannedStart: "2026-03-16", plannedDurationDays: 1 }),
        makeTask({ id: "b", name: "B", plannedStart: "2026-03-16", plannedDurationDays: 1 }),
      ],
      dependencies: [makeDependency({ id: "dep_1", predecessorTaskId: "a", successorTaskId: "b", type: "FS", lagDays: 2 })],
    });

    const taskB = plan.tasks.find((task) => task.id === "b");
    assert.equal(taskB?.computedPlannedStart, "2026-03-18");
  });

test("rolls up summary task spans and effort", () => {
  const plan = computeProjectPlan({
      project: makeProject(),
      tasks: [
        makeTask({ id: "summary", name: "Build", type: "summary", plannedMode: null, plannedStart: null, plannedDurationDays: null }),
        makeTask({ id: "a", name: "A", parentId: "summary", sortOrder: 10, plannedStart: "2026-03-16", plannedDurationDays: 3 }),
        makeTask({ id: "b", name: "B", parentId: "summary", sortOrder: 20, plannedStart: "2026-03-19", plannedDurationDays: 2 }),
      ],
      dependencies: [],
    });

    const summary = plan.tasks.find((task) => task.id === "summary");
  assert.equal(summary?.computedPlannedStart, "2026-03-16");
  assert.equal(summary?.computedPlannedEnd, "2026-03-20");
  assert.equal(summary?.rolledUpEffortDays, 5);
  assert.equal(plan.projectPercentComplete, 0);
});

test("computes project percent complete from weighted root effort", () => {
  const plan = computeProjectPlan({
    project: makeProject(),
    tasks: [
      makeTask({ id: "summary", name: "Build", type: "summary", plannedMode: null, plannedStart: null, plannedDurationDays: null }),
      makeTask({ id: "a", name: "A", parentId: "summary", sortOrder: 10, plannedStart: "2026-03-16", plannedDurationDays: 3, percentComplete: 100 }),
      makeTask({ id: "b", name: "B", parentId: "summary", sortOrder: 20, plannedStart: "2026-03-19", plannedDurationDays: 1, percentComplete: 0 }),
      makeTask({ id: "c", name: "C", plannedStart: "2026-03-20", plannedDurationDays: 2, percentComplete: 50 }),
    ],
    dependencies: [],
  });

  assert.equal(plan.projectPercentComplete, 67);
});

test("flags cycles", () => {
    const plan = computeProjectPlan({
      project: makeProject(),
      tasks: [
        makeTask({ id: "a", name: "A" }),
        makeTask({ id: "b", name: "B" }),
      ],
      dependencies: [
        makeDependency({ id: "dep_1", predecessorTaskId: "a", successorTaskId: "b" }),
        makeDependency({ id: "dep_2", predecessorTaskId: "b", successorTaskId: "a" }),
      ],
    });

    assert.equal(plan.issues.some((issue) => issue.message.includes("cycle")), true);
  });

test("respects explicitly blocked and done statuses", () => {
  const plan = computeProjectPlan({
    project: makeProject(),
    tasks: [
      makeTask({ id: "blocked", name: "Blocked", status: "blocked", percentComplete: 40 }),
      makeTask({ id: "done", name: "Done", status: "done", percentComplete: 0 }),
    ],
    dependencies: [],
  });

  const blocked = plan.tasks.find((task) => task.id === "blocked");
  const done = plan.tasks.find((task) => task.id === "done");
  assert.equal(blocked?.rolledUpStatus, "blocked");
  assert.equal(done?.rolledUpStatus, "done");
});

test("rolls blocked state to the parent summary without changing scheduling", () => {
  const plan = computeProjectPlan({
    project: makeProject(),
    tasks: [
      makeTask({ id: "summary", name: "Build", type: "summary", plannedMode: null, plannedStart: null, plannedDurationDays: null }),
      makeTask({ id: "a", name: "Blocked child", parentId: "summary", sortOrder: 10, status: "blocked", plannedStart: "2026-03-16", plannedDurationDays: 2 }),
      makeTask({ id: "b", name: "Open child", parentId: "summary", sortOrder: 20, plannedStart: "2026-03-18", plannedDurationDays: 2 }),
    ],
    dependencies: [],
  });

  const summary = plan.tasks.find((task) => task.id === "summary");
  const blockedChild = plan.tasks.find((task) => task.id === "a");
  assert.equal(blockedChild?.computedPlannedStart, "2026-03-16");
  assert.equal(summary?.rolledUpStatus, "blocked");
});
