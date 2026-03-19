import * as React from "react";
import { CaretLeft, CaretRight } from "@phosphor-icons/react";
import { DayPicker } from "react-day-picker";

import { cn } from "@/lib/utils";

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: React.ComponentProps<typeof DayPicker>) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("rounded-2xl border border-border/70 bg-background p-3", className)}
      classNames={{
        root: "w-fit",
        months: "flex flex-col",
        month: "space-y-3",
        month_caption: "relative flex items-center justify-center px-8 pt-1",
        caption_label: "text-sm font-semibold",
        nav: "flex items-center gap-1",
        button_previous:
          "absolute left-0 inline-flex size-8 cursor-pointer items-center justify-center rounded-lg border border-border/70 bg-background text-muted-foreground transition hover:text-foreground",
        button_next:
          "absolute right-0 inline-flex size-8 cursor-pointer items-center justify-center rounded-lg border border-border/70 bg-background text-muted-foreground transition hover:text-foreground",
        month_grid: "border-collapse",
        weekdays: "grid grid-cols-7",
        weekday: "flex h-9 items-center justify-center text-xs font-medium text-muted-foreground",
        week: "grid grid-cols-7",
        day: "flex items-center justify-center p-0 text-sm",
        day_button:
          "inline-flex size-9 cursor-pointer items-center justify-center rounded-lg text-sm transition hover:bg-muted focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:outline-none",
        selected: "rounded-lg bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground",
        today: "rounded-lg bg-muted font-semibold text-foreground",
        outside: "text-muted-foreground opacity-45",
        disabled: "text-muted-foreground opacity-35",
        range_middle: "bg-primary/10 text-foreground",
        hidden: "invisible",
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation, ...chevronProps }) =>
          orientation === "left" ? <CaretLeft className="size-4" {...chevronProps} /> : <CaretRight className="size-4" {...chevronProps} />,
      }}
      {...props}
    />
  );
}

export { Calendar };
