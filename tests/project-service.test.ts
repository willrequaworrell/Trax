import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { dependencies, projects, tasks } from "@/server/db/schema";
import { getDb } from "@/server/db/client";
import { projectRepository } from "@/server/repositories/project-repository";
import * as projectService from "@/server/services/project-service";
import { GET as getProjectRoute } from "@/app/api/projects/[projectId]/route";
import { GET as getProjectsRoute } from "@/app/api/projects/route";
import { PATCH as patchTaskRoute } from "@/app/api/tasks/[taskId]/route";
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
