import { exportProject } from "@/server/services/project-service";
import { jsonError, jsonOk } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ projectId: string }> };

export async function GET(request: Request, context: Context) {
  const { projectId } = await context.params;
  const format = new URL(request.url).searchParams.get("format");
  const exported = await exportProject(projectId);

  if (!exported) {
    return jsonError("Project not found.", 404);
  }

  if (format === "markdown") {
    return new Response(exported.markdown, {
      headers: { "Content-Type": "text/markdown; charset=utf-8" },
    });
  }

  return jsonOk(exported.json);
}
