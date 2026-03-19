import { deleteTask, updateTask } from "@/server/services/project-service";
import { jsonError, jsonOk, readJson } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ taskId: string }> };

export async function PATCH(request: Request, context: Context) {
  try {
    const { taskId } = await context.params;
    const payload = await readJson<Record<string, unknown>>(request);
    const plan = await updateTask(taskId, payload);
    return plan ? jsonOk(plan) : jsonError("Task not found.", 404);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Failed to update task.");
  }
}

export async function DELETE(_request: Request, context: Context) {
  const { taskId } = await context.params;
  const plan = await deleteTask(taskId);
  return plan ? jsonOk(plan) : jsonError("Task not found.", 404);
}
