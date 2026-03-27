import assert from "node:assert/strict";
import test from "node:test";

import { computeProjectPlan } from "@/domain/scheduler";
import type { Checkpoint, Dependency, Project, Task } from "@/domain/planner";

function makeProject(): Project {
  return {
    id: "project_1",
    name: "Planner",
    description: "",
    baselineCapturedAt: null,
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
    baselinePlannedStart: null,
    baselinePlannedEnd: null,
    baselinePlannedDurationDays: null,
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

function makeCheckpoint(checkpoint: Partial<Checkpoint> & Pick<Checkpoint, "id" | "taskId" | "name">): Checkpoint {
  return {
    percentComplete: 0,
    weightPoints: 1,
    sortOrder: 0,
    createdAt: "2026-03-18T00:00:00.000Z",
    updatedAt: "2026-03-18T00:00:00.000Z",
    ...checkpoint,
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
      checkpoints: [],
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
      checkpoints: [],
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
      checkpoints: [],
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
      checkpoints: [],
    });

    const summary = plan.tasks.find((task) => task.id === "summary");
  assert.equal(summary?.computedPlannedStart, "2026-03-16");
  assert.equal(summary?.computedPlannedEnd, "2026-03-20");
  assert.equal(summary?.rolledUpEffortDays, 5);
  assert.equal(plan.projectPercentComplete, 0);
});

test("rolls up baseline spans for summary tasks", () => {
  const plan = computeProjectPlan({
    project: makeProject(),
    tasks: [
      makeTask({ id: "summary", name: "Build", type: "summary", plannedMode: null, plannedStart: null, plannedDurationDays: null }),
      makeTask({
        id: "a",
        name: "A",
        parentId: "summary",
        sortOrder: 10,
        plannedStart: "2026-03-20",
        plannedDurationDays: 3,
        baselinePlannedStart: "2026-03-16",
        baselinePlannedDurationDays: 3,
      }),
      makeTask({
        id: "b",
        name: "B",
        parentId: "summary",
        sortOrder: 20,
        plannedStart: "2026-03-25",
        plannedDurationDays: 2,
        baselinePlannedStart: "2026-03-19",
        baselinePlannedDurationDays: 2,
      }),
    ],
    dependencies: [],
    checkpoints: [],
  });

  const summary = plan.tasks.find((task) => task.id === "summary");
  assert.equal(summary?.computedBaselinePlannedStart, "2026-03-16");
  assert.equal(summary?.computedBaselinePlannedEnd, "2026-03-20");
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
    checkpoints: [],
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
      checkpoints: [],
    });

    assert.equal(plan.issues.some((issue) => issue.message.includes("cycle")), true);
  });

test("derives in-progress and done statuses from execution data", () => {
  const plan = computeProjectPlan({
    project: makeProject(),
    tasks: [
      makeTask({ id: "in_progress", name: "In progress", percentComplete: 100 }),
      makeTask({ id: "done", name: "Done", percentComplete: 0, actualEnd: "2026-03-16" }),
    ],
    dependencies: [],
    checkpoints: [],
  });

  const started = plan.tasks.find((task) => task.id === "in_progress");
  const done = plan.tasks.find((task) => task.id === "done");
  assert.equal(started?.rolledUpStatus, "in_progress");
  assert.equal(done?.rolledUpStatus, "done");
});

test("uses actual start as the forecast anchor for started tasks", () => {
  const plan = computeProjectPlan({
    project: makeProject(),
    tasks: [
      makeTask({
        id: "started",
        name: "Started",
        plannedStart: "2026-03-16",
        plannedDurationDays: 3,
        actualStart: "2026-03-18",
        percentComplete: 40,
      }),
    ],
    dependencies: [],
    checkpoints: [],
  });

  const started = plan.tasks.find((task) => task.id === "started");
  assert.equal(started?.computedPlannedStart, "2026-03-18");
  assert.equal(started?.computedPlannedEnd, "2026-03-20");
});

test("rolls in-progress state to the parent summary without changing scheduling", () => {
  const plan = computeProjectPlan({
    project: makeProject(),
    tasks: [
      makeTask({ id: "summary", name: "Build", type: "summary", plannedMode: null, plannedStart: null, plannedDurationDays: null }),
      makeTask({ id: "a", name: "Started child", parentId: "summary", sortOrder: 10, percentComplete: 50, plannedStart: "2026-03-16", plannedDurationDays: 2 }),
      makeTask({ id: "b", name: "Open child", parentId: "summary", sortOrder: 20, plannedStart: "2026-03-18", plannedDurationDays: 2 }),
    ],
    dependencies: [],
    checkpoints: [],
  });

  const summary = plan.tasks.find((task) => task.id === "summary");
  const startedChild = plan.tasks.find((task) => task.id === "a");
  assert.equal(startedChild?.computedPlannedStart, "2026-03-16");
  assert.equal(summary?.rolledUpStatus, "in_progress");
});

test("does not roll up an actual end to a summary until all children are complete", () => {
  const plan = computeProjectPlan({
    project: makeProject(),
    tasks: [
      makeTask({ id: "summary", name: "Phase", type: "summary", plannedMode: null, plannedStart: null, plannedDurationDays: null }),
      makeTask({
        id: "done_child",
        name: "Done child",
        parentId: "summary",
        sortOrder: 10,
        plannedStart: "2026-03-16",
        plannedDurationDays: 1,
        actualStart: "2026-03-16",
        actualEnd: "2026-03-16",
      }),
      makeTask({
        id: "open_child",
        name: "Open child",
        parentId: "summary",
        sortOrder: 20,
        plannedStart: "2026-03-17",
        plannedDurationDays: 2,
      }),
    ],
    dependencies: [],
    checkpoints: [],
  });

  const summary = plan.tasks.find((task) => task.id === "summary");
  assert.equal(summary?.computedActualStart, "2026-03-16");
  assert.equal(summary?.computedActualEnd, null);
});

test("derives task progress from checkpoints without changing task scheduling", () => {
  const plan = computeProjectPlan({
    project: makeProject(),
    tasks: [
      makeTask({ id: "task", name: "Build automation", plannedStart: "2026-03-16", plannedDurationDays: 5 }),
    ],
    dependencies: [],
    checkpoints: [
      makeCheckpoint({ id: "checkpoint_1", taskId: "task", name: "Map fields", percentComplete: 100, weightPoints: 1, sortOrder: 10 }),
      makeCheckpoint({ id: "checkpoint_2", taskId: "task", name: "Handle errors", percentComplete: 50, weightPoints: 3, sortOrder: 20 }),
    ],
  });

  const task = plan.tasks.find((item) => item.id === "task");
  assert.equal(task?.computedPlannedStart, "2026-03-16");
  assert.equal(task?.computedPlannedEnd, "2026-03-20");
  assert.equal(task?.rolledUpPercentComplete, 63);
  assert.equal(task?.rolledUpStatus, "in_progress");
  assert.equal(task?.isProgressDerived, true);
  assert.deepEqual(task?.checkpoints.map((checkpoint) => checkpoint.id), ["checkpoint_1", "checkpoint_2"]);
});

test("sorts sibling rows by displayed start date within each parent group", () => {
  const plan = computeProjectPlan({
    project: makeProject(),
    tasks: [
      makeTask({ id: "summary", name: "Phase", type: "summary", plannedMode: null, plannedStart: null, plannedDurationDays: null }),
      makeTask({ id: "late", name: "Late", parentId: "summary", sortOrder: 10, plannedStart: "2026-03-20", plannedDurationDays: 2 }),
      makeTask({ id: "early", name: "Early", parentId: "summary", sortOrder: 30, plannedStart: "2026-03-16", plannedDurationDays: 1 }),
      makeTask({ id: "same_day_b", name: "Same day B", parentId: "summary", sortOrder: 20, plannedStart: "2026-03-18", plannedDurationDays: 1 }),
      makeTask({ id: "same_day_a", name: "Same day A", parentId: "summary", sortOrder: 5, plannedStart: "2026-03-18", plannedDurationDays: 1 }),
    ],
    dependencies: [],
    checkpoints: [],
  });

  const summary = plan.tasks.find((item) => item.id === "summary");
  assert.deepEqual(summary?.childIds, ["early", "same_day_a", "same_day_b", "late"]);
  assert.deepEqual(plan.rows.map((row) => row.taskId), ["summary", "early", "same_day_a", "same_day_b", "late"]);
});

test("sorts siblings by computed forecast start when stored starts are stale", () => {
  const plan = computeProjectPlan({
    project: makeProject(),
    tasks: [
      makeTask({ id: "summary", name: "Phase", type: "summary", plannedMode: null, plannedStart: null, plannedDurationDays: null }),
      makeTask({ id: "anchor", name: "Anchor", parentId: "summary", sortOrder: 10, plannedStart: "2026-03-16", plannedDurationDays: 3 }),
      makeTask({ id: "blocked", name: "Blocked", parentId: "summary", sortOrder: 20, plannedStart: "2026-03-16", plannedDurationDays: 1 }),
      makeTask({ id: "free", name: "Free", parentId: "summary", sortOrder: 30, plannedStart: "2026-03-17", plannedDurationDays: 1 }),
    ],
    dependencies: [
      makeDependency({ id: "dep_1", predecessorTaskId: "anchor", successorTaskId: "blocked", type: "FS" }),
    ],
    checkpoints: [],
  });

  const summary = plan.tasks.find((item) => item.id === "summary");
  const blocked = plan.tasks.find((item) => item.id === "blocked");
  const free = plan.tasks.find((item) => item.id === "free");

  assert.equal(blocked?.plannedStart, "2026-03-16");
  assert.equal(blocked?.computedPlannedStart, "2026-03-18");
  assert.equal(free?.computedPlannedStart, "2026-03-17");
  assert.deepEqual(summary?.childIds, ["anchor", "free", "blocked"]);
});
