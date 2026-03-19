import { connection } from "next/server";
import { ProjectList } from "@/features/planner/components/project-list";
import { listProjects } from "@/server/services/project-service";

export const dynamic = "force-dynamic";

export default async function Home() {
  await connection();
  const projects = await listProjects();
  return <ProjectList initialProjects={projects} />;
}
