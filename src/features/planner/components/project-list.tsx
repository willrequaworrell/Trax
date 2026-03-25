"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { ArrowSquareOut, Copy, MagnifyingGlass, PencilSimple, Trash } from "@phosphor-icons/react";

import type { Project } from "@/domain/planner";
import { DatePickerField } from "@/features/planner/components/date-picker-field";
import { ProjectRenameDialog } from "@/features/planner/components/project-rename-dialog";
import { WorkspaceSidebar } from "@/features/planner/components/workspace-sidebar";
import { Button } from "@/components/ui/button";
import {
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogRoot,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRoot,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupField } from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";

type Props = {
  initialProjects: Project[];
};

export function ProjectList({ initialProjects }: Props) {
  const [projects, setProjects] = useState(initialProjects);
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [renameProjectId, setRenameProjectId] = useState<string | null>(null);
  const [duplicateProjectId, setDuplicateProjectId] = useState<string | null>(null);
  const [duplicateName, setDuplicateName] = useState("");
  const [duplicateStartDate, setDuplicateStartDate] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const filteredProjects = useMemo(() => {
    const query = search.trim().toLowerCase();

    if (!query) {
      return projects;
    }

    return projects.filter(
      (project) =>
        project.name.toLowerCase().includes(query) ||
        project.description.toLowerCase().includes(query),
    );
  }, [projects, search]);

  async function createProject() {
    startTransition(async () => {
      try {
        const response = await fetch("/api/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: name.trim() || "Untitled project",
            description,
          }),
        });
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error ?? "Failed to create project.");
        }

        setProjects((current) => [...current, payload.project]);
        setName("");
        setDescription("");
        setCreateOpen(false);
        toast.success("Project created");
        window.location.href = `/projects/${payload.project.id}`;
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to create project.");
      }
    });
  }

  async function removeProject(projectId: string) {
    startTransition(async () => {
      try {
        const response = await fetch(`/api/projects/${projectId}`, { method: "DELETE" });

        if (!response.ok) {
          throw new Error("Failed to delete project.");
        }

        setProjects((current) => current.filter((project) => project.id !== projectId));
        toast.success("Project removed");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to delete project.");
      }
    });
  }

  async function duplicateProject(projectId: string, name: string, startDate: string | null) {
    startTransition(async () => {
      try {
        const response = await fetch(`/api/projects/${projectId}/duplicate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, startDate }),
        });
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error ?? "Failed to duplicate project.");
        }

        setProjects((current) => [...current, payload.project]);
        setDuplicateProjectId(null);
        setDuplicateName("");
        setDuplicateStartDate(null);
        toast.success("Project duplicated");
        window.location.href = `/projects/${payload.project.id}`;
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to duplicate project.");
      }
    });
  }

  async function renameProject(projectId: string, nextName: string) {
    startTransition(async () => {
      try {
        const response = await fetch(`/api/projects/${projectId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: nextName }),
        });
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error ?? "Failed to rename project.");
        }

        setProjects((current) =>
          current.map((project) =>
            project.id === payload.project.id
              ? { ...project, name: payload.project.name, description: payload.project.description, updatedAt: payload.project.updatedAt }
              : project,
          ),
        );
        setRenameProjectId(null);
        toast.success("Project renamed");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to rename project.");
      }
    });
  }

  const projectBeingRenamed = renameProjectId
    ? projects.find((project) => project.id === renameProjectId) ?? null
    : null;
  const projectBeingDuplicated = duplicateProjectId
    ? projects.find((project) => project.id === duplicateProjectId) ?? null
    : null;

  return (
    <>
      <div className="flex min-h-screen bg-background">
        <WorkspaceSidebar projects={projects} />

        <main className="flex min-h-screen flex-1 flex-col overflow-hidden">
          <header className="border-b border-border/70 bg-background/95 px-8 py-6 backdrop-blur">
            <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <h1 className="text-3xl font-semibold tracking-tight">Projects</h1>
                <p className="mt-2 text-sm text-muted-foreground">
                  Open a project, start from a blank plan, or duplicate an existing project into a reusable template copy.
                </p>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row">
                <InputGroup className="w-full sm:w-[320px]">
                  <InputGroupAddon>
                    <MagnifyingGlass className="size-4" />
                  </InputGroupAddon>
                  <InputGroupField
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search projects"
                  />
                </InputGroup>
                <Button onClick={() => setCreateOpen(true)}>
                  {isPending ? <Spinner /> : null}
                  New Project
                </Button>
              </div>
            </div>
          </header>

          <section className="flex-1 overflow-y-auto px-8 py-8">
            <div className="overflow-hidden rounded-3xl border border-border/70 bg-card shadow-sm">
              <div className="grid grid-cols-[minmax(260px,1.2fr)_minmax(280px,1fr)_160px] border-b border-border/70 bg-muted/35 px-5 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                <span>Project</span>
                <span>Description</span>
                <span className="text-right">Actions</span>
              </div>
              <div className="divide-y divide-border/60">
                {filteredProjects.length === 0 ? (
                  <div className="px-6 py-14 text-center">
                    <p className="text-lg font-medium">No projects yet</p>
                    <p className="mt-2 text-sm text-muted-foreground">
                      Create an empty project to start fresh, or duplicate one later when you want a repeatable template.
                    </p>
                    <div className="mt-5">
                      <Button onClick={() => setCreateOpen(true)}>Create empty project</Button>
                    </div>
                  </div>
                ) : null}
                {filteredProjects.map((project) => (
                  <div key={project.id} className="grid grid-cols-[minmax(260px,1.2fr)_minmax(280px,1fr)_160px] items-center px-5 py-4">
                    <div className="min-w-0">
                      <Link href={`/projects/${project.id}`} className="group flex items-center gap-3">
                        <div className="flex size-10 items-center justify-center rounded-2xl bg-chart-1/15 text-chart-4">
                          <ArrowSquareOut className="size-5" />
                        </div>
                        <div className="min-w-0">
                          <p className="truncate font-medium transition group-hover:text-primary">{project.name}</p>
                          <p className="text-xs text-muted-foreground">Updated {new Date(project.updatedAt).toLocaleDateString()}</p>
                        </div>
                      </Link>
                    </div>
                    <p className="line-clamp-2 pr-6 text-sm text-muted-foreground">
                      {project.description || "No project description yet."}
                    </p>
                    <div className="flex items-center justify-end gap-2">
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/projects/${project.id}`}>Open</Link>
                      </Button>
                      <DropdownMenuRoot>
                        <DropdownMenuTrigger asChild>
                          <Button size="sm" variant="ghost">More</Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem asChild>
                            <Link href={`/projects/${project.id}`}>Open planner</Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setRenameProjectId(project.id)}>
                            <PencilSimple className="size-4" />
                            Rename project
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => {
                              setDuplicateProjectId(project.id);
                              setDuplicateName(`${project.name} Copy`);
                              setDuplicateStartDate(null);
                            }}
                          >
                            <Copy className="size-4" />
                            Duplicate project
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => void removeProject(project.id)}
                          >
                            <Trash className="size-4" />
                            Delete project
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenuRoot>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </main>
      </div>

      <DialogRoot open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Create project</DialogTitle>
            <DialogDescription>Start with an empty project and build sections, tasks, and dependencies only when you need them.</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Project name</label>
              <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Website relaunch" />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Description</label>
              <textarea
                className="min-h-32 w-full rounded-2xl border border-input bg-background px-4 py-3 text-sm outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring/20"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Short internal planning context for this project."
              />
            </div>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void createProject()} disabled={isPending || !name.trim()}>
              {isPending ? <Spinner /> : null}
              Create project
            </Button>
          </DialogFooter>
        </DialogContent>
      </DialogRoot>

      <ProjectRenameDialog
        open={projectBeingRenamed !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRenameProjectId(null);
          }
        }}
        initialName={projectBeingRenamed?.name ?? ""}
        onSubmit={(nextName) => {
          if (projectBeingRenamed) {
            return renameProject(projectBeingRenamed.id, nextName);
          }
        }}
        isPending={isPending}
      />

      <DialogRoot
        open={projectBeingDuplicated !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDuplicateProjectId(null);
            setDuplicateName("");
            setDuplicateStartDate(null);
          }
        }}
      >
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Duplicate project</DialogTitle>
            <DialogDescription>
              Create a new project from this template and optionally shift the forecast so it starts on a different date.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Project name</label>
              <Input value={duplicateName} onChange={(event) => setDuplicateName(event.target.value)} placeholder="Customer rollout Copy" />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Start date</label>
              <DatePickerField value={duplicateStartDate} onChange={setDuplicateStartDate} />
              <p className="text-xs text-muted-foreground">
                Leave blank to keep the copied project on the same forecast dates as the source.
              </p>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDuplicateProjectId(null);
                setDuplicateName("");
                setDuplicateStartDate(null);
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (projectBeingDuplicated) {
                  void duplicateProject(projectBeingDuplicated.id, duplicateName.trim() || `${projectBeingDuplicated.name} Copy`, duplicateStartDate);
                }
              }}
              disabled={isPending || !duplicateName.trim()}
            >
              {isPending ? <Spinner /> : null}
              Duplicate project
            </Button>
          </DialogFooter>
        </DialogContent>
      </DialogRoot>
    </>
  );
}
