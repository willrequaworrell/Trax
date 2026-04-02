import { addDurationToStart, shiftBusinessDays } from "@/domain/date-utils";
import type { Checkpoint, Dependency, Project, Task } from "@/domain/planner";
import { duplicateProjectSnapshot } from "@/server/services/project-duplication";

type Snapshot = {
  project: Project;
  tasks: Task[];
  dependencies: Dependency[];
  checkpoints: Checkpoint[];
};

type BuildTaskSeed = {
  name: string;
  durationDays: number;
};

type BuildPartSeed = {
  name: string;
  tasks: BuildTaskSeed[];
};

type CashReceiptsTemplateOptions = {
  now: string;
  createId: (prefix: string) => string;
  name?: string;
  description?: string;
};

type PartBranch = {
  buildSummaryId: string;
  firstBuildLeafId: string;
  lastBuildLeafId: string;
  signoffMilestoneId: string;
  uatTaskId: string;
};

const defaultTemplateName = "Cash Receipts - Multipart Template";

export const cashReceiptsBuildParts: BuildPartSeed[] = [
  {
    name: "Part 1 - Cash Files",
    tasks: [
      { name: "Create main process shell with startup, config loading, and work queue initialization", durationDays: 1 },
      { name: "Develop business date calculation logic (current quarter, calendar year, last business day)", durationDays: 1 },
      { name: "Build SFTP connection / outlook / file retrieval components for Bank of America files", durationDays: 1 },
      { name: "Implement quarterly cash file download from SharePoint", durationDays: 1 },
      { name: "Create Excel object actions to open and manipulate quarter bank cash file", durationDays: 1 },
      { name: "Develop logic to extract Total Credits Amount from BOA Daily Cash File", durationDays: 1 },
      { name: "Build paste functionality to update Column Z with daily totals based on date matching", durationDays: 1 },
      { name: "Implement save and upload actions back to SharePoint", durationDays: 1 },
      { name: "Develop Cash Receipts Forecast file download and copy functionality", durationDays: 1 },
      { name: "Create ACH file filtering logic for payments over $20k", durationDays: 1 },
      { name: "Build collection structure to store $20k+ payment data", durationDays: 1 },
      { name: "Implement loop logic to process each payment over $20k", durationDays: 1 },
      { name: "Develop Excel macro execution capability and verification steps", durationDays: 1 },
      { name: "Build Collections worksheet validation logic", durationDays: 1 },
      { name: "Implement Quarterly Forecast Refresh file download and manipulation", durationDays: 1 },
      { name: "Develop filtering logic for date column (next quarter months only)", durationDays: 2 },
      { name: "Build collection logic for items over $50,000 with all required fields", durationDays: 2 },
      { name: "Create Cash Responsibility worksheet update functionality", durationDays: 2 },
      { name: "Implement region-based filtering and row insertion logic", durationDays: 2 },
      { name: "Build exception handling for SFTP, SharePoint, and Excel operations", durationDays: 1 },
      { name: "Create success notification email functionality", durationDays: 1 },
    ],
  },
  {
    name: "Part 2 - Billing Aging",
    tasks: [
      { name: "Create process shell with startup, config loading, and work queue initialization", durationDays: 1 },
      { name: "Develop business date calculation logic (quarter, fiscal year, last business day, period)", durationDays: 1 },
      { name: "Build SAP launch and login functionality", durationDays: 1 },
      { name: "Implement navigation to ZFI2R001 TP3 transaction", durationDays: 1 },
      { name: "Create variant selection and date update logic for Melanie Aging variant", durationDays: 1 },
      { name: "Develop SAP export to Excel functionality with proper dialog handling", durationDays: 1 },
      { name: "Build file naming and saving logic with sensitivity label handling", durationDays: 1 },
      { name: "Implement Mission Critical data extraction (Company Code 0872, Sales Org 0026)", durationDays: 1 },
      { name: "Create data consolidation logic to merge multiple AR aging datasets", durationDays: 1 },
      { name: "Develop Canadian aging report extraction and consolidation", durationDays: 1 },
      { name: "Implement previous week's AR Aging file download from SharePoint", durationDays: 1 },
      { name: "Create worksheet copying logic (AR Aging worksheet transfer)", durationDays: 1 },
      { name: "Build pivot table data source update functionality", durationDays: 2 },
      { name: "Develop table copy/paste logic (Current AR over Last Week's AR)", durationDays: 2 },
      { name: "Implement formatting logic (yellow highlighting, RAW AR sheet rename)", durationDays: 2 },
      { name: "Create save and upload to SharePoint functionality", durationDays: 1 },
      { name: "Implement n/ZFI2R102 transaction navigation and variant selection", durationDays: 1 },
      { name: "Create Exclude Ariba Invoices report extraction logic", durationDays: 1 },
      { name: "Build AP Aging file download, manipulation, and worksheet consolidation", durationDays: 3 },
      { name: "Develop worksheet reordering and SAP Query sheet handling", durationDays: 3 },
      { name: "Create conditional logic for first day of period processing", durationDays: 1 },
      { name: "Implement Date Category worksheet update logic (Week values to Historical)", durationDays: 1 },
      { name: "Build formula copying and external link removal functionality", durationDays: 2 },
      { name: "Develop pivot table data source update logic for all worksheets", durationDays: 2 },
      { name: "Create filter management for Date Category and Minority Indicator fields", durationDays: 2 },
      { name: "Implement Grand Total formula creation and copying logic", durationDays: 1 },
      { name: "Build Summary Total values management (copy, paste, delete oldest week)", durationDays: 1 },
      { name: "Implement n/FS10N transaction navigation and G/L account entry", durationDays: 1 },
      { name: "Create company code selection and layout customization logic", durationDays: 1 },
      { name: "Build line item drill-down and export functionality for US data", durationDays: 1 },
      { name: "Develop Canadian billings extraction and data consolidation", durationDays: 1 },
      { name: "Implement MEMO invoices file integration logic", durationDays: 3 },
      { name: "Create Mid-Week to Weekly Billings file column copying logic", durationDays: 1 },
      { name: "Develop formula copying and worksheet management functionality", durationDays: 1 },
      { name: "Build pivot table refresh and expansion logic", durationDays: 5 },
      { name: "Implement color-coded tracking for cancelled (red), delayed (yellow), and pull-in (green) items", durationDays: 5 },
      { name: "Saving reports to SharePoint", durationDays: 1 },
      { name: "Create Forecast Week update logic for delayed items", durationDays: 3 },
      { name: "Build exception handling for SAP connectivity, SharePoint, and Excel operations", durationDays: 1 },
      { name: "Create success notification email functionality", durationDays: 1 },
    ],
  },
  {
    name: "Part 3 - Tax & Freight",
    tasks: [
      { name: "Create process shell with startup, config loading, and work queue initialization", durationDays: 1 },
      { name: "Establish People Soft website connection", durationDays: 1 },
      { name: "Implement Tax H_BIQ88_SAPSO_BILL_SIDE_TBL query execution and CSV save", durationDays: 1 },
      { name: "Implement Freight H_BIQ88_SAPSO_BILL_SIDE_TBL query execution and CSV save", durationDays: 1 },
      { name: "Implement H_CAQ88_PSPC_PROJECT_PROFILE query execution and CSV save", durationDays: 1 },
      { name: "Build SharePoint folder copy/paste logic for Tax & FRT folder", durationDays: 1 },
      { name: "Create Tax CSV to Excel conversion with sheet renaming", durationDays: 1 },
      { name: "Implement previous month's report worksheet copying (Pivot sheet)", durationDays: 2 },
      { name: "Develop pivot table data source update to point to query worksheet", durationDays: 1 },
      { name: "Build Invoice field filter logic (blanks only)", durationDays: 1 },
      { name: "Create save functionality with proper file naming convention", durationDays: 1 },
      { name: "Implement Freight CSV to Excel conversion", durationDays: 1 },
      { name: "Create worksheet management (Instructions, Pivot, Details sheet rename)", durationDays: 1 },
      { name: "Build H_CAQ88_PSPC_PROJECT_PROFILE CSV processing", durationDays: 1 },
      { name: "Develop blank column insertion logic (3 columns after column L)", durationDays: 1 },
      { name: "Implement VLOOKUP formula setup for Customer Name, Region, and PFA", durationDays: 1 },
      { name: "Create formula autofill functionality for all applicable rows", durationDays: 1 },
      { name: "Build pivot table data source update and filter configuration", durationDays: 2 },
      { name: "Implement save functionality", durationDays: 1 },
      { name: "Build exception handling for Data Lake connectivity, SharePoint, and Excel operations", durationDays: 1 },
      { name: "Create success notification email functionality", durationDays: 1 },
    ],
  },
];

function normalizeName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function createSummaryTask(args: {
  createId: (prefix: string) => string;
  projectId: string;
  now: string;
  parentId: string | null;
  name: string;
  sortOrder: number;
}): Task {
  return {
    id: args.createId("task"),
    projectId: args.projectId,
    parentId: args.parentId,
    name: args.name,
    notes: "",
    sortOrder: args.sortOrder,
    type: "summary",
    plannedMode: null,
    plannedStart: null,
    plannedEnd: null,
    plannedDurationDays: null,
    baselinePlannedStart: null,
    baselinePlannedEnd: null,
    baselinePlannedDurationDays: null,
    actualStart: null,
    actualEnd: null,
    status: "not_started",
    percentComplete: 0,
    isExpanded: true,
    createdAt: args.now,
    updatedAt: args.now,
  };
}

function createLeafTask(args: {
  createId: (prefix: string) => string;
  projectId: string;
  now: string;
  parentId: string;
  name: string;
  sortOrder: number;
  plannedStart: string;
  plannedDurationDays: number;
  type?: Task["type"];
}): Task {
  const type = args.type ?? "task";

  return {
    id: args.createId("task"),
    projectId: args.projectId,
    parentId: args.parentId,
    name: args.name,
    notes: "",
    sortOrder: args.sortOrder,
    type,
    plannedMode: "start_duration",
    plannedStart: args.plannedStart,
    plannedEnd: null,
    plannedDurationDays: type === "milestone" ? 0 : args.plannedDurationDays,
    baselinePlannedStart: null,
    baselinePlannedEnd: null,
    baselinePlannedDurationDays: null,
    actualStart: null,
    actualEnd: null,
    status: "not_started",
    percentComplete: 0,
    isExpanded: true,
    createdAt: args.now,
    updatedAt: args.now,
  };
}

function createDependency(args: {
  createId: (prefix: string) => string;
  projectId: string;
  now: string;
  predecessorTaskId: string;
  successorTaskId: string;
  type?: Dependency["type"];
  lagDays?: number;
}): Dependency {
  return {
    id: args.createId("dep"),
    projectId: args.projectId,
    predecessorTaskId: args.predecessorTaskId,
    successorTaskId: args.successorTaskId,
    type: args.type ?? "FS",
    lagDays: args.lagDays ?? 0,
    createdAt: args.now,
    updatedAt: args.now,
  };
}

function requireTask(tasks: Task[], name: string, parentId?: string | null) {
  const normalizedTarget = normalizeName(name);
  const match = tasks.find(
    (task) => normalizeName(task.name) === normalizedTarget && (parentId === undefined || task.parentId === parentId),
  );

  if (!match) {
    throw new Error(`Expected to find task "${name}" in the source template.`);
  }

  return match;
}

function sequentialTaskDates(start: string, durationDays: number, index: number, previousStart?: string, previousDuration?: number) {
  if (index === 0 || !previousStart || previousDuration === undefined) {
    return start;
  }

  const previousEnd = addDurationToStart(previousStart, previousDuration);
  return shiftBusinessDays(previousEnd, 1);
}

function buildPartBranches(args: {
  createId: (prefix: string) => string;
  now: string;
  projectId: string;
  buildParentId: string;
  signoffParentId: string;
  uatParentId: string;
  buildStart: string;
  uatStart: string;
  uatDurationDays: number;
}) {
  const tasks: Task[] = [];
  const dependencies: Dependency[] = [];
  const branches: PartBranch[] = [];

  for (const [partIndex, part] of cashReceiptsBuildParts.entries()) {
    const buildSummary = createSummaryTask({
      createId: args.createId,
      projectId: args.projectId,
      now: args.now,
      parentId: args.buildParentId,
      name: part.name,
      sortOrder: (partIndex + 1) * 10,
    });
    tasks.push(buildSummary);

    let previousTask: Task | null = null;

    for (const [taskIndex, seed] of part.tasks.entries()) {
      const plannedStart = sequentialTaskDates(
        args.buildStart,
        seed.durationDays,
        taskIndex,
        previousTask?.plannedStart ?? undefined,
        previousTask?.plannedDurationDays ?? undefined,
      );
      const task = createLeafTask({
        createId: args.createId,
        projectId: args.projectId,
        now: args.now,
        parentId: buildSummary.id,
        name: seed.name,
        sortOrder: (taskIndex + 1) * 10,
        plannedStart,
        plannedDurationDays: seed.durationDays,
      });
      tasks.push(task);

      if (previousTask) {
        dependencies.push(
          createDependency({
            createId: args.createId,
            projectId: args.projectId,
            now: args.now,
            predecessorTaskId: previousTask.id,
            successorTaskId: task.id,
          }),
        );
      }

      previousTask = task;
    }

    if (!previousTask) {
      throw new Error(`Build part "${part.name}" must include at least one task.`);
    }

    const signoffMilestone = createLeafTask({
      createId: args.createId,
      projectId: args.projectId,
      now: args.now,
      parentId: args.signoffParentId,
      name: `${part.name} customer sign off`,
      sortOrder: (partIndex + 1) * 10,
      plannedStart: addDurationToStart(previousTask.plannedStart ?? args.buildStart, previousTask.plannedDurationDays ?? 1),
      plannedDurationDays: 0,
      type: "milestone",
    });
    tasks.push(signoffMilestone);

    const uatTask = createLeafTask({
      createId: args.createId,
      projectId: args.projectId,
      now: args.now,
      parentId: args.uatParentId,
      name: `${part.name} UAT`,
      sortOrder: (partIndex + 1) * 10,
      plannedStart: args.uatStart,
      plannedDurationDays: args.uatDurationDays,
    });
    tasks.push(uatTask);

    branches.push({
      buildSummaryId: buildSummary.id,
      firstBuildLeafId: tasks[tasks.length - (part.tasks.length + 2)].id,
      lastBuildLeafId: previousTask.id,
      signoffMilestoneId: signoffMilestone.id,
      uatTaskId: uatTask.id,
    });

    dependencies.push(
      createDependency({
        createId: args.createId,
        projectId: args.projectId,
        now: args.now,
        predecessorTaskId: previousTask.id,
        successorTaskId: signoffMilestone.id,
      }),
      createDependency({
        createId: args.createId,
        projectId: args.projectId,
        now: args.now,
        predecessorTaskId: signoffMilestone.id,
        successorTaskId: uatTask.id,
      }),
    );
  }

  return { tasks, dependencies, branches };
}

export function buildCashReceiptsTemplateSnapshot(source: Snapshot, options: CashReceiptsTemplateOptions): Snapshot {
  const duplicated = duplicateProjectSnapshot(source, {
    projectId: options.createId("project"),
    now: options.now,
    createId: options.createId,
    name: options.name ?? defaultTemplateName,
    description:
      options.description ??
      "Multipart Cash Receipts automation template built from the Intercompany Vouchers delivery skeleton.",
  });

  const buildPhase = requireTask(duplicated.tasks, "Solution Build/Test");
  const uatPhase = requireTask(duplicated.tasks, "UAT / Finalization");
  const developTask = requireTask(duplicated.tasks, "Develop automation solution", buildPhase.id);
  const sourceSignoffTask = requireTask(duplicated.tasks, "Customer signs off on process", buildPhase.id);
  const sourceUatTask = requireTask(duplicated.tasks, "Perform UAT (User Acceptance Testing)", uatPhase.id);

  const buildStart = developTask.plannedStart;
  const uatStart = sourceUatTask.plannedStart;

  if (!buildStart || !uatStart) {
    throw new Error("Source template is missing the build or UAT anchor dates needed to seed the Cash Receipts template.");
  }

  const signoffSummary = createSummaryTask({
    createId: options.createId,
    projectId: duplicated.project.id,
    now: options.now,
    parentId: buildPhase.id,
    name: "Customer sign off by part",
    sortOrder: sourceSignoffTask.sortOrder,
  });
  const developSummary = createSummaryTask({
    createId: options.createId,
    projectId: duplicated.project.id,
    now: options.now,
    parentId: buildPhase.id,
    name: "Develop Automation Solution",
    sortOrder: developTask.sortOrder,
  });
  const performUatSummary = createSummaryTask({
    createId: options.createId,
    projectId: duplicated.project.id,
    now: options.now,
    parentId: uatPhase.id,
    name: "Perform UAT",
    sortOrder: sourceUatTask.sortOrder,
  });

  const removedTaskIds = new Set([developTask.id, sourceSignoffTask.id, sourceUatTask.id]);
  const incomingToBuild = duplicated.dependencies.filter((dependency) => dependency.successorTaskId === developTask.id);
  const outgoingFromBuild = duplicated.dependencies.filter((dependency) => dependency.predecessorTaskId === developTask.id);
  const incomingToSignoff = duplicated.dependencies.filter((dependency) => dependency.successorTaskId === sourceSignoffTask.id);
  const incomingToUat = duplicated.dependencies.filter((dependency) => dependency.successorTaskId === sourceUatTask.id);
  const outgoingFromUat = duplicated.dependencies.filter((dependency) => dependency.predecessorTaskId === sourceUatTask.id);

  const { tasks: partTasks, dependencies: partDependencies, branches } = buildPartBranches({
    createId: options.createId,
    now: options.now,
    projectId: duplicated.project.id,
    buildParentId: developSummary.id,
    signoffParentId: signoffSummary.id,
    uatParentId: performUatSummary.id,
    buildStart,
    uatStart,
    uatDurationDays: Math.max(sourceUatTask.plannedDurationDays ?? 1, 1),
  });

  const redirectedDependencies: Dependency[] = [];

  for (const dependency of incomingToBuild) {
    for (const branch of branches) {
      redirectedDependencies.push(
        createDependency({
          createId: options.createId,
          projectId: duplicated.project.id,
          now: options.now,
          predecessorTaskId: dependency.predecessorTaskId,
          successorTaskId: branch.firstBuildLeafId,
          type: dependency.type,
          lagDays: dependency.lagDays,
        }),
      );
    }
  }

  for (const dependency of outgoingFromBuild) {
    for (const branch of branches) {
      redirectedDependencies.push(
        createDependency({
          createId: options.createId,
          projectId: duplicated.project.id,
          now: options.now,
          predecessorTaskId: branch.lastBuildLeafId,
          successorTaskId: dependency.successorTaskId,
          type: dependency.type,
          lagDays: dependency.lagDays,
        }),
      );
    }
  }

  for (const dependency of incomingToSignoff) {
    for (const branch of branches) {
      redirectedDependencies.push(
        createDependency({
          createId: options.createId,
          projectId: duplicated.project.id,
          now: options.now,
          predecessorTaskId: dependency.predecessorTaskId,
          successorTaskId: branch.signoffMilestoneId,
          type: dependency.type,
          lagDays: dependency.lagDays,
        }),
      );
    }
  }

  for (const dependency of incomingToUat) {
    if (dependency.predecessorTaskId === sourceSignoffTask.id) {
      continue;
    }

    for (const branch of branches) {
      redirectedDependencies.push(
        createDependency({
          createId: options.createId,
          projectId: duplicated.project.id,
          now: options.now,
          predecessorTaskId: dependency.predecessorTaskId,
          successorTaskId: branch.uatTaskId,
          type: dependency.type,
          lagDays: dependency.lagDays,
        }),
      );
    }
  }

  for (const dependency of outgoingFromUat) {
    for (const branch of branches) {
      redirectedDependencies.push(
        createDependency({
          createId: options.createId,
          projectId: duplicated.project.id,
          now: options.now,
          predecessorTaskId: branch.uatTaskId,
          successorTaskId: dependency.successorTaskId,
          type: dependency.type,
          lagDays: dependency.lagDays,
        }),
      );
    }
  }

  const tasks = duplicated.tasks
    .filter((task) => !removedTaskIds.has(task.id))
    .concat([developSummary, signoffSummary, performUatSummary], partTasks);
  const dependencies = duplicated.dependencies
    .filter(
      (dependency) => !removedTaskIds.has(dependency.predecessorTaskId) && !removedTaskIds.has(dependency.successorTaskId),
    )
    .concat(partDependencies, redirectedDependencies);
  const checkpoints = duplicated.checkpoints.filter(
    (checkpoint) => !removedTaskIds.has(checkpoint.taskId),
  );

  return {
    project: duplicated.project,
    tasks,
    dependencies,
    checkpoints,
  };
}
