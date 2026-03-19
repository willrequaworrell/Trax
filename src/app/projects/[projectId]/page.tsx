import Link from "next/link";
import { notFound } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PlannerClient } from "@/features/planner/components/planner-client";
import { WorkspaceSidebar } from "@/features/planner/components/workspace-sidebar";
import { CorruptedProjectError } from "@/server/errors";
import { getProjectPlan, listProjects } from "@/server/services/project-service";
import { requirePageSession } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ projectId: string }>;
};

export default async function ProjectPage({ params }: Props) {
  await requirePageSession();
  const { projectId } = await params;
  const projects = await listProjects();
  const activeProject = projects.find((project) => project.id === projectId);
  let plan = null;
  let corruptionError: CorruptedProjectError | null = null;

  if (!activeProject) {
    notFound();
  }

  try {
    plan = await getProjectPlan(projectId);
  } catch (error) {
    if (!(error instanceof CorruptedProjectError)) {
      throw error;
    }

    corruptionError = error;
  }

  if (!plan && !corruptionError) {
    notFound();
  }

  if (corruptionError) {
    return (
      <div className="flex min-h-screen bg-background">
        <WorkspaceSidebar projects={projects} activeProjectId={projectId} />
        <main className="flex min-h-screen flex-1 items-center justify-center overflow-hidden px-6 py-10">
          <section className="w-full max-w-3xl rounded-3xl border border-destructive/25 bg-card/95 p-8 shadow-sm">
            <div className="flex items-start gap-4">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
                <span className="text-2xl leading-none" aria-hidden="true">
                  !
                </span>
              </div>
              <div className="min-w-0 space-y-5">
                <div className="space-y-2">
                  <Badge variant="destructive">Project blocked</Badge>
                  <h1 className="text-3xl font-semibold tracking-tight">{activeProject.name} cannot be opened</h1>
                  <p className="text-sm text-muted-foreground">
                    The task hierarchy for this project is corrupted. Fix the task relationships before opening the planner.
                  </p>
                </div>
                <div className="rounded-2xl border border-border/70 bg-muted/30 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Detected issues</p>
                  <ul className="mt-3 space-y-2 text-sm">
                    {corruptionError.details?.map((issue) => (
                      <li key={issue} className="rounded-xl bg-background/80 px-3 py-2">
                        {issue}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="flex flex-wrap gap-3">
                  <Button asChild>
                    <Link href="/">Back to projects</Link>
                  </Button>
                </div>
              </div>
            </div>
          </section>
        </main>
      </div>
    );
  }

  if (!plan) {
    notFound();
  }

  return <PlannerClient initialPlan={plan} initialProjects={projects} />;
}
