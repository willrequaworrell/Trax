import { addDurationToStart, businessDayShiftGap, clampToBusinessDay, shiftBusinessDays } from "@/domain/date-utils";
import type { PlannedTask, Task } from "@/domain/planner";
import { projectRepository } from "@/server/repositories/project-repository";
import { getProjectPlan } from "@/server/services/project-service";

type PhaseWindow = {
  start: string;
  end: string;
};

const phaseWindows = new Map<string, PhaseWindow>([
  ["Define", { start: "2025-09-03", end: "2025-10-07" }],
  ["Design", { start: "2025-10-13", end: "2025-10-31" }],
  ["Solution Build/Test", { start: "2025-10-31", end: "2026-04-03" }],
  ["UAT / Finalization", { start: "2026-04-03", end: "2026-05-25" }],
  ["Deploy", { start: "2026-05-26", end: "2026-06-05" }],
]);

const progressOverrides = new Map<string, number>([
  ["Code review with Design Authority", 100],
  ["Demo Bot to customer", 100],
  ["Part 1 - Cash Files customer sign off", 100],
  ["Part 2 - Billing Aging customer sign off", 100],
  ["Part 3 - Tax & Freight customer sign off", 100],
  ["Prepare UAT environment", 100],
  ["Prepare test data/cases", 100],
  ["Part 1 - Cash Files UAT", 65],
  ["Part 2 - Billing Aging UAT", 65],
  ["Part 3 - Tax & Freight UAT", 65],
  ["Update Bot from UAT feedback", 20],
  ["Customer signs off on UAT", 0],
]);

const denseStartPhases = new Set(["Solution Build/Test", "UAT / Finalization", "Deploy"]);
const clearActualsForTasks = new Set(["Prepare DEV environment", "Create success notification email functionality"]);

function parseArgs(argv: string[]) {
  const parsed = {
    projectName: "CS Cash Receipts",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];

    if (current === "--project" && next) {
      parsed.projectName = next;
      index += 1;
    }
  }

  return parsed;
}

function phaseNameForTask(task: Task, tasksById: Map<string, Task>) {
  let current: Task | null = task;

  while (current?.parentId) {
    const parent: Task | null = tasksById.get(current.parentId) ?? null;

    if (!parent) {
      break;
    }

    current = parent;
  }

  return current?.name ?? null;
}

function scaleBusinessDayOffset(offset: number, sourceSpan: number, targetSpan: number) {
  if (sourceSpan <= 0 || offset <= 0) {
    return 0;
  }

  return Math.round((offset / sourceSpan) * targetSpan);
}

function nextPlannedDuration(task: PlannedTask) {
  if (task.type === "milestone") {
    return 0;
  }

  return Math.max(task.plannedDurationDays ?? task.computedPlannedDurationDays ?? 1, 1);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projects = await projectRepository.listProjects();
  const targetProject = projects.find((project) => project.name === args.projectName);

  if (!targetProject) {
    throw new Error(`Could not find target project "${args.projectName}".`);
  }

  const [snapshot, plan] = await Promise.all([
    projectRepository.getProjectSnapshot(targetProject.id),
    getProjectPlan(targetProject.id),
  ]);

  if (!snapshot || !plan) {
    throw new Error(`Could not load "${args.projectName}".`);
  }

  const tasksById = new Map(snapshot.tasks.map((task) => [task.id, task]));
  const leafPlans = plan.tasks.filter((task) => task.type !== "summary" && task.computedPlannedStart && task.computedPlannedEnd);
  const leavesByPhase = new Map<string, PlannedTask[]>();

  for (const task of leafPlans) {
    const sourceTask = tasksById.get(task.id);

    if (!sourceTask) {
      continue;
    }

    const phaseName = phaseNameForTask(sourceTask, tasksById);

    if (!phaseName || !phaseWindows.has(phaseName)) {
      continue;
    }

    const bucket = leavesByPhase.get(phaseName) ?? [];
    bucket.push(task);
    leavesByPhase.set(phaseName, bucket);
  }

  const now = new Date().toISOString();
  let updatedTaskCount = 0;

  for (const task of leafPlans) {
    const sourceTask = tasksById.get(task.id);

    if (!sourceTask) {
      continue;
    }

    const phaseName = phaseNameForTask(sourceTask, tasksById);
    const window = phaseName ? phaseWindows.get(phaseName) : undefined;

    if (!window) {
      continue;
    }

    const phaseLeaves = leavesByPhase.get(phaseName) ?? [];
    const phaseSourceStart = phaseLeaves.map((entry) => entry.computedPlannedStart).filter(Boolean).sort().at(0);
    const phaseSourceEnd = phaseLeaves.map((entry) => entry.computedPlannedEnd).filter(Boolean).sort().at(-1);

    if (!phaseSourceStart || !phaseSourceEnd || !task.computedPlannedStart) {
      continue;
    }

    const nextStart = denseStartPhases.has(phaseName)
      ? window.start
      : clampToBusinessDay(
          shiftBusinessDays(
            window.start,
            scaleBusinessDayOffset(
              businessDayShiftGap(phaseSourceStart, task.computedPlannedStart),
              businessDayShiftGap(phaseSourceStart, phaseSourceEnd),
              businessDayShiftGap(window.start, window.end),
            ),
          ),
        );
    const durationDays = nextPlannedDuration(task);
    const progressOverride = progressOverrides.get(task.name);
    const updates: Partial<Task> = {
      plannedStart: nextStart,
      plannedDurationDays: durationDays,
      updatedAt: now,
    };

    if (sourceTask.plannedMode === "start_end") {
      updates.plannedEnd = addDurationToStart(nextStart, Math.max(durationDays, 1));
    } else {
      updates.plannedEnd = null;
    }

    if (progressOverride !== undefined) {
      updates.percentComplete = progressOverride;
    }

    if (clearActualsForTasks.has(task.name)) {
      updates.actualStart = null;
      updates.actualEnd = null;
    }

    await projectRepository.updateTask(task.id, updates);
    updatedTaskCount += 1;
  }

  await projectRepository.updateProject(targetProject.id, {
    updatedAt: now,
  });

  const finalPlan = await getProjectPlan(targetProject.id);

  if (!finalPlan) {
    throw new Error(`Could not reload "${args.projectName}" after updating it.`);
  }

  const rootSummaries = finalPlan.tasks
    .filter((task) => task.depth === 0)
    .map((task) => ({
      name: task.name,
      percentComplete: task.rolledUpPercentComplete,
      start: task.computedPlannedStart,
      end: task.computedPlannedEnd,
    }));

  console.log(
    JSON.stringify(
      {
        projectId: targetProject.id,
        name: finalPlan.project.name,
        projectPercentComplete: finalPlan.projectPercentComplete,
        timelineStart: finalPlan.timelineStart,
        timelineEnd: finalPlan.timelineEnd,
        updatedTaskCount,
        rootSummaries,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
