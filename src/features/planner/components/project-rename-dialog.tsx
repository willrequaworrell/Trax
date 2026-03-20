"use client";

import { useId } from "react";

import { Button } from "@/components/ui/button";
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
import { Spinner } from "@/components/ui/spinner";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialName: string;
  onSubmit: (name: string) => void | Promise<void>;
  isPending?: boolean;
};

export function ProjectRenameDialog({ open, onOpenChange, initialName, onSubmit, isPending = false }: Props) {
  const formId = useId();

  async function handleSubmit(formData: FormData) {
    const name = String(formData.get("name") ?? "").trim();

    if (!name) {
      return;
    }

    if (name === initialName) {
      onOpenChange(false);
      return;
    }

    await onSubmit(name);
  }

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Rename project</DialogTitle>
          <DialogDescription>Update the project name everywhere it appears in your workspace.</DialogDescription>
        </DialogHeader>
        <form
          id={formId}
          onSubmit={(event) => {
            event.preventDefault();
            void handleSubmit(new FormData(event.currentTarget));
          }}
        >
          <DialogBody className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Project name</label>
            <Input name="name" defaultValue={initialName} placeholder="Website relaunch" required />
          </DialogBody>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form={formId} disabled={isPending}>
            {isPending ? <Spinner /> : null}
            Save name
          </Button>
        </DialogFooter>
      </DialogContent>
    </DialogRoot>
  );
}
