"use client";

import { Toaster } from "sonner";

export function Sonner() {
  return (
    <Toaster
      closeButton
      position="top-right"
      richColors
      toastOptions={{
        classNames: {
          toast: "!rounded-2xl !border !border-border/70 !bg-background !text-foreground !shadow-xl",
          description: "!text-muted-foreground",
          actionButton: "!bg-primary !text-primary-foreground",
        },
      }}
    />
  );
}
