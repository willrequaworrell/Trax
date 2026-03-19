import * as React from "react";
import { Slider } from "radix-ui";

import { cn } from "@/lib/utils";

function SliderRoot({ className, ...props }: React.ComponentProps<typeof Slider.Root>) {
  return (
    <Slider.Root
      className={cn("relative flex w-full touch-none select-none items-center", className)}
      {...props}
    />
  );
}

function SliderTrack({ className, ...props }: React.ComponentProps<typeof Slider.Track>) {
  return (
    <Slider.Track
      className={cn("relative h-2 w-full grow overflow-hidden rounded-full bg-muted", className)}
      {...props}
    />
  );
}

function SliderRange({ className, ...props }: React.ComponentProps<typeof Slider.Range>) {
  return <Slider.Range className={cn("absolute h-full bg-chart-1", className)} {...props} />;
}

function SliderThumb({ className, ...props }: React.ComponentProps<typeof Slider.Thumb>) {
  return (
    <Slider.Thumb
      className={cn(
        "block size-4 rounded-full border border-border bg-background shadow-sm transition hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30",
        className,
      )}
      {...props}
    />
  );
}

export { SliderRoot, SliderTrack, SliderRange, SliderThumb };
