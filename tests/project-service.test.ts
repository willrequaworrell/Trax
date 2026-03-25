import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { checkpoints, dependencies, pendingDeleteActions, projects, tasks } from "@/server/db/schema";
import { getDb } from "@/server/db/client";
import { projectRepository } from "@/server/repositories/project-repository";
import * as projectService from "@/server/services/project-service";
import { POST as freezeBaselineRoute } from "@/app/api/projects/[projectId]/freeze-baseline/route";
import { POST as rebaseProjectRoute } from "@/app/api/projects/[projectId]/rebase/route";
import { GET as getProjectRoute } from "@/app/api/projects/[projectId]/route";
import { GET as getProjectsRoute } from "@/app/api/projects/route";
import { PATCH as patchTaskRoute } from "@/app/api/tasks/[taskId]/route";
import { POST as wrapTaskRoute } from "@/app/api/tasks/[taskId]/wrap/route";
import { POST as undoRoute } from "@/app/api/undo/[undoId]/route";
import type { Task } from "@/domain/planner";

process.env.NODE_ENV = "test";
process.env.ALLOWED_EMAIL = "owner@example.com";
process.env.AUTH_SECRET = "test-secret";
process.env.AUTH_GOOGLE_ID = "test-google-id";
process.env.AUTH_GOOGLE_SECRET = "test-google-secret";
process.env.TRAXLY_TEST_AUTH_EMAIL = "owner@example.com";
process.env.DATABASE_URL = `pglite://${path.join(os.tmpdir(), `traxly-tests-${process.pid}`)}`;

function makeTask(task: Partial<Task> & Pick<Task, "id" | "name" | "projectId">): Task {
  return {
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

async function resetDatabase() {
  const db = await getDb();
  await db.delete(pendingDeleteActions);
  await db.delete(checkpoints);
  await db.delete(dependencies);
  await db.delete(tasks);
  await db.delete(projects);
}

async function makeProject(name: string) {
  const plan = await projectService.createProject({ name, description: "" });
  assert.ok(plan);
  return plan;
}

type ProjectSnapshot = NonNullable<Awaited<ReturnType<typeof projectRepository.getProjectSnapshot>>>;

async function withMockedSnapshot(projectId: string, snapshot: ProjectSnapshot, run: () => Promise<void>) {
  const original = projectRepository.getProjectSnapshot.bind(projectRepository);

  projectRepository.getProjectSnapshot = (async (requestedProjectId: string) => {
    if (requestedProjectId === projectId) {
      return snapshot;
    }

    return original(requestedProjectId);
  }) as typeof projectRepository.getProjectSnapshot;

  try {
    await run();
  } finally {
    projectRepository.getProjectSnapshot = original;
  }
}

test.beforeEach(async () => {
  process.env.TRAXLY_TEST_AUTH_EMAIL = "owner@example.com";
  projectService.__testUtils.setNowOverride(null);
  await resetDatabase();
});

test("rejects nonexistent parent updates", async () => {
  const plan = await makeProject("nonexistent-parent");
  const created = await projectService.createTask(plan.project.id, {
    name: "Leaf",
    type: "task",
  });

  await assert.rejects(
    projectService.updateTask(created!.taskId, { parentId: "missing_parent" }),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "validation_error" &&
      error.message.includes("Parent task was not found"),
  );
});

test("rejects parents from another project", async () => {
  const sourcePlan = await makeProject("source-parent-project");
  const foreignPlan = await makeProject("foreign-parent-project");
  const created = await projectService.createTask(sourcePlan.project.id, {
    name: "Leaf",
    type: "task",
  });
  const foreignSummary = await projectService.createTask(foreignPlan.project.id, {
    name: "Section",
    type: "summary",
  });

  await assert.rejects(
    projectService.updateTask(created!.taskId, { parentId: foreignSummary!.taskId }),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "validation_error" &&
      error.message.includes("Parent task was not found"),
  );
});

test("rejects non-summary parents", async () => {
  const plan = await makeProject("non-summary-parent");
  const parent = await projectService.createTask(plan.project.id, {
    name: "Leaf parent",
    type: "task",
  });
  const child = await projectService.createTask(plan.project.id, {
    name: "Child",
    type: "task",
  });

  await assert.rejects(
    projectService.updateTask(child!.taskId, { parentId: parent!.taskId }),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "validation_error" &&
      error.message.includes("summary section"),
  );
});

test("rejects self-parent updates", async () => {
  const plan = await makeProject("self-parent");
  const created = await projectService.createTask(plan.project.id, {
    name: "Self",
    type: "task",
  });

  await assert.rejects(
    projectService.updateTask(created!.taskId, { parentId: created!.taskId }),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "validation_error" &&
      error.message.includes("own parent"),
  );
});

test("rejects descendant-parent cycles in hierarchy validation", async () => {
  const projectId = "project_cycle_validation";
  const hierarchy = [
    makeTask({
      id: "summary_root",
      projectId,
      name: "Root",
      type: "summary",
      plannedMode: null,
      plannedStart: null,
      plannedDurationDays: null,
    }),
    makeTask({
      id: "summary_child",
      projectId,
      name: "Child",
      type: "summary",
      parentId: "summary_root",
      plannedMode: null,
      plannedStart: null,
      plannedDurationDays: null,
    }),
  ];

  assert.throws(
    () => projectService.__testUtils.validateTaskParent(hierarchy, "summary_root", "summary_child"),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "validation_error" &&
      error.message.includes("descendants"),
  );
});

test("allows valid moves under a summary section", async () => {
  const plan = await makeProject("valid-parent-move");
  const summary = await projectService.createTask(plan.project.id, {
    name: "Section",
    type: "summary",
  });
  const leaf = await projectService.createTask(plan.project.id, {
    name: "Leaf",
    type: "task",
  });

  const nextPlan = await projectService.updateTask(leaf!.taskId, { parentId: summary!.taskId });
  const updated = nextPlan?.tasks.find((task) => task.id === leaf!.taskId);

  assert.equal(updated?.parentId, summary!.taskId);
});

test("allows nested summary sections", async () => {
  const plan = await makeProject("nested-summary-sections");
  const parent = await projectService.createTask(plan.project.id, {
    name: "Phase",
    type: "summary",
  });

  const child = await projectService.createTask(plan.project.id, {
    name: "Workstream",
    type: "summary",
    parentId: parent!.taskId,
  });

  const childTask = await projectService.createTask(plan.project.id, {
    name: "Deliverable",
    type: "task",
    parentId: child!.taskId,
    plannedStart: "2026-03-16",
    plannedDurationDays: 3,
  });

  const nextPlan = await projectService.getProjectPlan(plan.project.id);
  const storedChild = nextPlan?.tasks.find((task) => task.id === child!.taskId);
  const storedParent = nextPlan?.tasks.find((task) => task.id === parent!.taskId);

  assert.equal(storedChild?.parentId, parent!.taskId);
  assert.deepEqual(storedParent?.childIds, [child!.taskId]);
  assert.deepEqual(storedChild?.childIds, [childTask!.taskId]);
  assert.equal(storedParent?.computedPlannedStart, "2026-03-16");
  assert.equal(storedChild?.computedPlannedEnd, "2026-03-18");
});

test("allows moving a summary under another summary", async () => {
  const plan = await makeProject("move-summary-under-summary");
  const root = await projectService.createTask(plan.project.id, {
    name: "Root",
    type: "summary",
  });
  const child = await projectService.createTask(plan.project.id, {
    name: "Child",
    type: "summary",
  });

  const nextPlan = await projectService.updateTask(child!.taskId, { parentId: root!.taskId });
  const updated = nextPlan?.tasks.find((task) => task.id === child!.taskId);

  assert.equal(updated?.parentId, root!.taskId);
});

test("normalizes start/end tasks with progress into in-progress", async () => {
  const plan = await makeProject("start-end-progress");
  const created = await projectService.createTask(plan.project.id, {
    name: "Scheduled task",
    type: "task",
    plannedMode: "start_end",
    plannedStart: "2026-03-16",
    plannedEnd: "2026-03-18",
  });

  await projectService.updateTask(created!.taskId, { percentComplete: 25 });
  const stored = await projectRepository.getTask(created!.taskId);

  assert.equal(stored?.status, "in_progress");
});

test("rejects converting a dependency-linked leaf task into a summary", async () => {
  const plan = await makeProject("reject-leaf-to-summary-with-dependencies");
  const predecessor = await projectService.createTask(plan.project.id, {
    name: "Predecessor",
    type: "task",
  });
  const successor = await projectService.createTask(plan.project.id, {
    name: "Successor",
    type: "task",
  });

  await projectService.createDependency(plan.project.id, {
    predecessorTaskId: predecessor!.taskId,
    successorTaskId: successor!.taskId,
    type: "FS",
    lagDays: 0,
  });

  await assert.rejects(
    projectService.updateTask(successor!.taskId, { type: "summary" }),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "validation_error" &&
      error.message.includes("Wrap the task in a section"),
  );
});

test("rejects converting a populated summary into a leaf task", async () => {
  const plan = await makeProject("reject-summary-to-leaf-with-children");
  const summary = await projectService.createTask(plan.project.id, {
    name: "Section",
    type: "summary",
  });
  await projectService.createTask(plan.project.id, {
    name: "Child task",
    type: "task",
    parentId: summary!.taskId,
  });

  await assert.rejects(
    projectService.updateTask(summary!.taskId, { type: "task" }),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "validation_error" &&
      error.message.includes("cannot be converted to leaf tasks"),
  );
});

test("normalizes start/end tasks with actual completion into done", async () => {
  const plan = await makeProject("start-end-done");
  const created = await projectService.createTask(plan.project.id, {
    name: "Scheduled task",
    type: "task",
    plannedMode: "start_end",
    plannedStart: "2026-03-16",
    plannedEnd: "2026-03-18",
  });

  await projectService.updateTask(created!.taskId, { actualEnd: "2026-03-18" });
  const stored = await projectRepository.getTask(created!.taskId);

  assert.equal(stored?.status, "done");
});

test("preserves start/end scheduling on task creation", async () => {
  const plan = await makeProject("start-end-create");
  const created = await projectService.createTask(plan.project.id, {
    name: "Due-date task",
    type: "task",
    plannedMode: "start_end",
    plannedStart: "2026-03-16",
    plannedEnd: "2026-03-20",
    plannedDurationDays: 5,
  });
  const stored = await projectRepository.getTask(created!.taskId);

  assert.equal(stored?.plannedMode, "start_end");
  assert.equal(stored?.plannedStart, "2026-03-16");
  assert.equal(stored?.plannedEnd, "2026-03-20");
});

test("clears planned end for start/duration tasks on creation", async () => {
  const plan = await makeProject("start-duration-create");
  const created = await projectService.createTask(plan.project.id, {
    name: "Duration task",
    type: "task",
    plannedMode: "start_duration",
    plannedStart: "2026-03-16",
    plannedEnd: "2026-03-20",
    plannedDurationDays: 3,
  });
  const stored = await projectRepository.getTask(created!.taskId);

  assert.equal(stored?.plannedMode, "start_duration");
  assert.equal(stored?.plannedEnd, null);
  assert.equal(stored?.plannedDurationDays, 3);
});

test("keeps milestone and summary create invariants", async () => {
  const plan = await makeProject("task-create-invariants");
  const summary = await projectService.createTask(plan.project.id, {
    name: "Section",
    type: "summary",
    plannedMode: "start_end",
    plannedStart: "2026-03-16",
    plannedEnd: "2026-03-20",
  });
  const milestone = await projectService.createTask(plan.project.id, {
    name: "Milestone",
    type: "milestone",
    plannedMode: "start_end",
    plannedStart: "2026-03-16",
    plannedEnd: "2026-03-20",
  });
  const storedSummary = await projectRepository.getTask(summary!.taskId);
  const storedMilestone = await projectRepository.getTask(milestone!.taskId);

  assert.equal(storedSummary?.plannedMode, null);
  assert.equal(storedSummary?.plannedStart, null);
  assert.equal(storedSummary?.plannedEnd, null);
  assert.equal(storedMilestone?.plannedMode, "start_duration");
  assert.equal(storedMilestone?.plannedEnd, null);
  assert.equal(storedMilestone?.plannedDurationDays, 0);
});

test("blocks projects with missing parents", async () => {
  const plan = await makeProject("missing-parent-project");
  const snapshot = await projectRepository.getProjectSnapshot(plan.project.id);

  assert.ok(snapshot);

  await withMockedSnapshot(
    plan.project.id,
    {
      ...snapshot,
      tasks: [
        ...snapshot.tasks,
        makeTask({
          id: "task_missing_parent",
          projectId: plan.project.id,
          name: "Broken task",
          parentId: "missing_summary",
        }),
      ],
    },
    async () => {
      await assert.rejects(
        projectService.getProjectPlan(plan.project.id),
        (error: unknown) =>
          error instanceof Error &&
          "code" in error &&
          error.code === "corrupted_project" &&
          "details" in error &&
          Array.isArray(error.details) &&
          error.details.some((detail) => detail.includes("missing parent task")),
      );
    },
  );
});

test("blocks projects with non-summary parents", async () => {
  const plan = await makeProject("leaf-parent-project");
  const snapshot = await projectRepository.getProjectSnapshot(plan.project.id);

  assert.ok(snapshot);

  await withMockedSnapshot(
    plan.project.id,
    {
      ...snapshot,
      tasks: [
        ...snapshot.tasks,
        makeTask({ id: "leaf_parent", projectId: plan.project.id, name: "Leaf parent", type: "task" }),
        makeTask({ id: "leaf_child", projectId: plan.project.id, name: "Leaf child", parentId: "leaf_parent" }),
      ],
    },
    async () => {
      await assert.rejects(
        projectService.getProjectPlan(plan.project.id),
        (error: unknown) =>
          error instanceof Error &&
          "code" in error &&
          error.code === "corrupted_project" &&
          "details" in error &&
          Array.isArray(error.details) &&
          error.details.some((detail) => detail.includes("not a summary section")),
      );
    },
  );
});

test("blocks projects with parent cycles", async () => {
  const plan = await makeProject("parent-cycle-project");
  const snapshot = await projectRepository.getProjectSnapshot(plan.project.id);

  assert.ok(snapshot);

  await withMockedSnapshot(
    plan.project.id,
    {
      ...snapshot,
      tasks: [
        ...snapshot.tasks,
        makeTask({
          id: "summary_a",
          projectId: plan.project.id,
          name: "Summary A",
          type: "summary",
          parentId: "summary_b",
          plannedMode: null,
          plannedStart: null,
          plannedDurationDays: null,
        }),
        makeTask({
          id: "summary_b",
          projectId: plan.project.id,
          name: "Summary B",
          type: "summary",
          parentId: "summary_a",
          plannedMode: null,
          plannedStart: null,
          plannedDurationDays: null,
        }),
      ],
    },
    async () => {
      await assert.rejects(
        projectService.getProjectPlan(plan.project.id),
        (error: unknown) =>
          error instanceof Error &&
          "code" in error &&
          error.code === "corrupted_project" &&
          "details" in error &&
          Array.isArray(error.details) &&
          error.details.some((detail) => detail.includes("parent cycle")),
      );
    },
  );
});

test("returns plans normally for valid projects", async () => {
  const plan = await makeProject("valid-project");
  await projectService.createTask(plan.project.id, {
    name: "Section",
    type: "summary",
  });

  const projectPlan = await projectService.getProjectPlan(plan.project.id);

  assert.ok(projectPlan);
  assert.equal(projectPlan?.project.id, plan.project.id);
});

test("task patch route returns validation errors for invalid parents", async () => {
  const plan = await makeProject("route-invalid-parent");
  const parent = await projectService.createTask(plan.project.id, {
    name: "Leaf parent",
    type: "task",
  });
  const child = await projectService.createTask(plan.project.id, {
    name: "Leaf child",
    type: "task",
  });

  const response = await patchTaskRoute(
    new Request("http://localhost/api/tasks/leaf_child", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parentId: parent!.taskId }),
    }),
    { params: Promise.resolve({ taskId: child!.taskId }) },
  );
  const payload = await response.json();

  assert.equal(response.status, 422);
  assert.equal(payload.code, "validation_error");
  assert.match(payload.error, /summary section/i);
});

test("wrap task preserves leaf schedule, progress, and dependencies", async () => {
  const plan = await makeProject("wrap-task-preserves-leaf-data");
  const predecessor = await projectService.createTask(plan.project.id, {
    name: "Prep",
    type: "task",
    plannedStart: "2026-03-16",
    plannedDurationDays: 1,
  });
  const target = await projectService.createTask(plan.project.id, {
    name: "Implementation",
    type: "task",
    plannedStart: "2026-03-17",
    plannedDurationDays: 3,
  });

  await projectService.createDependency(plan.project.id, {
    predecessorTaskId: predecessor!.taskId,
    successorTaskId: target!.taskId,
    type: "FS",
    lagDays: 0,
  });
  await projectService.updateTask(target!.taskId, {
    actualStart: "2026-03-18",
    percentComplete: 40,
    notes: "Keep this context",
  });
  const beforeWrap = await projectRepository.getTask(target!.taskId);

  const wrapped = await projectService.wrapTaskInSection(target!.taskId, { childName: "Execution" });
  const child = wrapped?.tasks.find((task) => task.id === target!.taskId);
  const section = wrapped?.tasks.find((task) => task.name === "Implementation" && task.isSummary);
  const dependency = wrapped?.dependencies.find((item) => item.successorTaskId === target!.taskId);

  assert.ok(section);
  assert.equal(child?.parentId, section.id);
  assert.equal(child?.name, "Execution");
  assert.equal(child?.plannedStart, beforeWrap?.plannedStart);
  assert.equal(child?.plannedDurationDays, beforeWrap?.plannedDurationDays);
  assert.equal(child?.actualStart, "2026-03-18");
  assert.equal(child?.percentComplete, 40);
  assert.equal(child?.notes, "Keep this context");
  assert.equal(dependency?.predecessorTaskId, predecessor!.taskId);
  assert.deepEqual(section.childIds, [target!.taskId]);
  assert.equal(section.computedPlannedStart, child?.computedPlannedStart);
  assert.equal(section.rolledUpPercentComplete, 40);
});

test("wrap task route returns an updated plan", async () => {
  const plan = await makeProject("wrap-task-route");
  const task = await projectService.createTask(plan.project.id, {
    name: "Discovery",
    type: "task",
  });

  const response = await wrapTaskRoute(
    new Request(`http://localhost/api/tasks/${task!.taskId}/wrap`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ childName: "Execution" }),
    }),
    { params: Promise.resolve({ taskId: task!.taskId }) },
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.tasks.some((item: Task) => item.id === task!.taskId && item.parentId !== null), true);
});

test("derives task progress from checkpoints while keeping task schedule fields", async () => {
  const plan = await makeProject("task-checkpoints-progress");
  const task = await projectService.createTask(plan.project.id, {
    name: "Develop automation solution",
    type: "task",
    plannedStart: "2026-03-16",
    plannedDurationDays: 5,
  });

  await projectService.createCheckpoint(task!.taskId, {
    name: "Build selectors",
    percentComplete: 100,
    weightPoints: 1,
  });
  const updated = await projectService.createCheckpoint(task!.taskId, {
    name: "Handle edge cases",
    percentComplete: 50,
    weightPoints: 3,
  });

  const stored = await projectRepository.getTask(task!.taskId);
  const plannedTask = updated?.tasks.find((item) => item.id === task!.taskId);

  assert.equal(stored?.plannedStart, "2026-03-16");
  assert.equal(stored?.plannedDurationDays, 5);
  assert.equal(stored?.percentComplete, 63);
  assert.equal(stored?.status, "in_progress");
  assert.equal(plannedTask?.isProgressDerived, true);
  assert.equal(plannedTask?.rolledUpPercentComplete, 63);
  assert.equal(plannedTask?.checkpoints.length, 2);
});

test("rejects checkpoints on summaries and milestones", async () => {
  const plan = await makeProject("checkpoint-parent-guards");
  const summary = await projectService.createTask(plan.project.id, {
    name: "Section",
    type: "summary",
  });
  const milestone = await projectService.createTask(plan.project.id, {
    name: "Signoff",
    type: "milestone",
  });

  await assert.rejects(
    projectService.createCheckpoint(summary!.taskId, {
      name: "Invalid checkpoint",
      percentComplete: 0,
      weightPoints: 1,
    }),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "validation_error" &&
      error.message.includes("only be added to tasks"),
  );

  await assert.rejects(
    projectService.createCheckpoint(milestone!.taskId, {
      name: "Invalid checkpoint",
      percentComplete: 0,
      weightPoints: 1,
    }),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "validation_error" &&
      error.message.includes("only be added to tasks"),
  );
});

test("blocks manual percent edits while checkpoints exist and restores direct editing after removal", async () => {
  const plan = await makeProject("checkpoint-progress-guards");
  const task = await projectService.createTask(plan.project.id, {
    name: "Develop automation solution",
    type: "task",
  });

  const withFirstCheckpoint = await projectService.createCheckpoint(task!.taskId, {
    name: "Checkpoint A",
    percentComplete: 100,
    weightPoints: 1,
  });
  const firstCheckpoint = withFirstCheckpoint?.tasks.find((item) => item.id === task!.taskId)?.checkpoints[0];

  assert.ok(firstCheckpoint);

  await assert.rejects(
    projectService.updateTask(task!.taskId, { percentComplete: 10 }),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "validation_error" &&
      error.message.includes("derive percent complete"),
  );

  await projectService.deleteCheckpoint(firstCheckpoint.id);
  const storedAfterDelete = await projectRepository.getTask(task!.taskId);
  assert.equal(storedAfterDelete?.percentComplete, 100);

  await projectService.updateTask(task!.taskId, { percentComplete: 60 });
  const storedAfterManualEdit = await projectRepository.getTask(task!.taskId);
  assert.equal(storedAfterManualEdit?.percentComplete, 60);
});

test("reorders checkpoints within a task", async () => {
  const plan = await makeProject("checkpoint-reorder");
  const task = await projectService.createTask(plan.project.id, {
    name: "Develop automation solution",
    type: "task",
  });

  const withFirst = await projectService.createCheckpoint(task!.taskId, {
    name: "First",
    percentComplete: 0,
    weightPoints: 1,
  });
  const firstCheckpoint = withFirst?.tasks.find((item) => item.id === task!.taskId)?.checkpoints[0];
  assert.ok(firstCheckpoint);

  const withSecond = await projectService.createCheckpoint(task!.taskId, {
    name: "Second",
    percentComplete: 0,
    weightPoints: 1,
  });
  const checkpointsBeforeMove = withSecond?.tasks.find((item) => item.id === task!.taskId)?.checkpoints ?? [];
  const secondCheckpoint = checkpointsBeforeMove.find((item) => item.name === "Second");
  assert.ok(secondCheckpoint);

  const reordered = await projectService.moveCheckpoint(secondCheckpoint.id, { direction: "up" });
  const orderedNames = reordered?.tasks.find((item) => item.id === task!.taskId)?.checkpoints.map((item) => item.name);

  assert.deepEqual(orderedNames, ["Second", "First"]);
});

test("deleting a leaf task creates an undo action and undo restores it", async () => {
  const plan = await makeProject("task-delete-undo");
  const created = await projectService.createTask(plan.project.id, {
    name: "Leaf task",
    type: "task",
    plannedStart: "2026-03-16",
    plannedDurationDays: 2,
  });

  const deleted = await projectService.deleteTask(created!.taskId);
  assert.equal(deleted?.tasks.some((task) => task.id === created!.taskId), false);
  assert.equal(deleted?.pendingUndoActions.length, 1);
  assert.equal(deleted?.pendingUndoActions[0]?.subjectType, "task");

  const restored = await projectService.undoPendingDeleteAction(deleted!.pendingUndoActions[0]!.id);
  const restoredTask = restored?.tasks.find((task) => task.id === created!.taskId);

  assert.equal(restored?.pendingUndoActions.length, 0);
  assert.equal(restoredTask?.name, "Leaf task");
  assert.equal(restoredTask?.plannedStart, "2026-03-16");
});

test("undo restores a deleted section subtree with checkpoints and dependencies", async () => {
  const plan = await makeProject("section-delete-undo");
  const external = await projectService.createTask(plan.project.id, {
    name: "External task",
    type: "task",
    plannedStart: "2026-03-16",
    plannedDurationDays: 1,
  });
  const section = await projectService.createTask(plan.project.id, {
    name: "Build",
    type: "summary",
  });
  const child = await projectService.createTask(plan.project.id, {
    name: "Execution",
    type: "task",
    parentId: section!.taskId,
    plannedStart: "2026-03-17",
    plannedDurationDays: 3,
  });

  await projectService.createCheckpoint(child!.taskId, {
    name: "Checkpoint A",
    percentComplete: 50,
    weightPoints: 2,
  });
  await projectService.createDependency(plan.project.id, {
    predecessorTaskId: child!.taskId,
    successorTaskId: external!.taskId,
    type: "FS",
    lagDays: 0,
  });

  const deleted = await projectService.deleteTask(section!.taskId);
  assert.equal(deleted?.tasks.some((task) => task.id === section!.taskId), false);
  assert.equal(deleted?.tasks.some((task) => task.id === child!.taskId), false);

  const restored = await projectService.undoPendingDeleteAction(deleted!.pendingUndoActions[0]!.id);
  const restoredSection = restored?.tasks.find((task) => task.id === section!.taskId);
  const restoredChild = restored?.tasks.find((task) => task.id === child!.taskId);

  assert.ok(restoredSection);
  assert.equal(restoredChild?.parentId, section!.taskId);
  assert.equal(restoredChild?.checkpoints.length, 1);
  assert.equal(
    restored?.dependencies.some(
      (dependency) =>
        dependency.predecessorTaskId === child!.taskId && dependency.successorTaskId === external!.taskId,
    ),
    true,
  );
});

test("deleting a checkpoint creates undo metadata and undo restores parent progress", async () => {
  const plan = await makeProject("checkpoint-delete-undo");
  const task = await projectService.createTask(plan.project.id, {
    name: "Develop automation solution",
    type: "task",
  });

  await projectService.createCheckpoint(task!.taskId, {
    name: "Checkpoint A",
    percentComplete: 100,
    weightPoints: 1,
  });
  const withSecond = await projectService.createCheckpoint(task!.taskId, {
    name: "Checkpoint B",
    percentComplete: 0,
    weightPoints: 1,
  });
  const checkpointToDelete = withSecond?.tasks.find((item) => item.id === task!.taskId)?.checkpoints[0];

  assert.ok(checkpointToDelete);

  const deleted = await projectService.deleteCheckpoint(checkpointToDelete.id);
  const afterDelete = deleted?.tasks.find((item) => item.id === task!.taskId);
  assert.equal(afterDelete?.rolledUpPercentComplete, 0);
  assert.equal(deleted?.pendingUndoActions[0]?.subjectType, "checkpoint");

  const restored = await projectService.undoPendingDeleteAction(deleted!.pendingUndoActions[0]!.id);
  const afterUndo = restored?.tasks.find((item) => item.id === task!.taskId);
  assert.equal(afterUndo?.rolledUpPercentComplete, 50);
  assert.equal(afterUndo?.checkpoints.length, 2);
});

test("deleting a dependency can be undone and restores successor scheduling", async () => {
  const plan = await makeProject("dependency-delete-undo");
  const predecessor = await projectService.createTask(plan.project.id, {
    name: "A",
    type: "task",
    plannedStart: "2026-03-16",
    plannedDurationDays: 2,
  });
  const successor = await projectService.createTask(plan.project.id, {
    name: "B",
    type: "task",
    plannedStart: "2026-03-16",
    plannedDurationDays: 1,
  });

  const withDependency = await projectService.createDependency(plan.project.id, {
    predecessorTaskId: predecessor!.taskId,
    successorTaskId: successor!.taskId,
    type: "FS",
    lagDays: 0,
  });
  const beforeDelete = withDependency?.tasks.find((task) => task.id === successor!.taskId);
  const dependencyId = withDependency?.dependencies.find((item) => item.successorTaskId === successor!.taskId)?.id;

  assert.equal(beforeDelete?.computedPlannedStart, "2026-03-17");
  assert.ok(dependencyId);

  const deleted = await projectService.deleteDependency(dependencyId);
  assert.equal(deleted?.dependencies.some((item) => item.id === dependencyId), false);
  assert.equal(deleted?.pendingUndoActions[0]?.subjectType, "dependency");

  const restored = await projectService.undoPendingDeleteAction(deleted!.pendingUndoActions[0]!.id);
  const afterUndo = restored?.tasks.find((task) => task.id === successor!.taskId);
  assert.equal(afterUndo?.computedPlannedStart, "2026-03-17");
  assert.equal(restored?.dependencies.some((item) => item.id === dependencyId), true);
});

test("undo actions survive refresh and expire after the window", async () => {
  projectService.__testUtils.setNowOverride("2026-03-24T12:00:00.000Z");
  const plan = await makeProject("undo-expiry");
  const created = await projectService.createTask(plan.project.id, {
    name: "Temp task",
    type: "task",
  });

  const deleted = await projectService.deleteTask(created!.taskId);
  const action = deleted!.pendingUndoActions[0]!;
  const refreshed = await projectService.getProjectPlan(plan.project.id);

  assert.equal(refreshed?.pendingUndoActions.some((item) => item.id === action.id), true);

  projectService.__testUtils.setNowOverride("2026-03-24T12:00:16.000Z");

  await assert.rejects(
    projectService.undoPendingDeleteAction(action.id),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "validation_error" &&
      error.message.includes("expired"),
  );

  const expiredPlan = await projectService.getProjectPlan(plan.project.id);
  assert.equal(expiredPlan?.pendingUndoActions.length, 0);
});

test("undo route restores a deleted task", async () => {
  const plan = await makeProject("undo-route");
  const created = await projectService.createTask(plan.project.id, {
    name: "Route task",
    type: "task",
  });
  const deleted = await projectService.deleteTask(created!.taskId);

  const response = await undoRoute(
    new Request(`http://localhost/api/undo/${deleted!.pendingUndoActions[0]!.id}`, {
      method: "POST",
    }),
    { params: Promise.resolve({ undoId: deleted!.pendingUndoActions[0]!.id }) },
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.tasks.some((task: Task) => task.id === created!.taskId), true);
});

test("project route returns structured corruption errors", async () => {
  const plan = await makeProject("route-corrupted-project");
  const snapshot = await projectRepository.getProjectSnapshot(plan.project.id);

  assert.ok(snapshot);

  await withMockedSnapshot(
    plan.project.id,
    {
      ...snapshot,
      tasks: [
        ...snapshot.tasks,
        makeTask({
          id: "task_missing_parent_route",
          projectId: plan.project.id,
          name: "Broken task",
          parentId: "missing_parent_route",
        }),
      ],
    },
    async () => {
      const response = await getProjectRoute(
        new Request(`http://localhost/api/projects/${plan.project.id}`),
        { params: Promise.resolve({ projectId: plan.project.id }) },
      );
      const payload = await response.json();

      assert.equal(response.status, 409);
      assert.equal(payload.code, "corrupted_project");
      assert.ok(Array.isArray(payload.details));
      assert.equal(payload.details.some((detail: string) => detail.includes("missing parent task")), true);
    },
  );
});

test("project routes reject unauthenticated requests", async () => {
  delete process.env.TRAXLY_TEST_AUTH_EMAIL;

  const response = await getProjectsRoute();
  const payload = await response.json();

  assert.equal(response.status, 401);
  assert.equal(payload.code, "unauthorized");
});

test("editing a forecast task cascades downstream forecast dates", async () => {
  const plan = await makeProject("cascade-forecast");
  const taskA = await projectService.createTask(plan.project.id, {
    name: "A",
    type: "task",
    plannedStart: "2026-03-16",
    plannedDurationDays: 2,
  });
  const taskB = await projectService.createTask(plan.project.id, {
    name: "B",
    type: "task",
    plannedStart: "2026-03-18",
    plannedDurationDays: 1,
  });
  const taskC = await projectService.createTask(plan.project.id, {
    name: "C",
    type: "task",
    plannedStart: "2026-03-19",
    plannedDurationDays: 1,
  });

  await projectService.createDependency(plan.project.id, {
    predecessorTaskId: taskA!.taskId,
    successorTaskId: taskB!.taskId,
    type: "FS",
    lagDays: 0,
  });
  await projectService.createDependency(plan.project.id, {
    predecessorTaskId: taskB!.taskId,
    successorTaskId: taskC!.taskId,
    type: "FS",
    lagDays: 0,
  });

  await projectService.updateTask(taskA!.taskId, {
    plannedStart: "2026-03-18",
    plannedDurationDays: 2,
  });

  const storedB = await projectRepository.getTask(taskB!.taskId);
  const storedC = await projectRepository.getTask(taskC!.taskId);

  assert.equal(storedB?.plannedStart, "2026-03-19");
  assert.equal(storedC?.plannedStart, "2026-03-19");
});

test("freeze baseline copies the current forecast and can replace an existing baseline", async () => {
  const plan = await makeProject("freeze-baseline");
  const created = await projectService.createTask(plan.project.id, {
    name: "Task",
    type: "task",
    plannedStart: "2026-03-16",
    plannedDurationDays: 3,
  });

  const firstFrozen = await projectService.freezeProjectBaseline(plan.project.id);
  const firstStored = await projectRepository.getTask(created!.taskId);

  assert.ok(firstFrozen?.project.baselineCapturedAt);
  assert.equal(firstStored?.baselinePlannedStart, "2026-03-16");
  assert.equal(firstStored?.baselinePlannedDurationDays, 3);

  await projectService.updateTask(created!.taskId, {
    plannedStart: "2026-03-23",
    plannedDurationDays: 4,
  });
  const secondFrozen = await projectService.freezeProjectBaseline(plan.project.id);
  const secondStored = await projectRepository.getTask(created!.taskId);

  assert.ok(secondFrozen?.project.baselineCapturedAt);
  assert.equal(secondStored?.baselinePlannedStart, "2026-03-23");
  assert.equal(secondStored?.baselinePlannedDurationDays, 4);
});

test("rebase shifts forecast while preserving baseline and actuals", async () => {
  const plan = await makeProject("rebase-forecast");
  const created = await projectService.createTask(plan.project.id, {
    name: "Task",
    type: "task",
    plannedStart: "2026-03-16",
    plannedDurationDays: 2,
  });

  await projectService.freezeProjectBaseline(plan.project.id);
  await projectService.updateTask(created!.taskId, {
    actualStart: "2026-03-17",
    percentComplete: 50,
  });

  const rebased = await projectService.rebaseProjectForecast(plan.project.id, "2026-03-23");
  const stored = await projectRepository.getTask(created!.taskId);

  assert.equal(rebased?.tasks.find((task) => task.id === created!.taskId)?.plannedStart, "2026-03-23");
  assert.equal(stored?.plannedStart, "2026-03-23");
  assert.equal(stored?.baselinePlannedStart, "2026-03-16");
  assert.equal(stored?.actualStart, "2026-03-17");
  assert.equal(stored?.percentComplete, 50);
});

test("duplicate with start date shifts forecast and resets actuals and baseline", async () => {
  const plan = await makeProject("duplicate-with-start-date");
  const created = await projectService.createTask(plan.project.id, {
    name: "Task",
    type: "task",
    plannedStart: "2026-03-16",
    plannedDurationDays: 2,
  });

  await projectService.freezeProjectBaseline(plan.project.id);
  await projectService.updateTask(created!.taskId, {
    actualStart: "2026-03-17",
    percentComplete: 50,
  });

  const duplicated = await projectService.duplicateProject(plan.project.id, "Duplicated", "2026-03-23");
  const duplicatedTask = duplicated?.tasks.find((task) => task.name === "Task");

  assert.equal(duplicatedTask?.plannedStart, "2026-03-23");
  assert.equal(duplicatedTask?.baselinePlannedStart, null);
  assert.equal(duplicatedTask?.actualStart, null);
  assert.equal(duplicatedTask?.percentComplete, 0);
});

test("rebase and freeze routes return updated plans", async () => {
  const plan = await makeProject("route-rebase-freeze");
  const created = await projectService.createTask(plan.project.id, {
    name: "Task",
    type: "task",
    plannedStart: "2026-03-16",
    plannedDurationDays: 2,
  });

  const freezeResponse = await freezeBaselineRoute(new Request(`http://localhost/api/projects/${plan.project.id}/freeze-baseline`, {
    method: "POST",
  }), { params: Promise.resolve({ projectId: plan.project.id }) });
  const freezePayload = await freezeResponse.json();

  assert.equal(freezeResponse.status, 200);
  assert.ok(freezePayload.project.baselineCapturedAt);

  const rebaseResponse = await rebaseProjectRoute(new Request(`http://localhost/api/projects/${plan.project.id}/rebase`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ startDate: "2026-03-23" }),
  }), { params: Promise.resolve({ projectId: plan.project.id }) });
  const rebasePayload = await rebaseResponse.json();

  assert.equal(rebaseResponse.status, 200);
  assert.equal(
    rebasePayload.tasks.find((task: Task) => task.id === created!.taskId)?.plannedStart,
    "2026-03-23",
  );
});
