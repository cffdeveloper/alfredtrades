import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface Props {
  label: string;
  value: string;
  sub?: string;
  icon?: ReactNode;
  tone?: "default" | "positive" | "negative" | "primary";
  ornament?: string; // e.g. "01", "02" — faint serif numeral in the corner
}

export function MetricCard({ label, value, sub, icon, tone = "default", ornament }: Props) {
  const toneClass =
    tone === "positive" ? "text-success"
    : tone === "negative" ? "text-destructive"
    : "text-foreground";

  return (
    <div className="tech-card relative rounded-md border border-border bg-card/90 backdrop-blur-sm p-2.5 sm:p-4 transition-colors hover:border-primary/60 overflow-hidden">
      {ornament && (
        <span className="ornament-numeral absolute top-1 right-2 sm:top-1.5 sm:right-2.5 text-2xl sm:text-4xl">{ornament}</span>
      )}

      <div className="flex items-center justify-between mb-1.5 sm:mb-2.5">
        <span className="eyebrow flex items-center gap-1.5 text-[9px] sm:text-[10px]">
          <span className="inline-block w-1 h-1 rounded-full bg-primary live-dot" />
          {label}
        </span>
        {icon && <span className="text-muted-foreground">{icon}</span>}
      </div>

      <div className={cn("font-mono text-base sm:text-xl lg:text-2xl font-semibold tabular-nums tracking-tight leading-none break-all", toneClass)}>
        {value}
      </div>

      {sub && (
        <div className="mt-1.5 sm:mt-2 text-[10px] sm:text-[11px] text-muted-foreground flex items-center gap-1.5 font-mono">
          <span className="inline-block w-2 sm:w-3 h-px bg-primary/40 shrink-0" />
          <span className="truncate">{sub}</span>
        </div>
      )}
    </div>
  );
}
