import assert from "node:assert/strict";
import test from "node:test";

import type { Task } from "@/domain/planner";
import { findTaskNormalizationUpdates, normalizeStoredTaskStatus } from "@/server/services/task-normalization";

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
    plannedDurationDays: 2,
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

test("normalizes not-started tasks with progress into in-progress", () => {
  const normalized = normalizeStoredTaskStatus(
    makeTask({
      id: "task_1",
      name: "Progressed task",
      percentComplete: 35,
      status: "not_started",
    }),
  );

  assert.equal(normalized, "in_progress");
});

test("finds status fixes without rewriting hierarchy", () => {
  const updates = findTaskNormalizationUpdates([
    makeTask({
      id: "summary_1",
      name: "Nested summary",
      type: "summary",
      plannedMode: null,
      plannedStart: null,
      plannedDurationDays: null,
      parentId: "summary_parent",
    }),
    makeTask({
      id: "task_2",
      name: "Progressed leaf",
      percentComplete: 10,
      status: "not_started",
    }),
  ]);

  assert.equal(updates.some((update) => update.id === "summary_1"), false);
  assert.equal(
    updates.some((update) => update.id === "task_2" && update.values.status === "in_progress"),
    true,
  );
});
