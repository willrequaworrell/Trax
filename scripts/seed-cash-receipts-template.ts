import { projectRepository } from "@/server/repositories/project-repository";
import { buildCashReceiptsTemplateSnapshot } from "@/server/services/cash-receipts-template";

function createId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function parseArgs(argv: string[]) {
  const parsed = {
    sourceName: "Intercompany Vouchers",
    name: "Cash Receipts - Multipart Template",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];

    if (current === "--source" && next) {
      parsed.sourceName = next;
      index += 1;
    } else if (current === "--name" && next) {
      parsed.name = next;
      index += 1;
    }
  }

  return parsed;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projects = await projectRepository.listProjects();
  const sourceProject = projects.find((project) => project.name === args.sourceName);

  if (!sourceProject) {
    throw new Error(`Could not find source project "${args.sourceName}".`);
  }

  const existing = projects.find((project) => project.name === args.name);

  if (existing) {
    throw new Error(`A project named "${args.name}" already exists.`);
  }

  const snapshot = await projectRepository.getProjectSnapshot(sourceProject.id);

  if (!snapshot) {
    throw new Error(`Could not load source snapshot for "${args.sourceName}".`);
  }

  const now = new Date().toISOString();
  const template = buildCashReceiptsTemplateSnapshot(snapshot, {
    now,
    createId,
    name: args.name,
  });

  await projectRepository.insertProject(template.project);
  await projectRepository.insertTasks(template.tasks);
  await projectRepository.insertDependencies(template.dependencies);
  await projectRepository.insertCheckpoints(template.checkpoints);

  console.log(
    JSON.stringify(
      {
        projectId: template.project.id,
        name: template.project.name,
        taskCount: template.tasks.length,
        dependencyCount: template.dependencies.length,
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
