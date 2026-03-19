import { connection } from "next/server";

import { signIn } from "@/auth";
import { ProjectList } from "@/features/planner/components/project-list";
import { listProjects } from "@/server/services/project-service";
import { getViewerSession } from "@/server/session";

export const dynamic = "force-dynamic";

async function signInWithGoogle() {
  "use server";

  await signIn("google", { redirectTo: "/" });
}

export default async function Home() {
  await connection();
  const session = await getViewerSession();

  if (!session) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,_hsl(var(--primary)/0.15),_transparent_45%),linear-gradient(180deg,_hsl(var(--background)),_hsl(var(--muted)/0.45))] px-6 py-10">
        <section className="w-full max-w-3xl rounded-[2rem] border border-border/70 bg-card/95 p-8 shadow-sm backdrop-blur">
          <div className="space-y-4">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">Private workspace</p>
            <h1 className="text-4xl font-semibold tracking-tight">Traxly</h1>
            <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
              Dependency-aware project planning, exportable project snapshots, and a faster personal workflow than heavyweight PM suites.
            </p>
          </div>

          <div className="mt-8 grid gap-4 rounded-[1.5rem] border border-border/70 bg-background/75 p-5 md:grid-cols-[1.2fr_0.8fr]">
            <div className="space-y-3">
              <h2 className="text-lg font-medium">Sign in with your Google account</h2>
              <p className="text-sm text-muted-foreground">
                Access is limited to the single allowed email configured for this deployment.
              </p>
            </div>

            <form action={signInWithGoogle} className="flex items-center justify-start md:justify-end">
              <button
                type="submit"
                className="inline-flex h-11 items-center justify-center rounded-2xl bg-primary px-5 text-sm font-medium text-primary-foreground transition hover:opacity-95"
              >
                Continue with Google
              </button>
            </form>
          </div>
        </section>
      </main>
    );
  }

  const projects = await listProjects();
  return <ProjectList initialProjects={projects} />;
}
