import { deleteProject, getProjectPlan, updateProject } from "@/server/services/project-service";
import { jsonError, jsonOk, readJson } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ projectId: string }> };

export async function GET(_request: Request, context: Context) {
  const { projectId } = await context.params;
  const plan = await getProjectPlan(projectId);
  return plan ? jsonOk(plan) : jsonError("Project not found.", 404);
}

export async function PATCH(request: Request, context: Context) {
  try {
    const { projectId } = await context.params;
    const payload = await readJson<{ name?: string; description?: string }>(request);
    const plan = await updateProject(projectId, payload);
    return plan ? jsonOk(plan) : jsonError("Project not found.", 404);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Failed to update project.");
  }
}

export async function DELETE(_request: Request, context: Context) {
  const { projectId } = await context.params;
  await deleteProject(projectId);
  return new Response(null, { status: 204 });
}
