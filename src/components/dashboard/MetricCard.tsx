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

  const glowColor =
    tone === "positive" ? "var(--success)"
    : tone === "negative" ? "var(--destructive)"
    : "var(--primary)";

  return (
    <div
      className="tech-card relative rounded-xl border border-border bg-card p-5 overflow-hidden group transition-all hover:border-primary/60 hover:-translate-y-0.5"
      style={{
        background: "var(--gradient-card)",
        boxShadow: `var(--shadow-card), inset 0 1px 0 0 color-mix(in oklab, ${glowColor} 8%, transparent)`,
      }}
    >
      {/* animated top accent line */}
      <div
        className="absolute inset-x-0 top-0 h-px opacity-60"
        style={{ background: `linear-gradient(90deg, transparent, ${glowColor}, transparent)` }}
      />
      {/* radial glow on hover */}
      <div
        className="absolute -top-12 -right-12 w-32 h-32 rounded-full opacity-0 group-hover:opacity-40 transition-opacity blur-2xl"
        style={{ background: glowColor }}
      />

      <div className="relative flex items-center justify-between mb-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground flex items-center gap-1.5">
          <span className="inline-block w-1 h-1 rounded-full bg-primary live-dot" />
          {label}
        </span>
        {icon && (
          <span
            className={cn("p-1.5 rounded-md border border-border/60 bg-background/40", toneClass)}
            style={{ boxShadow: `0 0 12px -4px ${glowColor}` }}
          >
            {icon}
          </span>
        )}
      </div>

      <div className={cn("relative font-mono text-3xl font-bold tabular-nums tracking-tight", toneClass)}
        style={{ textShadow: tone !== "default" ? `0 0 24px color-mix(in oklab, ${glowColor} 35%, transparent)` : undefined }}
      >
        {value}
      </div>

      {sub && (
        <div className="relative mt-1.5 text-[11px] text-muted-foreground font-mono flex items-center gap-1.5">
          <span className="inline-block w-3 h-px bg-muted-foreground/40" />
          {sub}
        </div>
      )}
    </div>
  );
}
