import { duplicateProject } from "@/server/services/project-service";
import { jsonError, jsonOk, jsonServiceError, readJson } from "@/server/http";
import { requireApiSession } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ projectId: string }> };

export async function POST(request: Request, context: Context) {
  try {
    await requireApiSession();
    const { projectId } = await context.params;
    const payload: { name?: string } = await readJson<{ name?: string }>(request).catch(() => ({}));
    const plan = await duplicateProject(projectId, payload.name);
    return plan ? jsonOk(plan, { status: 201 }) : jsonError("Project not found.", 404);
  } catch (error) {
    return jsonServiceError(error, "Failed to duplicate project.");
  }
}
