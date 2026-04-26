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
    <div className="tech-card relative rounded-xl border border-border bg-card p-6 transition-colors hover:border-primary/40 overflow-hidden">
      {/* Faint serif ornament numeral, top-right */}
      {ornament && (
        <span className="ornament-numeral absolute top-2 right-3 text-5xl">{ornament}</span>
      )}

      <div className="flex items-center justify-between mb-4">
        <span className="eyebrow flex items-center gap-2">
          <span className="inline-block w-1 h-1 rounded-full bg-primary live-dot" />
          {label}
        </span>
        {icon && <span className="text-muted-foreground">{icon}</span>}
      </div>

      <div className={cn("font-display text-4xl font-medium tabular-nums tracking-tight leading-none", toneClass)}>
        {value}
      </div>

      {sub && (
        <div className="mt-3 text-[11px] text-muted-foreground flex items-center gap-2">
          <span className="inline-block w-3 h-px bg-border" />
          {sub}
        </div>
      )}
    </div>
  );
}
