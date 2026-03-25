import { cn } from "@/lib/utils";

type Props = {
  className?: string;
  barClassName?: string;
};

export function BrandMark({ className, barClassName }: Props) {
  return (
    <div
      className={cn(
        "flex size-10 min-w-10 shrink-0 aspect-square items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm",
        className,
      )}
    >
      <div className="flex w-[18px] shrink-0 flex-col gap-1.5">
        <span className={cn("h-1.5 rounded-full bg-current", barClassName)} />
        <span className={cn("h-1.5 w-[14px] rounded-full bg-current opacity-80", barClassName)} />
        <span className={cn("h-1.5 w-[11px] rounded-full bg-current opacity-60", barClassName)} />
      </div>
    </div>
  );
}
