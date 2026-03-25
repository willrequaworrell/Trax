import { undoPendingDeleteAction } from "@/server/services/project-service";
import { jsonError, jsonOk, jsonServiceError } from "@/server/http";
import { requireApiSession } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ undoId: string }> };

export async function POST(_request: Request, context: Context) {
  try {
    await requireApiSession();
    const { undoId } = await context.params;
    const plan = await undoPendingDeleteAction(undoId);
    return plan ? jsonOk(plan) : jsonError("Undo action not found.", 404);
  } catch (error) {
    return jsonServiceError(error, "Failed to undo delete.");
  }
}
