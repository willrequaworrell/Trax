import { wrapTaskInSection } from "@/server/services/project-service";
import { jsonError, jsonOk, jsonServiceError, readJson } from "@/server/http";
import { requireApiSession } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ taskId: string }> };

export async function POST(request: Request, context: Context) {
  try {
    await requireApiSession();
    const { taskId } = await context.params;
    const payload = await readJson<{ childName?: string }>(request).catch(() => ({}));
    const plan = await wrapTaskInSection(taskId, payload);
    return plan ? jsonOk(plan) : jsonError("Task not found.", 404);
  } catch (error) {
    return jsonServiceError(error, "Failed to wrap task in a section.");
  }
}
