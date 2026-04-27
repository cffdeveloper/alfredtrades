import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { fmtUSD, fmtTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { RefreshCw, Play, Activity, Brain, TrendingUp, TrendingDown } from "lucide-react";
import { toast } from "sonner";

interface DerivBalance { id: string; balance: number; currency: string; loginid: string | null; created_at: string }
interface DerivTrade {
  id: string; symbol: string; contract_id: string | null; contract_type: string;
  digit: number; stake: number; payout: number | null; pnl: number | null;
  status: string; won: boolean | null; confidence: number | null;
  reasoning: string | null; created_at: string; settled_at: string | null;
}
interface DerivSignal {
  id: string; symbol: string; digit: number | null; contract_type: string | null;
  confidence: number | null; entropy: number | null; reasoning: string | null;
  acted: boolean; created_at: string;
}
interface DerivRun {
  id: string; status: string; message: string | null;
  ticks_collected: number | null; signals_generated: number | null;
  trades_executed: number | null; duration_ms: number | null; created_at: string;
}
interface DerivTick { id: string; symbol: string; quote: number; last_digit: number; epoch: number; created_at: string }

export function DerivPanel() {
  const [balance, setBalance] = useState<DerivBalance | null>(null);
  const [trades, setTrades] = useState<DerivTrade[]>([]);
  const [signals, setSignals] = useState<DerivSignal[]>([]);
  const [runs, setRuns] = useState<DerivRun[]>([]);
  const [recentTicks, setRecentTicks] = useState<DerivTick[]>([]);
  const [running, setRunning] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadAll = async () => {
    const [balRes, trdRes, sigRes, runRes, tickRes] = await Promise.all([
      supabase.from("deriv_balance").select("*").order("created_at", { ascending: false }).limit(1),
      supabase.from("deriv_trades").select("*").order("created_at", { ascending: false }).limit(50),
      supabase.from("deriv_signals").select("*").order("created_at", { ascending: false }).limit(40),
      supabase.from("deriv_runs").select("*").order("created_at", { ascending: false }).limit(20),
      supabase.from("deriv_ticks").select("*").order("epoch", { ascending: false }).limit(60),
    ]);
    if (balRes.data?.[0]) setBalance(balRes.data[0] as unknown as DerivBalance);
    if (trdRes.data) setTrades(trdRes.data as unknown as DerivTrade[]);
    if (sigRes.data) setSignals(sigRes.data as unknown as DerivSignal[]);
    if (runRes.data) setRuns(runRes.data as unknown as DerivRun[]);
    if (tickRes.data) setRecentTicks(tickRes.data as unknown as DerivTick[]);
    setLoading(false);
  };

  useEffect(() => {
    loadAll();
    const t = setInterval(loadAll, 5000);
    return () => clearInterval(t);
  }, []);

  const runCycle = async () => {
    setRunning(true);
    try {
      const { error } = await supabase.functions.invoke("deriv-bot");
      if (error) throw error;
      toast.success("Deriv cycle complete");
      await loadAll();
    } catch (e) {
      toast.error("Deriv cycle failed: " + (e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const closedTrades = trades.filter((t) => t.pnl !== null);
  const wins = closedTrades.filter((t) => t.won).length;
  const totalPnl = closedTrades.reduce((s, t) => s + (t.pnl ?? 0), 0);
  const winRate = closedTrades.length ? (wins / closedTrades.length) * 100 : 0;
  const openTrades = trades.filter((t) => t.status === "open").length;

  // Digit frequency from recent ticks
  const digitCounts = new Array(10).fill(0);
  for (const t of recentTicks) digitCounts[t.last_digit]++;
  const maxCount = Math.max(...digitCounts, 1);

  if (loading) {
    return <div className="text-center py-20 text-muted-foreground">Loading Deriv data…</div>;
  }

  return (
    <div className="space-y-8">
      {/* Header row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="eyebrow !text-[var(--gold)]">Deriv · Matches/Differs</p>
          <h2 className="font-display text-2xl sm:text-3xl tracking-tight">
            R_50 · Bayesian + Pattern Engine
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            {balance ? `${balance.loginid ?? "Demo"} · ${balance.currency} ${balance.balance.toFixed(2)}` : "Awaiting balance…"}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={loadAll}>
            <RefreshCw className="h-3.5 w-3.5 mr-2" /> Refresh
          </Button>
          <Button size="sm" onClick={runCycle} disabled={running}>
            <Play className="h-3.5 w-3.5 mr-2" fill="currentColor" />
            {running ? "Running…" : "Run Cycle"}
          </Button>
        </div>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <MetricCard
          label="Balance"
          value={balance ? fmtUSD(balance.balance) : "—"}
          sub={balance?.loginid ?? "Demo account"}
          ornament="01"
        />
        <MetricCard
          label="Total P&L"
          value={fmtUSD(totalPnl)}
          sub={`${closedTrades.length} settled`}
          tone={totalPnl >= 0 ? "positive" : "negative"}
          ornament="02"
        />
        <MetricCard
          label="Win Rate"
          value={`${winRate.toFixed(1)}%`}
          sub={`${wins}W / ${closedTrades.length - wins}L`}
          ornament="03"
        />
        <MetricCard
          label="Open"
          value={String(openTrades)}
          sub={`${trades.length} total trades`}
          ornament="04"
        />
      </div>

      {/* Digit distribution */}
      <section>
        <p className="eyebrow mb-3 flex items-center gap-2">
          <Activity className="h-3 w-3" /> Last {recentTicks.length} ticks · digit distribution
        </p>
        <div className="tech-card rounded-xl border border-border bg-card/95 p-4">
          <div className="grid grid-cols-10 gap-2">
            {digitCounts.map((c, d) => {
              const pct = (c / Math.max(recentTicks.length, 1)) * 100;
              const hot = c >= maxCount;
              return (
                <div key={d} className="flex flex-col items-center gap-1">
                  <div className="w-full h-20 bg-muted rounded relative overflow-hidden flex items-end">
                    <div
                      className={hot ? "bg-primary w-full" : "bg-muted-foreground/30 w-full"}
                      style={{ height: `${(c / maxCount) * 100}%` }}
                    />
                  </div>
                  <span className="font-mono text-xs tabular-nums">{d}</span>
                  <span className="text-[10px] text-muted-foreground tabular-nums">{pct.toFixed(0)}%</span>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Recent signals */}
      <section>
        <p className="eyebrow mb-3 flex items-center gap-2">
          <Brain className="h-3 w-3" /> Recent signals
        </p>
        <div className="tech-card rounded-xl border border-border bg-card/95 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs sm:text-sm">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="text-left p-2 font-medium">Time</th>
                  <th className="text-left p-2 font-medium">Type</th>
                  <th className="text-left p-2 font-medium">Digit</th>
                  <th className="text-left p-2 font-medium">Conf</th>
                  <th className="text-left p-2 font-medium">Entropy</th>
                  <th className="text-left p-2 font-medium">Acted</th>
                  <th className="text-left p-2 font-medium hidden md:table-cell">Reasoning</th>
                </tr>
              </thead>
              <tbody>
                {signals.slice(0, 15).map((s) => (
                  <tr key={s.id} className="border-t border-border">
                    <td className="p-2 font-mono text-muted-foreground">{fmtTime(s.created_at)}</td>
                    <td className="p-2">
                      <span className={s.contract_type === "DIGITMATCH" ? "text-success" : "text-warning"}>
                        {s.contract_type ?? "—"}
                      </span>
                    </td>
                    <td className="p-2 font-mono tabular-nums">{s.digit ?? "—"}</td>
                    <td className="p-2 font-mono tabular-nums">
                      {s.confidence !== null ? (s.confidence * 100).toFixed(1) + "%" : "—"}
                    </td>
                    <td className="p-2 font-mono tabular-nums text-muted-foreground">
                      {s.entropy !== null ? Number(s.entropy).toFixed(2) : "—"}
                    </td>
                    <td className="p-2">
                      {s.acted ? <span className="text-success">●</span> : <span className="text-muted-foreground">○</span>}
                    </td>
                    <td className="p-2 text-muted-foreground hidden md:table-cell truncate max-w-xs">
                      {s.reasoning}
                    </td>
                  </tr>
                ))}
                {!signals.length && (
                  <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">No signals yet — bot is warming up.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Recent trades */}
      <section>
        <p className="eyebrow mb-3">Recent trades</p>
        <div className="tech-card rounded-xl border border-border bg-card/95 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs sm:text-sm">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="text-left p-2 font-medium">Time</th>
                  <th className="text-left p-2 font-medium">Type</th>
                  <th className="text-left p-2 font-medium">Digit</th>
                  <th className="text-left p-2 font-medium">Stake</th>
                  <th className="text-left p-2 font-medium">P&L</th>
                  <th className="text-left p-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {trades.slice(0, 20).map((t) => (
                  <tr key={t.id} className="border-t border-border">
                    <td className="p-2 font-mono text-muted-foreground">{fmtTime(t.created_at)}</td>
                    <td className="p-2">
                      <span className={t.contract_type === "DIGITMATCH" ? "text-success" : "text-warning"}>
                        {t.contract_type}
                      </span>
                    </td>
                    <td className="p-2 font-mono tabular-nums">{t.digit}</td>
                    <td className="p-2 font-mono tabular-nums">{fmtUSD(t.stake)}</td>
                    <td className="p-2 font-mono tabular-nums">
                      {t.pnl !== null ? (
                        <span className={t.won ? "text-success" : "text-destructive"}>
                          {t.won ? <TrendingUp className="h-3 w-3 inline mr-1" /> : <TrendingDown className="h-3 w-3 inline mr-1" />}
                          {fmtUSD(t.pnl)}
                        </span>
                      ) : <span className="text-muted-foreground">pending</span>}
                    </td>
                    <td className="p-2 text-muted-foreground">{t.status}</td>
                  </tr>
                ))}
                {!trades.length && (
                  <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">No trades yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Run log */}
      <section>
        <p className="eyebrow mb-3">Cycle log</p>
        <div className="tech-card rounded-xl border border-border bg-card/95 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs sm:text-sm">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="text-left p-2 font-medium">Time</th>
                  <th className="text-left p-2 font-medium">Status</th>
                  <th className="text-left p-2 font-medium">Ticks</th>
                  <th className="text-left p-2 font-medium">Trades</th>
                  <th className="text-left p-2 font-medium">Duration</th>
                  <th className="text-left p-2 font-medium">Message</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} className="border-t border-border">
                    <td className="p-2 font-mono text-muted-foreground">{fmtTime(r.created_at)}</td>
                    <td className="p-2">
                      <span className={r.status === "success" ? "text-success" : "text-destructive"}>
                        {r.status}
                      </span>
                    </td>
                    <td className="p-2 font-mono tabular-nums">{r.ticks_collected ?? 0}</td>
                    <td className="p-2 font-mono tabular-nums">{r.trades_executed ?? 0}</td>
                    <td className="p-2 font-mono tabular-nums text-muted-foreground">
                      {r.duration_ms ? `${(r.duration_ms / 1000).toFixed(1)}s` : "—"}
                    </td>
                    <td className="p-2 text-muted-foreground truncate max-w-md">{r.message ?? "—"}</td>
                  </tr>
                ))}
                {!runs.length && (
                  <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">No cycles yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}
