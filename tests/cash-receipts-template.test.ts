import assert from "node:assert/strict";
import test from "node:test";

import type { Checkpoint, Dependency, Project, Task } from "@/domain/planner";
import { buildCashReceiptsTemplateSnapshot } from "@/server/services/cash-receipts-template";

type Snapshot = {
  project: Project;
  tasks: Task[];
  dependencies: Dependency[];
  checkpoints: Checkpoint[];
};

function makeTask(task: Partial<Task> & Pick<Task, "id" | "name" | "projectId">): Task {
  return {
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

function makeDependency(
  dependency: Partial<Dependency> & Pick<Dependency, "id" | "projectId" | "predecessorTaskId" | "successorTaskId">,
): Dependency {
  return {
    type: "FS",
    lagDays: 0,
    createdAt: "2026-03-18T00:00:00.000Z",
    updatedAt: "2026-03-18T00:00:00.000Z",
    ...dependency,
  };
}

function childNames(tasks: Task[], parentId: string) {
  return tasks
    .filter((task) => task.parentId === parentId)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((task) => task.name);
}

function buildSourceSnapshot(): Snapshot {
  const projectId = "project_source";
  const project: Project = {
    id: projectId,
    name: "Intercompany Vouchers",
    description: "",
    baselineCapturedAt: null,
    createdAt: "2026-03-18T00:00:00.000Z",
    updatedAt: "2026-03-18T00:00:00.000Z",
  };
  const tasks: Task[] = [
    makeTask({ id: "define", projectId, name: "Define", type: "summary", plannedMode: null, plannedStart: null, plannedDurationDays: null, sortOrder: 10 }),
    makeTask({ id: "design", projectId, name: "Design", type: "summary", plannedMode: null, plannedStart: null, plannedDurationDays: null, sortOrder: 20 }),
    makeTask({ id: "build", projectId, name: "Solution Build/Test", type: "summary", plannedMode: null, plannedStart: null, plannedDurationDays: null, sortOrder: 30 }),
    makeTask({ id: "uat", projectId, name: "UAT / Finalization", type: "summary", plannedMode: null, plannedStart: null, plannedDurationDays: null, sortOrder: 40 }),
    makeTask({ id: "deploy", projectId, name: "Deploy", type: "summary", plannedMode: null, plannedStart: null, plannedDurationDays: null, sortOrder: 50 }),
    makeTask({ id: "sdd_signoff", projectId, parentId: "design", name: "Customer & Design Authority sign off on SDD", type: "milestone", plannedDurationDays: 0, plannedStart: "2026-04-08", sortOrder: 60 }),
    makeTask({ id: "test_data_build", projectId, parentId: "build", name: "Determine & prepare test data/cases", plannedStart: "2026-04-08", plannedDurationDays: 3, sortOrder: 10 }),
    makeTask({ id: "prepare_dev", projectId, parentId: "build", name: "Prepare DEV environment", plannedStart: "2026-03-30", plannedDurationDays: 3, sortOrder: 20 }),
    makeTask({ id: "develop", projectId, parentId: "build", name: "Develop automation solution", plannedStart: "2026-04-08", plannedDurationDays: 15, sortOrder: 30 }),
    makeTask({ id: "code_review", projectId, parentId: "build", name: "Code review with Design Authority", plannedStart: "2026-04-28", plannedDurationDays: 2, sortOrder: 40 }),
    makeTask({ id: "demo", projectId, parentId: "build", name: "Demo Bot to customer", plannedStart: "2026-04-29", plannedDurationDays: 1, sortOrder: 50 }),
    makeTask({ id: "process_signoff", projectId, parentId: "build", name: "Customer signs off on process", type: "milestone", plannedDurationDays: 0, plannedStart: "2026-04-29", sortOrder: 60 }),
    makeTask({ id: "prepare_uat_env", projectId, parentId: "uat", name: "Prepare UAT environment", plannedStart: "2026-04-28", plannedDurationDays: 2, sortOrder: 10 }),
    makeTask({ id: "setup_schedules", projectId, parentId: "uat", name: "Setup run schedules & calendars", plannedStart: "2026-04-28", plannedDurationDays: 2, sortOrder: 20 }),
    makeTask({ id: "prepare_uat_data", projectId, parentId: "uat", name: "Prepare test data/cases", plannedStart: "2026-04-29", plannedDurationDays: 2, sortOrder: 30 }),
    makeTask({ id: "perform_uat", projectId, parentId: "uat", name: "Perform UAT (User Acceptance Testing)", plannedStart: "2026-04-30", plannedDurationDays: 5, sortOrder: 40 }),
    makeTask({ id: "uat_feedback", projectId, parentId: "uat", name: "Update Bot from UAT feedback", plannedStart: "2026-05-06", plannedDurationDays: 3, sortOrder: 50 }),
    makeTask({ id: "uat_signoff", projectId, parentId: "uat", name: "Customer signs off on UAT", type: "milestone", plannedDurationDays: 0, plannedStart: "2026-05-08", sortOrder: 60 }),
    makeTask({ id: "prepare_prod", projectId, parentId: "deploy", name: "Prepare PROD environment", plannedStart: "2026-04-28", plannedDurationDays: 2, sortOrder: 20 }),
    makeTask({ id: "handbook", projectId, parentId: "deploy", name: "Create Operational Handbook", plannedStart: "2026-05-08", plannedDurationDays: 1, sortOrder: 30 }),
  ];
  const dependencies: Dependency[] = [
    makeDependency({ id: "dep1", projectId, predecessorTaskId: "sdd_signoff", successorTaskId: "develop" }),
    makeDependency({ id: "dep2", projectId, predecessorTaskId: "prepare_dev", successorTaskId: "develop" }),
    makeDependency({ id: "dep3", projectId, predecessorTaskId: "develop", successorTaskId: "code_review" }),
    makeDependency({ id: "dep4", projectId, predecessorTaskId: "develop", successorTaskId: "demo" }),
    makeDependency({ id: "dep5", projectId, predecessorTaskId: "code_review", successorTaskId: "demo" }),
    makeDependency({ id: "dep6", projectId, predecessorTaskId: "demo", successorTaskId: "process_signoff" }),
    makeDependency({ id: "dep7", projectId, predecessorTaskId: "develop", successorTaskId: "prepare_uat_env" }),
    makeDependency({ id: "dep8", projectId, predecessorTaskId: "develop", successorTaskId: "setup_schedules" }),
    makeDependency({ id: "dep9", projectId, predecessorTaskId: "prepare_uat_env", successorTaskId: "prepare_uat_data" }),
    makeDependency({ id: "dep10", projectId, predecessorTaskId: "prepare_uat_env", successorTaskId: "perform_uat" }),
    makeDependency({ id: "dep11", projectId, predecessorTaskId: "prepare_uat_data", successorTaskId: "perform_uat" }),
    makeDependency({ id: "dep12", projectId, predecessorTaskId: "setup_schedules", successorTaskId: "perform_uat" }),
    makeDependency({ id: "dep13", projectId, predecessorTaskId: "process_signoff", successorTaskId: "perform_uat" }),
    makeDependency({ id: "dep14", projectId, predecessorTaskId: "perform_uat", successorTaskId: "uat_feedback" }),
    makeDependency({ id: "dep15", projectId, predecessorTaskId: "uat_feedback", successorTaskId: "uat_signoff" }),
    makeDependency({ id: "dep16", projectId, predecessorTaskId: "develop", successorTaskId: "prepare_prod" }),
    makeDependency({ id: "dep17", projectId, predecessorTaskId: "uat_signoff", successorTaskId: "handbook" }),
  ];

  return { project, tasks, dependencies, checkpoints: [] };
}

test("builds the cash receipts multipart hierarchy and gates", () => {
  let counter = 0;
  const snapshot = buildCashReceiptsTemplateSnapshot(buildSourceSnapshot(), {
    now: "2026-03-30T12:00:00.000Z",
    createId(prefix) {
      counter += 1;
      return `${prefix}_${counter}`;
    },
  });

  assert.equal(snapshot.project.name, "Cash Receipts - Multipart Template");

  const buildPhase = snapshot.tasks.find((task) => task.name === "Solution Build/Test");
  const uatPhase = snapshot.tasks.find((task) => task.name === "UAT / Finalization");
  assert.ok(buildPhase);
  assert.ok(uatPhase);

  const developSummary = snapshot.tasks.find((task) => task.parentId === buildPhase.id && task.name === "Develop Automation Solution");
  const signoffSummary = snapshot.tasks.find((task) => task.parentId === buildPhase.id && task.name === "Customer sign off by part");
  const performUatSummary = snapshot.tasks.find((task) => task.parentId === uatPhase.id && task.name === "Perform UAT");
  assert.ok(developSummary);
  assert.ok(signoffSummary);
  assert.ok(performUatSummary);

  assert.deepEqual(childNames(snapshot.tasks, developSummary.id), [
    "Part 1 - Cash Files",
    "Part 2 - Billing Aging",
    "Part 3 - Tax & Freight",
  ]);
  assert.deepEqual(childNames(snapshot.tasks, signoffSummary.id), [
    "Part 1 - Cash Files customer sign off",
    "Part 2 - Billing Aging customer sign off",
    "Part 3 - Tax & Freight customer sign off",
  ]);
  assert.deepEqual(childNames(snapshot.tasks, performUatSummary.id), [
    "Part 1 - Cash Files UAT",
    "Part 2 - Billing Aging UAT",
    "Part 3 - Tax & Freight UAT",
  ]);

  assert.equal(
    snapshot.tasks.filter((task) => task.parentId === snapshot.tasks.find((t) => t.name === "Part 1 - Cash Files")?.id).length,
    21,
  );
  assert.equal(
    snapshot.tasks.filter((task) => task.parentId === snapshot.tasks.find((t) => t.name === "Part 2 - Billing Aging")?.id).length,
    40,
  );
  assert.equal(
    snapshot.tasks.filter((task) => task.parentId === snapshot.tasks.find((t) => t.name === "Part 3 - Tax & Freight")?.id).length,
    21,
  );

  assert.equal(snapshot.tasks.some((task) => task.name === "Develop automation solution"), false);
  assert.equal(snapshot.tasks.some((task) => task.name === "Customer signs off on process"), false);
  assert.equal(snapshot.tasks.some((task) => task.name === "Perform UAT (User Acceptance Testing)"), false);

  const part1LastBuild = snapshot.tasks.find((task) => task.name === "Create success notification email functionality" && task.parentId === snapshot.tasks.find((t) => t.name === "Part 1 - Cash Files")?.id);
  const part1Signoff = snapshot.tasks.find((task) => task.name === "Part 1 - Cash Files customer sign off");
  const part1Uat = snapshot.tasks.find((task) => task.name === "Part 1 - Cash Files UAT");
  assert.ok(part1LastBuild);
  assert.ok(part1Signoff);
  assert.ok(part1Uat);

  assert.ok(
    snapshot.dependencies.some(
      (dependency) => dependency.predecessorTaskId === part1LastBuild.id && dependency.successorTaskId === part1Signoff.id,
    ),
  );
  assert.ok(
    snapshot.dependencies.some(
      (dependency) => dependency.predecessorTaskId === part1Signoff.id && dependency.successorTaskId === part1Uat.id,
    ),
  );

  const codeReview = snapshot.tasks.find((task) => task.name === "Code review with Design Authority");
  const demo = snapshot.tasks.find((task) => task.name === "Demo Bot to customer");
  const prepareUatEnvironment = snapshot.tasks.find((task) => task.name === "Prepare UAT environment");
  assert.ok(codeReview);
  assert.ok(demo);
  assert.ok(prepareUatEnvironment);

  const partLastBuildIds = [
    "Part 1 - Cash Files",
    "Part 2 - Billing Aging",
    "Part 3 - Tax & Freight",
  ].map((partName) => {
    const summary = snapshot.tasks.find((task) => task.name === partName);
    const leaves = snapshot.tasks.filter((task) => task.parentId === summary?.id).sort((a, b) => a.sortOrder - b.sortOrder);
    return leaves.at(-1)?.id;
  });

  for (const successor of [codeReview.id, demo.id, prepareUatEnvironment.id]) {
    for (const predecessor of partLastBuildIds) {
      assert.ok(
        snapshot.dependencies.some(
          (dependency) => dependency.predecessorTaskId === predecessor && dependency.successorTaskId === successor,
        ),
      );
    }
  }
});
