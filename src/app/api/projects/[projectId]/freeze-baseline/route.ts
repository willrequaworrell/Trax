import { freezeProjectBaseline } from "@/server/services/project-service";
import { jsonError, jsonOk, jsonServiceError } from "@/server/http";
import { requireApiSession } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ projectId: string }> };

export async function POST(_request: Request, context: Context) {
  try {
    await requireApiSession();
    const { projectId } = await context.params;
    const plan = await freezeProjectBaseline(projectId);
    return plan ? jsonOk(plan) : jsonError("Project not found.", 404);
  } catch (error) {
    return jsonServiceError(error, "Failed to freeze project baseline.");
  }
}
