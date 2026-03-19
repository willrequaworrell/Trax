import { createDependency } from "@/server/services/project-service";
import { jsonError, jsonOk, jsonServiceError, readJson } from "@/server/http";
import { requireApiSession } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ projectId: string }> };

export async function POST(request: Request, context: Context) {
  try {
    await requireApiSession();
    const { projectId } = await context.params;
    const payload = await readJson<{
      predecessorTaskId: string;
      successorTaskId: string;
      type: "FS" | "SS" | "FF" | "SF";
      lagDays?: number;
    }>(request);
    const plan = await createDependency(projectId, {
      ...payload,
      lagDays: payload.lagDays ?? 0,
    });
    return plan ? jsonOk(plan, { status: 201 }) : jsonError("Project not found.", 404);
  } catch (error) {
    return jsonServiceError(error, "Failed to create dependency.");
  }
}
