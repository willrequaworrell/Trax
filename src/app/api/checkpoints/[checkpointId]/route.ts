import type { CheckpointUpdateInput } from "@/domain/planner";
import { deleteCheckpoint, updateCheckpoint } from "@/server/services/project-service";
import { jsonError, jsonOk, jsonServiceError, readJson } from "@/server/http";
import { requireApiSession } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ checkpointId: string }> };

export async function PATCH(request: Request, context: Context) {
  try {
    await requireApiSession();
    const { checkpointId } = await context.params;
    const payload = await readJson<CheckpointUpdateInput>(request);
    const plan = await updateCheckpoint(checkpointId, payload);
    return plan ? jsonOk(plan) : jsonError("Checkpoint not found.", 404);
  } catch (error) {
    return jsonServiceError(error, "Failed to update checkpoint.");
  }
}

export async function DELETE(_request: Request, context: Context) {
  try {
    await requireApiSession();
    const { checkpointId } = await context.params;
    const plan = await deleteCheckpoint(checkpointId);
    return plan ? jsonOk(plan) : jsonError("Checkpoint not found.", 404);
  } catch (error) {
    return jsonServiceError(error, "Failed to delete checkpoint.");
  }
}
