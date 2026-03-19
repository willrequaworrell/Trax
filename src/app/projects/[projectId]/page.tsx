import { notFound } from "next/navigation";

import { PlannerClient } from "@/features/planner/components/planner-client";
import { getProjectPlan, listProjects } from "@/server/services/project-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ projectId: string }>;
};

export default async function ProjectPage({ params }: Props) {
  const { projectId } = await params;
  const [plan, projects] = await Promise.all([getProjectPlan(projectId), listProjects()]);

  if (!plan) {
    notFound();
  }

  return <PlannerClient initialPlan={plan} initialProjects={projects} />;
}
