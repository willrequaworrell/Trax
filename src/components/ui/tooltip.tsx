import * as React from "react";
import { Tooltip } from "radix-ui";

import { cn } from "@/lib/utils";

const TooltipProvider = Tooltip.Provider;
const TooltipRoot = Tooltip.Root;
const TooltipTrigger = Tooltip.Trigger;

function TooltipContent({ className, sideOffset = 8, ...props }: React.ComponentProps<typeof Tooltip.Content>) {
  return (
    <Tooltip.Portal>
      <Tooltip.Content
        sideOffset={sideOffset}
        className={cn("z-50 max-w-64 rounded-xl bg-foreground px-3 py-2 text-xs leading-relaxed text-background shadow-lg", className)}
        {...props}
      />
    </Tooltip.Portal>
  );
}

export { TooltipProvider, TooltipRoot, TooltipTrigger, TooltipContent };
