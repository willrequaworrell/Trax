import * as React from "react";
import { NavigationMenu } from "radix-ui";

import { cn } from "@/lib/utils";

const NavigationMenuRoot = NavigationMenu.Root;
const NavigationMenuList = NavigationMenu.List;
const NavigationMenuItem = NavigationMenu.Item;
const NavigationMenuLink = NavigationMenu.Link;

function NavigationMenuTrigger({ className, active, ...props }: React.ComponentProps<"button"> & { active?: boolean }) {
  return (
    <button
      className={cn(
        "inline-flex h-10 items-center rounded-xl px-3 text-sm font-medium text-muted-foreground transition hover:bg-muted/70 hover:text-foreground",
        active && "bg-background text-foreground shadow-sm ring-1 ring-border/70",
        className,
      )}
      {...props}
    />
  );
}

export { NavigationMenuRoot, NavigationMenuList, NavigationMenuItem, NavigationMenuLink, NavigationMenuTrigger };
