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
    <div className="tech-card relative rounded-xl border border-border bg-card/95 backdrop-blur-sm p-3 sm:p-6 transition-colors hover:border-primary/40 overflow-hidden">
      {/* Faint serif ornament numeral, top-right */}
      {ornament && (
        <span className="ornament-numeral absolute top-1.5 right-2 sm:top-2 sm:right-3 text-3xl sm:text-5xl">{ornament}</span>
      )}

      <div className="flex items-center justify-between mb-2 sm:mb-4">
        <span className="eyebrow flex items-center gap-1.5 sm:gap-2 text-[9px] sm:text-[10px]">
          <span className="inline-block w-1 h-1 rounded-full bg-primary live-dot" />
          {label}
        </span>
        {icon && <span className="text-muted-foreground">{icon}</span>}
      </div>

      <div className={cn("font-display text-xl sm:text-3xl lg:text-4xl font-medium tabular-nums tracking-tight leading-none break-all", toneClass)}>
        {value}
      </div>

      {sub && (
        <div className="mt-2 sm:mt-3 text-[10px] sm:text-[11px] text-muted-foreground flex items-center gap-2">
          <span className="inline-block w-2 sm:w-3 h-px bg-border shrink-0" />
          <span className="truncate">{sub}</span>
        </div>
      )}
    </div>
  );
}
