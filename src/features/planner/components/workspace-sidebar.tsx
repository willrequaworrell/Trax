"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { CaretDown, CaretLeft, CaretRight, Kanban, Plus, SignOut } from "@phosphor-icons/react";
import { signOut } from "next-auth/react";

import type { Project } from "@/domain/planner";
import { Button } from "@/components/ui/button";
import { CollapsibleContent, CollapsibleRoot } from "@/components/ui/collapsible";
import {
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogRoot,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarItem,
} from "@/components/ui/sidebar";

type Props = {
  projects: Project[];
  activeProjectId?: string;
};

export function WorkspaceSidebar({ projects, activeProjectId }: Props) {
  const pathname = usePathname();
  const [isSigningOut, startSignOutTransition] = useTransition();
  const [isCreatingProject, startCreateTransition] = useTransition();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [projectsOpen, setProjectsOpen] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  function handleSignOut() {
    startSignOutTransition(async () => {
      await signOut({ redirectTo: "/" });
    });
  }

  function handleCreateProject() {
    startCreateTransition(async () => {
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

        setName("");
        setDescription("");
        setCreateOpen(false);
        window.location.href = `/projects/${payload.project.id}`;
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to create project.");
      }
    });
  }

  return (
    <>
      <Sidebar className={sidebarOpen ? "h-screen" : "h-screen w-16"}>
        <SidebarHeader className="space-y-4">
          <div className={sidebarOpen ? "flex items-center gap-3 px-2" : "flex items-center justify-center"}>
            <div className="flex size-10 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
              <Kanban className="size-5" />
            </div>
            {sidebarOpen ? <p className="text-lg font-semibold tracking-tight">Traxly</p> : null}
          </div>
          <div className={sidebarOpen ? "flex justify-end" : "flex justify-center"}>
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              aria-label={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
              onClick={() => setSidebarOpen((current) => !current)}
            >
              {sidebarOpen ? <CaretLeft className="size-3.5" /> : <CaretRight className="size-3.5" />}
            </Button>
          </div>
        </SidebarHeader>

        <SidebarContent className={sidebarOpen ? undefined : "px-2"}>
          {sidebarOpen ? (
            <CollapsibleRoot open={projectsOpen}>
              <div className="space-y-2">
                <div className="flex items-center gap-1 border-b border-sidebar-border/80 px-1 pb-2">
                  <SidebarItem asChild active={pathname === "/"} className="flex-1 font-semibold">
                    <Link href="/">Projects</Link>
                  </SidebarItem>
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    aria-label="Add project"
                    onClick={() => setCreateOpen(true)}
                  >
                    <Plus className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    aria-label={projectsOpen ? "Collapse project list" : "Expand project list"}
                    onClick={() => setProjectsOpen((current) => !current)}
                  >
                    {projectsOpen ? <CaretDown className="size-3.5" /> : <CaretRight className="size-3.5" />}
                  </Button>
                </div>

                <CollapsibleContent className="space-y-1 pl-5 pr-1">
                  {projects.map((project) => (
                    <SidebarItem key={project.id} asChild active={project.id === activeProjectId}>
                      <Link href={`/projects/${project.id}`} className="truncate">
                        {project.name}
                      </Link>
                    </SidebarItem>
                  ))}
                </CollapsibleContent>
              </div>
            </CollapsibleRoot>
          ) : (
            <div className="space-y-2">
              <Button
                type="button"
                size="icon-sm"
                variant={pathname === "/" ? "default" : "ghost"}
                className="w-full"
                aria-label="Open projects"
                onClick={() => {
                  window.location.href = "/";
                }}
              >
                <Kanban className="size-4" />
              </Button>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                className="w-full"
                aria-label="Add project"
                onClick={() => setCreateOpen(true)}
              >
                <Plus className="size-4" />
              </Button>
            </div>
          )}
        </SidebarContent>

        <SidebarFooter>
          <Button
            variant="outline"
            className={sidebarOpen ? "w-full justify-center" : "w-full justify-center px-0"}
            onClick={() => void handleSignOut()}
            disabled={isSigningOut}
            aria-label="Log out"
          >
            <SignOut className="size-4" />
            {sidebarOpen ? (isSigningOut ? "Signing out..." : "Log out") : null}
          </Button>
        </SidebarFooter>
      </Sidebar>

      <DialogRoot open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Create project</DialogTitle>
            <DialogDescription>Start a new project without leaving the page.</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Project name</label>
              <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Website relaunch" />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Description</label>
              <textarea
                className="min-h-28 w-full rounded-2xl border border-input bg-background px-4 py-3 text-sm outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring/20"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Optional project context."
              />
            </div>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void handleCreateProject()} disabled={isCreatingProject || !name.trim()}>
              {isCreatingProject ? "Creating..." : "Create project"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </DialogRoot>
    </>
  );
}
