import { compareIsoDates, shiftBusinessDays } from "@/domain/date-utils";
import type { Task } from "@/domain/planner";
import { projectRepository } from "@/server/repositories/project-repository";
import { cashReceiptsBuildParts } from "@/server/services/cash-receipts-template";
import { getProjectPlan } from "@/server/services/project-service";

type ProgressSeed = {
  name: string;
  progressPercent: number;
};

function normalizeName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function parseArgs(argv: string[]) {
  const parsed = {
    projectName: "Cash Receipts - Multipart Template",
    rpaTemplateName: "RPA Template",
    startDate: "2025-09-03",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];

    if (current === "--project" && next) {
      parsed.projectName = next;
      index += 1;
    } else if (current === "--rpa-template" && next) {
      parsed.rpaTemplateName = next;
      index += 1;
    } else if (current === "--start-date" && next) {
      parsed.startDate = next;
      index += 1;
    }
  }

  return parsed;
}

function signedBusinessDayGap(from: string, to: string) {
  if (from === to) {
    return 0;
  }

  if (compareIsoDates(from, to) < 0) {
    let cursor = from;
    let offset = 0;

    while (compareIsoDates(cursor, to) < 0) {
      cursor = shiftBusinessDays(cursor, 1);
      offset += 1;
    }

    return offset;
  }

  let cursor = from;
  let offset = 0;

  while (compareIsoDates(cursor, to) > 0) {
    cursor = shiftBusinessDays(cursor, -1);
    offset -= 1;
  }

  return offset;
}

function shiftBaselineDate(iso: string | null, offset: number) {
  if (!iso) {
    return null;
  }

  return shiftBusinessDays(iso, offset);
}

function leafProgressSeeds(): Map<string, Map<string, number>> {
  const seeds: Array<{ partName: string; tasks: ProgressSeed[] }> = [
    {
      partName: "Part 1 - Cash Files",
      tasks: [
        {
          name: "Create main process shell with startup, config loading, and work queue initialization",
          progressPercent: 90,
        },
        {
          name: "Develop business date calculation logic (current quarter, calendar year, last business day)",
          progressPercent: 100,
        },
        {
          name: "Create success notification email functionality",
          progressPercent: 50,
        },
      ],
    },
    {
      partName: "Part 2 - Billing Aging",
      tasks: cashReceiptsBuildParts
        .find((part) => part.name === "Part 2 - Billing Aging")
        ?.tasks.map((task) => ({ name: task.name, progressPercent: 100 })) ?? [],
    },
    {
      partName: "Part 3 - Tax & Freight",
      tasks:
        cashReceiptsBuildParts
          .find((part) => part.name === "Part 3 - Tax & Freight")
          ?.tasks.map((task) => ({
            name: task.name,
            progressPercent: normalizeName(task.name) === normalizeName("Create success notification email functionality") ? 80 : 100,
          })) ?? [],
    },
  ];

  return new Map(
    seeds.map((part) => [
      normalizeName(part.partName),
      new Map(part.tasks.map((task) => [normalizeName(task.name), task.progressPercent])),
    ]),
  );
}

function isLeafInMultipartBuild(task: Task, tasksById: Map<string, Task>) {
  const parent = task.parentId ? tasksById.get(task.parentId) ?? null : null;
  const grandParent = parent?.parentId ? tasksById.get(parent.parentId) ?? null : null;

  return Boolean(parent && grandParent && normalizeName(grandParent.name) === normalizeName("Develop Automation Solution"));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projects = await projectRepository.listProjects();
  const targetProject = projects.find((project) => project.name === args.projectName);
  const rpaTemplate = projects.find((project) => project.name === args.rpaTemplateName);

  if (!targetProject) {
    throw new Error(`Could not find target project "${args.projectName}".`);
  }

  if (!rpaTemplate) {
    throw new Error(`Could not find RPA template "${args.rpaTemplateName}".`);
  }

  const [snapshot, rpaPlan] = await Promise.all([
    projectRepository.getProjectSnapshot(targetProject.id),
    getProjectPlan(rpaTemplate.id),
  ]);

  if (!snapshot) {
    throw new Error(`Could not load snapshot for "${args.projectName}".`);
  }

  if (!rpaPlan || !rpaPlan.timelineStart) {
    throw new Error(`Could not load the timing contour from "${args.rpaTemplateName}".`);
  }

  const offset = signedBusinessDayGap(rpaPlan.timelineStart, args.startDate);
  const now = new Date().toISOString();
  const progressByPart = leafProgressSeeds();
  const tasksById = new Map(snapshot.tasks.map((task) => [task.id, task]));
  const rpaByName = new Map(rpaPlan.tasks.map((task) => [normalizeName(task.name), task]));
  const rpaBuild = rpaByName.get(normalizeName("Develop automation solution"));
  const rpaProcessSignoff = rpaByName.get(normalizeName("Customer signs off on process"));
  const rpaUat = rpaByName.get(normalizeName("Perform UAT (User Acceptance Testing)"));

  if (!rpaBuild || !rpaProcessSignoff || !rpaUat) {
    throw new Error("RPA Template is missing one of the build, signoff, or UAT baseline anchors.");
  }

  let updatedTaskCount = 0;

  for (const task of snapshot.tasks) {
    const parent = task.parentId ? tasksById.get(task.parentId) ?? null : null;
    const updates: Partial<Task> = {};

    if (task.type !== "summary") {
      const rpaMatch = rpaByName.get(normalizeName(task.name));

      if (rpaMatch) {
        updates.baselinePlannedStart = shiftBaselineDate(rpaMatch.computedPlannedStart, offset);
        updates.baselinePlannedEnd = shiftBaselineDate(rpaMatch.computedPlannedEnd, offset);
        updates.baselinePlannedDurationDays = rpaMatch.computedPlannedDurationDays;
      }

      if (isLeafInMultipartBuild(task, tasksById)) {
        updates.baselinePlannedStart = shiftBaselineDate(rpaBuild.computedPlannedStart, offset);
        updates.baselinePlannedEnd = shiftBaselineDate(rpaBuild.computedPlannedEnd, offset);
        updates.baselinePlannedDurationDays = rpaBuild.computedPlannedDurationDays;

        if (parent) {
          const partProgress = progressByPart.get(normalizeName(parent.name));
          const progress = partProgress?.get(normalizeName(task.name));

          if (progress !== undefined) {
            updates.percentComplete = progress;
          }
        }
      } else if (parent && normalizeName(parent.name) === normalizeName("Customer sign off by part")) {
        updates.baselinePlannedStart = shiftBaselineDate(rpaProcessSignoff.computedPlannedStart, offset);
        updates.baselinePlannedEnd = shiftBaselineDate(rpaProcessSignoff.computedPlannedEnd, offset);
        updates.baselinePlannedDurationDays = rpaProcessSignoff.computedPlannedDurationDays;
      } else if (parent && normalizeName(parent.name) === normalizeName("Perform UAT")) {
        updates.baselinePlannedStart = shiftBaselineDate(rpaUat.computedPlannedStart, offset);
        updates.baselinePlannedEnd = shiftBaselineDate(rpaUat.computedPlannedEnd, offset);
        updates.baselinePlannedDurationDays = rpaUat.computedPlannedDurationDays;
      }
    }

    if (
      parent &&
      (normalizeName(parent.name) === normalizeName("Define") || normalizeName(parent.name) === normalizeName("Design"))
    ) {
      updates.percentComplete = 100;
    }

    if (
      parent &&
      normalizeName(parent.name) === normalizeName("Solution Build/Test") &&
      (normalizeName(task.name) === normalizeName("Prepare DEV environment") ||
        normalizeName(task.name) === normalizeName("Determine & prepare test data/cases"))
    ) {
      updates.percentComplete = 100;
    }

    const hasChanges = Object.values(updates).some((value) => value !== undefined);

    if (!hasChanges) {
      continue;
    }

    await projectRepository.updateTask(task.id, {
      ...updates,
      updatedAt: now,
    });
    updatedTaskCount += 1;
  }

  await projectRepository.updateProject(targetProject.id, {
    baselineCapturedAt: now,
    updatedAt: now,
  });

  const finalPlan = await getProjectPlan(targetProject.id);

  if (!finalPlan) {
    throw new Error(`Could not reload "${args.projectName}" after updating it.`);
  }

  console.log(
    JSON.stringify(
      {
        projectId: targetProject.id,
        name: finalPlan.project.name,
        baselineCapturedAt: finalPlan.project.baselineCapturedAt,
        projectPercentComplete: finalPlan.projectPercentComplete,
        updatedTaskCount,
        baselineAnchorStart: args.startDate,
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
