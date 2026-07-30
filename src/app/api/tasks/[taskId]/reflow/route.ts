import { jsonError, jsonOk, jsonServiceError } from "@/server/http";
import { requireApiSession } from "@/server/session";
import { reflowTaskDownstream } from "@/server/services/project-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ taskId: string }> };

export async function POST(_request: Request, context: Context) {
  try {
    await requireApiSession();
    const { taskId } = await context.params;
    const plan = await reflowTaskDownstream(taskId);
    return plan ? jsonOk(plan) : jsonError("Task not found.", 404);
  } catch (error) {
    return jsonServiceError(error, "Failed to reflow downstream schedule.");
  }
}
