import { regenerateProjectShareLink } from "@/server/services/project-service";
import { jsonError, jsonOk, jsonServiceError, readJson } from "@/server/http";
import { requireApiSession } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ projectId: string }> };
type ShareSettingsPayload = { showBaselineVariance?: boolean; reportingTargetTaskId?: string | null };

async function readOptionalShareSettings(request: Request) {
  try {
    return await readJson<ShareSettingsPayload>(request);
  } catch {
    return {};
  }
}

export async function POST(request: Request, context: Context) {
  try {
    await requireApiSession();
    const { projectId } = await context.params;
    const payload = await readOptionalShareSettings(request);
    const link = await regenerateProjectShareLink(projectId, new URL(request.url).origin, payload);
    return link ? jsonOk({ shareLink: link }) : jsonError("Project not found.", 404);
  } catch (error) {
    return jsonServiceError(error, "Failed to regenerate project share link.");
  }
}
