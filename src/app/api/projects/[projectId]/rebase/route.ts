import { rebaseProjectForecast } from "@/server/services/project-service";
import { jsonError, jsonOk, jsonServiceError, readJson } from "@/server/http";
import { requireApiSession } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ projectId: string }> };

export async function POST(request: Request, context: Context) {
  try {
    await requireApiSession();
    const { projectId } = await context.params;
    const payload = await readJson<{ startDate: string }>(request);
    const plan = await rebaseProjectForecast(projectId, payload.startDate);
    return plan ? jsonOk(plan) : jsonError("Project not found.", 404);
  } catch (error) {
    return jsonServiceError(error, "Failed to rebase project schedule.");
  }
}
