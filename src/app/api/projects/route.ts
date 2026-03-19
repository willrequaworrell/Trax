import { createProject, listProjects } from "@/server/services/project-service";
import { jsonOk, jsonServiceError, readJson } from "@/server/http";
import { requireApiSession } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireApiSession();
    return jsonOk(await listProjects());
  } catch (error) {
    return jsonServiceError(error, "Failed to load projects.");
  }
}

export async function POST(request: Request) {
  try {
    await requireApiSession();
    const payload = await readJson<{ name: string; description?: string }>(request);
    const plan = await createProject({
      ...payload,
      description: payload.description ?? "",
    });
    return jsonOk(plan, { status: 201 });
  } catch (error) {
    return jsonServiceError(error, "Failed to create project.");
  }
}
