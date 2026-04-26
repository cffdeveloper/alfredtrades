import { cn } from "@/lib/utils";
import { ArrowUpRight, ArrowDownRight, Minus, ShieldAlert } from "lucide-react";

const styles: Record<string, string> = {
  BUY: "bg-success/10 border-success/50 text-success shadow-[0_0_12px_-4px_var(--success)]",
  SELL: "bg-destructive/10 border-destructive/50 text-destructive shadow-[0_0_12px_-4px_var(--destructive)]",
  HOLD: "bg-muted/40 border-border text-muted-foreground",
  "STOP-LOSS": "bg-warning/10 border-warning/50 text-warning shadow-[0_0_12px_-4px_var(--warning)]",
};

const icons: Record<string, React.ComponentType<{ className?: string }>> = {
  BUY: ArrowUpRight,
  SELL: ArrowDownRight,
  HOLD: Minus,
  "STOP-LOSS": ShieldAlert,
};

export function SignalBadge({ signal }: { signal: string }) {
  const Icon = icons[signal] ?? Minus;
  return (
    <span className={cn(
      "inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[10px] font-mono font-bold tracking-wider",
      styles[signal] ?? styles.HOLD
    )}>
      <Icon className="h-3 w-3" />
      {signal}
    </span>
  );
}
