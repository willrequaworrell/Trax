import * as React from "react";
import { Check, CaretRight } from "@phosphor-icons/react";
import { ContextMenu } from "radix-ui";

import { cn } from "@/lib/utils";

const ContextMenuRoot = ContextMenu.Root;
const ContextMenuTrigger = ContextMenu.Trigger;
const ContextMenuPortal = ContextMenu.Portal;
const ContextMenuSub = ContextMenu.Sub;

function ContextMenuContent({
  className,
  ...props
}: React.ComponentProps<typeof ContextMenu.Content>) {
  return (
    <ContextMenuPortal>
      <ContextMenu.Content
        className={cn(
          "z-50 min-w-52 overflow-hidden rounded-2xl border border-border/70 bg-popover p-1.5 text-popover-foreground shadow-xl",
          className,
        )}
        {...props}
      />
    </ContextMenuPortal>
  );
}

function ContextMenuItem({
  className,
  inset,
  ...props
}: React.ComponentProps<typeof ContextMenu.Item> & { inset?: boolean }) {
  return (
    <ContextMenu.Item
      className={cn(
        "relative flex cursor-default items-center gap-2 rounded-xl px-2.5 py-2 text-sm outline-none transition hover:bg-muted focus:bg-muted data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        inset && "pl-8",
        className,
      )}
      {...props}
    />
  );
}

function ContextMenuCheckboxItem({
  className,
  children,
  checked,
  ...props
}: React.ComponentProps<typeof ContextMenu.CheckboxItem>) {
  return (
    <ContextMenu.CheckboxItem
      checked={checked}
      className={cn(
        "relative flex cursor-default items-center gap-2 rounded-xl py-2 pr-2 pl-8 text-sm outline-none transition hover:bg-muted focus:bg-muted data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    >
      <span className="absolute left-2 flex size-4 items-center justify-center">
        <ContextMenu.ItemIndicator>
          <Check className="size-3.5" />
        </ContextMenu.ItemIndicator>
      </span>
      {children}
    </ContextMenu.CheckboxItem>
  );
}

function ContextMenuLabel({
  className,
  inset,
  ...props
}: React.ComponentProps<typeof ContextMenu.Label> & { inset?: boolean }) {
  return (
    <ContextMenu.Label
      className={cn("px-2.5 py-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground", inset && "pl-8", className)}
      {...props}
    />
  );
}

function ContextMenuSeparator({ className, ...props }: React.ComponentProps<typeof ContextMenu.Separator>) {
  return <ContextMenu.Separator className={cn("my-1 h-px bg-border/70", className)} {...props} />;
}

function ContextMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: React.ComponentProps<typeof ContextMenu.SubTrigger> & { inset?: boolean }) {
  return (
    <ContextMenu.SubTrigger
      className={cn(
        "flex cursor-default items-center rounded-xl px-2.5 py-2 text-sm outline-none hover:bg-muted focus:bg-muted data-[state=open]:bg-muted",
        inset && "pl-8",
        className,
      )}
      {...props}
    >
      {children}
      <CaretRight className="ml-auto size-4" />
    </ContextMenu.SubTrigger>
  );
}

function ContextMenuSubContent({ className, ...props }: React.ComponentProps<typeof ContextMenu.SubContent>) {
  return (
    <ContextMenu.SubContent
      className={cn("z-50 min-w-48 rounded-2xl border border-border/70 bg-popover p-1.5 shadow-xl", className)}
      {...props}
    />
  );
}

export {
  ContextMenuRoot,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuCheckboxItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
};
