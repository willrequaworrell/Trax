"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTransition } from "react";
import { CalendarDots, ChartBarHorizontal, Folders, ListBullets, Plus, SignOut, Sparkle } from "@phosphor-icons/react";
import { signOut } from "next-auth/react";

import type { Project } from "@/domain/planner";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarItem,
  SidebarLabel,
  SidebarSection,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

type Props = {
  projects: Project[];
  activeProjectId?: string;
  onCreateProject?: () => void;
};

export function WorkspaceSidebar({ projects, activeProjectId, onCreateProject }: Props) {
  const pathname = usePathname();
  const [isSigningOut, startSignOutTransition] = useTransition();

  function handleSignOut() {
    startSignOutTransition(async () => {
      await signOut({ redirectTo: "/" });
    });
  }

  return (
    <Sidebar className="h-screen">
      <SidebarHeader className="space-y-3">
        <div className="flex items-center gap-3 px-2">
          <div className="flex size-10 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
            <Sparkle className="size-5" />
          </div>
          <div>
            <p className="text-sm font-semibold">Traxly</p>
            <p className="text-xs text-sidebar-foreground/60">Personal planning workspace</p>
          </div>
        </div>
        <Button className="w-full justify-center" onClick={onCreateProject}>
          <Plus />
          Project
        </Button>
      </SidebarHeader>

      <SidebarContent>
        <SidebarSection>
          <SidebarLabel>Navigation</SidebarLabel>
          <div className="space-y-1">
            <SidebarItem asChild active={pathname === "/"}>
              <Link href="/">
                <Folders className="size-4" />
                Projects
              </Link>
            </SidebarItem>
            {activeProjectId ? (
              <>
                <SidebarItem asChild active={pathname === `/projects/${activeProjectId}` || pathname?.includes(`/projects/${activeProjectId}`)}>
                  <Link href={`/projects/${activeProjectId}`}>
                    <ListBullets className="size-4" />
                    List View
                  </Link>
                </SidebarItem>
                <SidebarItem className="pointer-events-none opacity-70">
                  <ChartBarHorizontal className="size-4" />
                  Gantt View
                </SidebarItem>
              </>
            ) : null}
          </div>
        </SidebarSection>

        <SidebarSection>
          <SidebarLabel>Projects</SidebarLabel>
          <div className="space-y-1">
            {projects.map((project) => (
              <SidebarItem key={project.id} asChild active={project.id === activeProjectId}>
                <Link href={`/projects/${project.id}`} className="justify-between">
                  <span className="truncate">{project.name}</span>
                  <CalendarDots className={cn("size-4 opacity-0 transition", project.id === activeProjectId && "opacity-100")} />
                </Link>
              </SidebarItem>
            ))}
          </div>
        </SidebarSection>
      </SidebarContent>

      <SidebarFooter>
        <Button variant="outline" className="w-full justify-center" onClick={() => void handleSignOut()} disabled={isSigningOut}>
          <SignOut className="size-4" />
          {isSigningOut ? "Signing out..." : "Log out"}
        </Button>
        <p className="text-xs text-sidebar-foreground/60">Use the list for quick schedule updates and open dialogs for section details, notes, and full dependency editing.</p>
      </SidebarFooter>
    </Sidebar>
  );
}
