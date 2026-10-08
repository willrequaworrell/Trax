import { previewAutomaticSchedule } from "@/server/services/project-service";
import { jsonError, jsonOk, jsonServiceError } from "@/server/http";
import { requireApiSession } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    await requireApiSession();
    const { projectId } = await context.params;
    const plan = await previewAutomaticSchedule(projectId);
    return plan ? jsonOk(plan) : jsonError("Project not found.", 404);
  } catch (error) {
    return jsonServiceError(error, "Failed to preview schedule.");
  }
}
