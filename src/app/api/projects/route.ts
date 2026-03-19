import { createProject, listProjects } from "@/server/services/project-service";
import { jsonError, jsonOk, readJson } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return jsonOk(await listProjects());
}

export async function POST(request: Request) {
  try {
    const payload = await readJson<{ name: string; description?: string }>(request);
    const plan = await createProject({
      ...payload,
      description: payload.description ?? "",
    });
    return jsonOk(plan, { status: 201 });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Failed to create project.");
  }
}
