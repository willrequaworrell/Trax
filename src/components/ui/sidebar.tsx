import * as React from "react";
import { Slot } from "radix-ui";

import { cn } from "@/lib/utils";

function Sidebar({ className, ...props }: React.ComponentProps<"aside">) {
  return (
    <aside
      className={cn(
        "flex h-screen w-[280px] shrink-0 flex-col border-r border-border/70 bg-sidebar text-sidebar-foreground",
        className,
      )}
      {...props}
    />
  );
}

function SidebarHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("border-b border-sidebar-border/80 px-4 py-4", className)} {...props} />;
}

function SidebarContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex-1 overflow-y-auto px-3 py-4", className)} {...props} />;
}

function SidebarFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("border-t border-sidebar-border/80 px-4 py-3", className)} {...props} />;
}

function SidebarSection({ className, ...props }: React.ComponentProps<"section">) {
  return <section className={cn("mb-6 space-y-2", className)} {...props} />;
}

function SidebarLabel({ className, ...props }: React.ComponentProps<"p">) {
  return <p className={cn("px-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-sidebar-foreground/60", className)} {...props} />;
}

function SidebarItem({
  className,
  active,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> & { active?: boolean; asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "button";

  return (
    <Comp
      className={cn(
        "flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-sm text-left transition hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        active && "bg-sidebar-accent text-sidebar-accent-foreground shadow-sm",
        className,
      )}
      {...props}
    />
  );
}

export { Sidebar, SidebarHeader, SidebarContent, SidebarFooter, SidebarSection, SidebarLabel, SidebarItem };
