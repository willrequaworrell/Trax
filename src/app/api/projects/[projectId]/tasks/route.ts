import { createTask } from "@/server/services/project-service";
import { jsonError, jsonOk, readJson } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ projectId: string }> };

export async function POST(request: Request, context: Context) {
  try {
    const { projectId } = await context.params;
    const payload = await readJson<{
      parentId?: string | null;
      name: string;
      notes?: string;
      type?: "summary" | "task" | "milestone";
      plannedStart?: string | null;
      plannedEnd?: string | null;
      plannedDurationDays?: number | null;
    }>(request);
    const result = await createTask(projectId, {
      ...payload,
      type: payload.type ?? "task",
    });
    return result ? jsonOk(result, { status: 201 }) : jsonError("Project not found.", 404);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Failed to create task.");
  }
}
