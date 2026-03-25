import type { CheckpointMoveInput } from "@/domain/planner";
import { moveCheckpoint } from "@/server/services/project-service";
import { jsonError, jsonOk, jsonServiceError, readJson } from "@/server/http";
import { requireApiSession } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ checkpointId: string }> };

export async function POST(request: Request, context: Context) {
  try {
    await requireApiSession();
    const { checkpointId } = await context.params;
    const payload = await readJson<CheckpointMoveInput>(request);
    const plan = await moveCheckpoint(checkpointId, payload);
    return plan ? jsonOk(plan) : jsonError("Checkpoint not found.", 404);
  } catch (error) {
    return jsonServiceError(error, "Failed to move checkpoint.");
  }
}
