import {
  createProjectShareLink,
  getProjectShareLink,
  revokeProjectShareLink,
  updateProjectShareLink,
} from "@/server/services/project-service";
import { jsonError, jsonOk, jsonServiceError, readJson } from "@/server/http";
import { requireApiSession } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ projectId: string }> };
type ShareSettingsPayload = { showBaselineVariance?: boolean; reportingTargetTaskId?: string | null };

function requestOrigin(request: Request) {
  return new URL(request.url).origin;
}

async function readOptionalShareSettings(request: Request) {
  try {
    return await readJson<ShareSettingsPayload>(request);
  } catch {
    return {};
  }
}

export async function GET(request: Request, context: Context) {
  try {
    await requireApiSession();
    const { projectId } = await context.params;
    const link = await getProjectShareLink(projectId, requestOrigin(request));
    return jsonOk({ shareLink: link });
  } catch (error) {
    return jsonServiceError(error, "Failed to load project share link.");
  }
}

export async function POST(request: Request, context: Context) {
  try {
    await requireApiSession();
    const { projectId } = await context.params;
    const payload = await readOptionalShareSettings(request);
    const link = await createProjectShareLink(projectId, requestOrigin(request), payload);
    return link ? jsonOk({ shareLink: link }) : jsonError("Project not found.", 404);
  } catch (error) {
    return jsonServiceError(error, "Failed to create project share link.");
  }
}

export async function PATCH(request: Request, context: Context) {
  try {
    await requireApiSession();
    const { projectId } = await context.params;
    const payload = await readJson<ShareSettingsPayload>(request);
    const link = await updateProjectShareLink(projectId, payload, requestOrigin(request));
    return link ? jsonOk({ shareLink: link }) : jsonError("Project share link not found.", 404);
  } catch (error) {
    return jsonServiceError(error, "Failed to update project share link.");
  }
}

export async function DELETE(_request: Request, context: Context) {
  try {
    await requireApiSession();
    const { projectId } = await context.params;
    const revoked = await revokeProjectShareLink(projectId);
    return revoked ? new Response(null, { status: 204 }) : jsonError("Project not found.", 404);
  } catch (error) {
    return jsonServiceError(error, "Failed to revoke project share link.");
  }
}
