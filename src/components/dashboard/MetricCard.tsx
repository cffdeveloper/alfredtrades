import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface Props {
  label: string;
  value: string;
  sub?: string;
  icon?: ReactNode;
  tone?: "default" | "positive" | "negative" | "primary";
}

export function MetricCard({ label, value, sub, icon, tone = "default" }: Props) {
  const toneClass =
    tone === "positive" ? "text-success"
    : tone === "negative" ? "text-destructive"
    : tone === "primary" ? "text-primary"
    : "text-foreground";



  return (
    <div className="tech-card relative rounded-xl border border-border bg-card p-5 transition-colors hover:border-primary/40">
      <div className="flex items-center justify-between mb-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground flex items-center gap-1.5">
          <span className="inline-block w-1 h-1 rounded-full bg-primary live-dot" />
          {label}
        </span>
        {icon && (
          <span className={cn("p-1.5 rounded-md border border-border bg-muted", toneClass)}>
            {icon}
          </span>
        )}
      </div>

      <div className={cn("font-mono text-3xl font-bold tabular-nums tracking-tight", toneClass)}>
        {value}
      </div>

      {sub && (
        <div className="mt-1.5 text-[11px] text-muted-foreground font-mono flex items-center gap-1.5">
          <span className="inline-block w-3 h-px bg-muted-foreground/40" />
          {sub}
        </div>
      )}
    </div>
  );
}
