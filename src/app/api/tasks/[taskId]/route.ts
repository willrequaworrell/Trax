import { deleteTask, updateTask } from "@/server/services/project-service";
import { jsonError, jsonOk, jsonServiceError, readJson } from "@/server/http";
import { requireApiSession } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ taskId: string }> };

export async function PATCH(request: Request, context: Context) {
  try {
    await requireApiSession();
    const { taskId } = await context.params;
    const payload = await readJson<Record<string, unknown>>(request);
    const plan = await updateTask(taskId, payload);
    return plan ? jsonOk(plan) : jsonError("Task not found.", 404);
  } catch (error) {
    return jsonServiceError(error, "Failed to update task.");
  }
}

export async function DELETE(_request: Request, context: Context) {
  try {
    await requireApiSession();
    const { taskId } = await context.params;
    const plan = await deleteTask(taskId);
    return plan ? jsonOk(plan) : jsonError("Task not found.", 404);
  } catch (error) {
    return jsonServiceError(error, "Failed to delete task.");
  }
}
