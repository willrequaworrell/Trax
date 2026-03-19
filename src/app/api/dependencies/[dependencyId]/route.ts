import { deleteDependency, updateDependency } from "@/server/services/project-service";
import { jsonError, jsonOk, jsonServiceError, readJson } from "@/server/http";
import { requireApiSession } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ dependencyId: string }> };

export async function PATCH(request: Request, context: Context) {
  try {
    await requireApiSession();
    const { dependencyId } = await context.params;
    const payload = await readJson<Record<string, unknown>>(request);
    const plan = await updateDependency(dependencyId, payload);
    return plan ? jsonOk(plan) : jsonError("Dependency not found.", 404);
  } catch (error) {
    return jsonServiceError(error, "Failed to update dependency.");
  }
}

export async function DELETE(_request: Request, context: Context) {
  try {
    await requireApiSession();
    const { dependencyId } = await context.params;
    const plan = await deleteDependency(dependencyId);
    return plan ? jsonOk(plan) : jsonError("Dependency not found.", 404);
  } catch (error) {
    return jsonServiceError(error, "Failed to delete dependency.");
  }
}
