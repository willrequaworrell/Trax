import * as React from "react";
import { Check, CaretRight } from "@phosphor-icons/react";
import { DropdownMenu } from "radix-ui";

import { cn } from "@/lib/utils";

const DropdownMenuRoot = DropdownMenu.Root;
const DropdownMenuTrigger = DropdownMenu.Trigger;
const DropdownMenuPortal = DropdownMenu.Portal;
const DropdownMenuSub = DropdownMenu.Sub;
const DropdownMenuRadioGroup = DropdownMenu.RadioGroup;

function DropdownMenuContent({ className, sideOffset = 6, ...props }: React.ComponentProps<typeof DropdownMenu.Content>) {
  return (
    <DropdownMenuPortal>
      <DropdownMenu.Content
        sideOffset={sideOffset}
        className={cn(
          "z-50 min-w-52 overflow-hidden rounded-2xl border border-border/70 bg-popover p-1.5 text-popover-foreground shadow-xl",
          className,
        )}
        {...props}
      />
    </DropdownMenuPortal>
  );
}

function DropdownMenuItem({ className, inset, ...props }: React.ComponentProps<typeof DropdownMenu.Item> & { inset?: boolean }) {
  return (
    <DropdownMenu.Item
      className={cn(
        "relative flex cursor-default items-center gap-2 rounded-xl px-2.5 py-2 text-sm outline-none transition hover:bg-muted focus:bg-muted data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        inset && "pl-8",
        className,
      )}
      {...props}
    />
  );
}

function DropdownMenuCheckboxItem({ className, children, checked, ...props }: React.ComponentProps<typeof DropdownMenu.CheckboxItem>) {
  return (
    <DropdownMenu.CheckboxItem
      checked={checked}
      className={cn(
        "relative flex cursor-default items-center gap-2 rounded-xl py-2 pr-2 pl-8 text-sm outline-none transition hover:bg-muted focus:bg-muted data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    >
      <span className="absolute left-2 flex size-4 items-center justify-center">
        <DropdownMenu.ItemIndicator>
          <Check className="size-3.5" />
        </DropdownMenu.ItemIndicator>
      </span>
      {children}
    </DropdownMenu.CheckboxItem>
  );
}

function DropdownMenuLabel({ className, inset, ...props }: React.ComponentProps<typeof DropdownMenu.Label> & { inset?: boolean }) {
  return (
    <DropdownMenu.Label
      className={cn("px-2.5 py-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground", inset && "pl-8", className)}
      {...props}
    />
  );
}

function DropdownMenuSeparator({ className, ...props }: React.ComponentProps<typeof DropdownMenu.Separator>) {
  return <DropdownMenu.Separator className={cn("my-1 h-px bg-border/70", className)} {...props} />;
}

function DropdownMenuSubTrigger({ className, inset, children, ...props }: React.ComponentProps<typeof DropdownMenu.SubTrigger> & { inset?: boolean }) {
  return (
    <DropdownMenu.SubTrigger
      className={cn(
        "flex cursor-default items-center rounded-xl px-2.5 py-2 text-sm outline-none hover:bg-muted focus:bg-muted data-[state=open]:bg-muted",
        inset && "pl-8",
        className,
      )}
      {...props}
    >
      {children}
      <CaretRight className="ml-auto size-4" />
    </DropdownMenu.SubTrigger>
  );
}

function DropdownMenuSubContent({ className, ...props }: React.ComponentProps<typeof DropdownMenu.SubContent>) {
  return (
    <DropdownMenu.SubContent
      className={cn("z-50 min-w-48 rounded-2xl border border-border/70 bg-popover p-1.5 shadow-xl", className)}
      {...props}
    />
  );
}

export {
  DropdownMenuRoot,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuRadioGroup,
};
