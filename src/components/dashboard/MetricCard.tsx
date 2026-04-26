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
    <div
      className="relative rounded-xl border border-border bg-card p-5 overflow-hidden group transition-all hover:border-primary/40"
      style={{ background: "var(--gradient-card)", boxShadow: "var(--shadow-card)" }}
    >
      <div className="flex items-center justify-between mb-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          {label}
        </span>
        {icon && <span className="text-muted-foreground">{icon}</span>}
      </div>
      <div className={cn("font-mono text-3xl font-bold tabular-nums", toneClass)}>
        {value}
      </div>
      {sub && <div className="mt-1 text-xs text-muted-foreground font-mono">{sub}</div>}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
    </div>
  );
}
