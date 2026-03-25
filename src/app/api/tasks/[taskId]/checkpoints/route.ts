import type { CheckpointCreateInput } from "@/domain/planner";
import { createCheckpoint } from "@/server/services/project-service";
import { jsonError, jsonOk, jsonServiceError, readJson } from "@/server/http";
import { requireApiSession } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ taskId: string }> };

export async function POST(request: Request, context: Context) {
  try {
    await requireApiSession();
    const { taskId } = await context.params;
    const payload = await readJson<CheckpointCreateInput>(request);
    const plan = await createCheckpoint(taskId, payload);
    return plan ? jsonOk(plan, { status: 201 }) : jsonError("Task not found.", 404);
  } catch (error) {
    return jsonServiceError(error, "Failed to create checkpoint.");
  }
}
