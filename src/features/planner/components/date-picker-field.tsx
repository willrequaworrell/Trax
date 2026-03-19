"use client";

import { CalendarBlank, X } from "@phosphor-icons/react";
import { format } from "date-fns";

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
  const selected = value ? new Date(`${value}T12:00:00.000Z`) : undefined;

  return (
    <PopoverRoot open={open} onOpenChange={onOpenChange}>
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
      <PopoverContent className="w-auto p-0">
        <Calendar
          mode="single"
          selected={selected}
          onSelect={(date) => onChange(date ? date.toISOString().slice(0, 10) : null)}
        />
      </PopoverContent>
    </PopoverRoot>
  );
}
