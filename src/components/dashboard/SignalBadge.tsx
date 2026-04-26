import { cn } from "@/lib/utils";

const styles: Record<string, string> = {
  BUY: "bg-success/10 border-success/40 text-success",
  SELL: "bg-destructive/10 border-destructive/40 text-destructive",
  HOLD: "bg-muted border-border text-muted-foreground",
  "STOP-LOSS": "bg-warning/10 border-warning/40 text-warning",
};

export function SignalBadge({ signal }: { signal: string }) {
  return (
    <span className={cn(
      "inline-flex items-center px-2 py-0.5 rounded-md border text-[10px] font-mono font-bold tracking-wider",
      styles[signal] ?? styles.HOLD
    )}>
      {signal}
    </span>
  );
}
