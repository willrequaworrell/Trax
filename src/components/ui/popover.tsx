import * as React from "react";
import { Popover } from "radix-ui";

import { cn } from "@/lib/utils";

const PopoverRoot = Popover.Root;
const PopoverTrigger = Popover.Trigger;
const PopoverAnchor = Popover.Anchor;

function PopoverContent({
  className,
  align = "start",
  sideOffset = 8,
  ...props
}: React.ComponentProps<typeof Popover.Content>) {
  return (
    <Popover.Portal>
      <Popover.Content
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "z-50 rounded-2xl border border-border/70 bg-popover p-2 text-popover-foreground shadow-xl outline-none",
          className,
        )}
        {...props}
      />
    </Popover.Portal>
  );
}

export { PopoverRoot, PopoverTrigger, PopoverAnchor, PopoverContent };
