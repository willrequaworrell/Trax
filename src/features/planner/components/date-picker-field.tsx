"use client";

import { CalendarBlank, X } from "@phosphor-icons/react";
import { format } from "date-fns";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { PopoverContent, PopoverRoot, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type Props = {
  value: string | null;
  onChange: (value: string | null) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  triggerClassName?: string;
};

export function DatePickerField({
  value,
  onChange,
  disabled,
  placeholder = "Set date",
  className,
  open,
  onOpenChange,
  triggerClassName,
}: Props) {
  const [internalOpen, setInternalOpen] = useState(false);
  const selected = value ? new Date(`${value}T12:00:00.000Z`) : undefined;
  const isOpen = open ?? internalOpen;

  function handleOpenChange(nextOpen: boolean) {
    if (open === undefined) {
      setInternalOpen(nextOpen);
    }

    onOpenChange?.(nextOpen);
  }

  return (
    <PopoverRoot open={isOpen} onOpenChange={handleOpenChange}>
      <div className={cn("flex items-center gap-1", className)}>
        <PopoverTrigger asChild disabled={disabled}>
          <Button
            type="button"
            variant="outline"
            className={cn(
              "h-9 justify-start rounded-xl px-3 text-sm font-normal shadow-none",
              !value && "text-muted-foreground",
              triggerClassName,
            )}
            disabled={disabled}
          >
            <CalendarBlank className="size-4" />
            {value ? format(selected!, "MMM d, yyyy") : placeholder}
          </Button>
        </PopoverTrigger>
        {value ? (
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            className="rounded-full"
            onClick={() => onChange(null)}
            disabled={disabled}
          >
            <X className="size-3.5" />
          </Button>
        ) : null}
      </div>
      <PopoverContent className="w-auto overflow-hidden p-0">
        <Calendar
          className="rounded-none border-0"
          mode="single"
          defaultMonth={selected}
          selected={selected}
          onSelect={(date) => {
            onChange(date ? format(date, "yyyy-MM-dd") : null);
            handleOpenChange(false);
          }}
        />
        <div className="border-t border-border/70 p-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-full rounded-lg"
            onClick={() => {
              onChange(format(new Date(), "yyyy-MM-dd"));
              handleOpenChange(false);
            }}
          >
            Today
          </Button>
        </div>
      </PopoverContent>
    </PopoverRoot>
  );
}
