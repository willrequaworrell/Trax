import assert from "node:assert/strict";
import test from "node:test";

import type { Dependency, Project, Task } from "@/domain/planner";
import { duplicateProjectSnapshot } from "@/server/services/project-duplication";

function makeProject(): Project {
  return {
    id: "project_source",
    name: "Source Plan",
    description: "Template candidate",
    createdAt: "2026-03-18T00:00:00.000Z",
    updatedAt: "2026-03-18T00:00:00.000Z",
  };
}

function makeTask(task: Partial<Task> & Pick<Task, "id" | "name">): Task {
  return {
    projectId: "project_source",
    parentId: null,
    notes: "",
    sortOrder: 0,
    type: "task",
    plannedMode: "start_duration",
    plannedStart: "2026-03-16",
    plannedEnd: null,
    plannedDurationDays: 2,
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
    projectId: "project_source",
    type: "FS",
    lagDays: 0,
    createdAt: "2026-03-18T00:00:00.000Z",
    updatedAt: "2026-03-18T00:00:00.000Z",
    ...dependency,
  };
}

test("duplicates tasks and dependencies with remapped ids", () => {
  let sequence = 0;
  const duplicated = duplicateProjectSnapshot(
    {
      project: makeProject(),
      tasks: [
        makeTask({ id: "summary", name: "Build", type: "summary", plannedMode: null, plannedStart: null, plannedDurationDays: null }),
        makeTask({ id: "task_a", name: "A", parentId: "summary", sortOrder: 10, percentComplete: 25 }),
        makeTask({ id: "task_b", name: "B", parentId: "summary", sortOrder: 20 }),
      ],
      dependencies: [makeDependency({ id: "dep_1", predecessorTaskId: "task_a", successorTaskId: "task_b" })],
    },
    {
      projectId: "project_copy",
      now: "2026-03-19T00:00:00.000Z",
      name: "Source Plan Copy",
      createId: (prefix) => `${prefix}_${++sequence}`,
    },
  );

  assert.equal(duplicated.project.id, "project_copy");
  assert.equal(duplicated.project.name, "Source Plan Copy");
  assert.equal(duplicated.tasks.length, 3);
  assert.equal(duplicated.dependencies.length, 1);
  assert.equal(duplicated.tasks.every((task) => task.projectId === "project_copy"), true);
  assert.equal(duplicated.tasks.some((task) => task.id === "task_a"), false);
  assert.equal(duplicated.tasks.some((task) => task.id === "task_b"), false);

  const summary = duplicated.tasks.find((task) => task.name === "Build");
  const taskA = duplicated.tasks.find((task) => task.name === "A");
  const taskB = duplicated.tasks.find((task) => task.name === "B");
  assert.ok(summary);
  assert.ok(taskA);
  assert.ok(taskB);
  assert.equal(taskA?.parentId, summary?.id);
  assert.equal(taskB?.parentId, summary?.id);
  assert.equal(duplicated.dependencies[0]?.predecessorTaskId, taskA?.id);
  assert.equal(duplicated.dependencies[0]?.successorTaskId, taskB?.id);
});
