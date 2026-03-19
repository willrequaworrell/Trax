import * as React from "react";

import { cn } from "@/lib/utils";

function InputGroup({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex items-center rounded-xl border border-input bg-background shadow-xs focus-within:ring-2 focus-within:ring-ring/20", className)} {...props} />;
}

function InputGroupAddon({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex h-10 items-center px-3 text-muted-foreground", className)} {...props} />;
}

function InputGroupField({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      className={cn("h-10 w-full rounded-r-xl bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground", className)}
      {...props}
    />
  );
}

export { InputGroup, InputGroupAddon, InputGroupField };
