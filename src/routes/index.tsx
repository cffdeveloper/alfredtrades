import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { SignalBadge } from "@/components/dashboard/SignalBadge";
import { fmtUSD, fmtPct, fmtTime } from "@/lib/format";
import { toast } from "sonner";
import {
  Activity, DollarSign, Wallet, Target, TrendingUp, Play, RefreshCw, CircleDot,
} from "lucide-react";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, BarChart, Bar, Cell,
} from "recharts";

export const Route = createFileRoute("/")({
  component: Dashboard,
  head: () => ({
    meta: [
      { title: "Maverick Bot — Algorithmic Trading Dashboard" },
      { name: "description", content: "Live paper-trading dashboard for the Maverick Golden-Cross + RSI + ATR strategy on Alpaca." },
    ],
  }),
});

interface Snapshot {
  id: string; equity: number; cash: number; portfolio_value: number; buying_power: number;
  positions: Array<{ symbol: string; qty: number; avg_entry: number; current_price: number; market_value: number; unrealized_pl: number; unrealized_plpc: number }>;
  created_at: string;
}
interface Signal { id: string; symbol: string; signal: string; price: number; reason: string | null; rsi: number | null; created_at: string }
interface Trade { id: string; symbol: string; side: string; qty: number; price: number; value: number; created_at: string }
interface Run { id: string; status: string; trades_executed: number; signals_generated: number; market_open: boolean | null; duration_ms: number | null; created_at: string; message: string | null }

function Dashboard() {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [running, setRunning] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadAll = async () => {
    const [snapRes, sigRes, trdRes, runRes] = await Promise.all([
      supabase.from("portfolio_snapshots").select("*").order("created_at", { ascending: false }).limit(200),
      supabase.from("bot_signals").select("*").order("created_at", { ascending: false }).limit(60),
      supabase.from("bot_trades").select("*").order("created_at", { ascending: false }).limit(60),
      supabase.from("bot_runs").select("*").order("created_at", { ascending: false }).limit(20),
    ]);
    if (snapRes.data) setSnapshots(snapRes.data as Snapshot[]);
    if (sigRes.data) setSignals(sigRes.data as Signal[]);
    if (trdRes.data) setTrades(trdRes.data as Trade[]);
    if (runRes.data) setRuns(runRes.data as Run[]);
    setLoading(false);
  };

  useEffect(() => {
    loadAll();
    const t = setInterval(loadAll, 30_000);
    return () => clearInterval(t);
  }, []);

  const runBot = async () => {
    setRunning(true);
    toast.loading("Running bot cycle…", { id: "bot-run" });
    try {
      const { data, error } = await supabase.functions.invoke("run-bot");
      if (error) throw error;
      const d = data as { runStatus: string; marketOpen: boolean; tradesExecuted: number; signalsGenerated: number; duration: number };
      toast.success(
        `Cycle complete (${d.duration}ms) — ${d.signalsGenerated} signals, ${d.tradesExecuted} trades${d.marketOpen ? "" : " · market closed"}`,
        { id: "bot-run" },
      );
      await loadAll();
    } catch (e) {
      toast.error(`Bot run failed: ${(e as Error).message}`, { id: "bot-run" });
    } finally {
      setRunning(false);
    }
  };

  const latest = snapshots[0];
  const first = snapshots[snapshots.length - 1];
  const totalReturn = latest && first ? ((latest.equity - first.equity) / first.equity) * 100 : 0;
  const lastRun = runs[0];
  const positions = latest?.positions ?? [];

  // Equity chart data — chronological
  const equitySeries = [...snapshots].reverse().map((s) => ({
    t: new Date(s.created_at).getTime(),
    label: fmtTime(s.created_at),
    equity: Number(s.equity),
    cash: Number(s.cash),
  }));

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="border-b border-border bg-card/40 backdrop-blur sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg flex items-center justify-center font-mono font-bold text-primary-foreground" style={{ background: "var(--gradient-primary)", boxShadow: "var(--shadow-glow)" }}>
              M
            </div>
            <div>
              <h1 className="font-mono font-bold text-lg leading-tight">MAVERICK BOT</h1>
              <p className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground font-mono">
                Golden Cross · RSI · ATR · Paper
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-md border border-border bg-card font-mono text-xs">
              <CircleDot className={`h-3 w-3 ${lastRun?.market_open ? "text-success animate-pulse" : "text-muted-foreground"}`} />
              {lastRun?.market_open ? "MARKET OPEN" : "MARKET CLOSED"}
            </div>
            <Button variant="outline" size="sm" onClick={loadAll} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
            <Button
              onClick={runBot}
              disabled={running}
              className="font-mono"
              style={{ background: "var(--gradient-primary)", color: "var(--primary-foreground)" }}
            >
              <Play className="h-4 w-4 mr-2" />
              {running ? "RUNNING…" : "RUN CYCLE"}
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        {/* Hero metrics */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MetricCard label="Portfolio Value" value={latest ? fmtUSD(latest.portfolio_value) : "—"} sub="Live equity + cash" icon={<DollarSign className="h-4 w-4" />} tone="primary" />
          <MetricCard label="Total Return" value={latest ? fmtPct(totalReturn) : "—"} sub={latest ? `Since ${fmtTime(first!.created_at)}` : ""} icon={<TrendingUp className="h-4 w-4" />} tone={totalReturn >= 0 ? "positive" : "negative"} />
          <MetricCard label="Cash" value={latest ? fmtUSD(latest.cash) : "—"} sub={latest ? `BP ${fmtUSD(latest.buying_power, 0)}` : ""} icon={<Wallet className="h-4 w-4" />} />
          <MetricCard label="Open Positions" value={String(positions.length)} sub={`${trades.length} total trades`} icon={<Target className="h-4 w-4" />} />
        </section>

        {/* Equity curve */}
        <section className="rounded-xl border border-border bg-card/60 p-6" style={{ boxShadow: "var(--shadow-card)" }}>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-mono text-xs uppercase tracking-[0.25em] text-primary">Equity Curve</h2>
              <p className="text-sm text-muted-foreground mt-1">Portfolio value over time</p>
            </div>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </div>
          {equitySeries.length > 1 ? (
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={equitySeries}>
                <defs>
                  <linearGradient id="eq" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="oklch(0.78 0.16 220)" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="oklch(0.78 0.16 220)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="oklch(0.30 0.04 255)" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" stroke="oklch(0.62 0.03 250)" fontSize={11} tickLine={false} />
                <YAxis stroke="oklch(0.62 0.03 250)" fontSize={11} tickLine={false} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} domain={["auto", "auto"]} />
                <Tooltip
                  contentStyle={{ background: "oklch(0.21 0.03 250)", border: "1px solid oklch(0.30 0.04 255)", borderRadius: 8, fontFamily: "JetBrains Mono" }}
                  labelStyle={{ color: "oklch(0.62 0.03 250)" }}
                  formatter={(v: number) => fmtUSD(v)}
                />
                <Area type="monotone" dataKey="equity" stroke="oklch(0.78 0.16 220)" strokeWidth={2} fill="url(#eq)" />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[300px] flex flex-col items-center justify-center text-center text-muted-foreground">
              <Activity className="h-10 w-10 mb-3 opacity-40" />
              <p className="font-mono text-sm">No snapshots yet</p>
              <p className="text-xs mt-1">Click <span className="text-primary">RUN CYCLE</span> to capture your first portfolio snapshot.</p>
            </div>
          )}
        </section>

        {/* Positions */}
        <section className="rounded-xl border border-border bg-card/60 p-6" style={{ boxShadow: "var(--shadow-card)" }}>
          <h2 className="font-mono text-xs uppercase tracking-[0.25em] text-primary mb-4">Open Positions</h2>
          {positions.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">No open positions.</p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm font-mono">
                  <thead className="text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
                    <tr>
                      <th className="text-left py-2">Symbol</th>
                      <th className="text-right py-2">Qty</th>
                      <th className="text-right py-2">Avg Entry</th>
                      <th className="text-right py-2">Current</th>
                      <th className="text-right py-2">Market Value</th>
                      <th className="text-right py-2">P&amp;L $</th>
                      <th className="text-right py-2">P&amp;L %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {positions.map((p) => (
                      <tr key={p.symbol} className="border-b border-border/50 hover:bg-accent/30">
                        <td className="py-3 font-bold text-primary">{p.symbol}</td>
                        <td className="text-right">{p.qty}</td>
                        <td className="text-right">{fmtUSD(p.avg_entry)}</td>
                        <td className="text-right">{fmtUSD(p.current_price)}</td>
                        <td className="text-right">{fmtUSD(p.market_value)}</td>
                        <td className={`text-right font-bold ${p.unrealized_pl >= 0 ? "text-success" : "text-destructive"}`}>{fmtUSD(p.unrealized_pl)}</td>
                        <td className={`text-right font-bold ${p.unrealized_plpc >= 0 ? "text-success" : "text-destructive"}`}>{fmtPct(p.unrealized_plpc)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-6 h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={positions}>
                    <CartesianGrid stroke="oklch(0.30 0.04 255)" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="symbol" stroke="oklch(0.62 0.03 250)" fontSize={11} />
                    <YAxis stroke="oklch(0.62 0.03 250)" fontSize={11} tickFormatter={(v) => `$${v}`} />
                    <Tooltip contentStyle={{ background: "oklch(0.21 0.03 250)", border: "1px solid oklch(0.30 0.04 255)", borderRadius: 8 }} formatter={(v: number) => fmtUSD(v)} />
                    <Bar dataKey="unrealized_pl" radius={[6, 6, 0, 0]}>
                      {positions.map((p) => (
                        <Cell key={p.symbol} fill={p.unrealized_pl >= 0 ? "oklch(0.78 0.18 150)" : "oklch(0.68 0.21 22)"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </section>

        {/* Signals + Trades */}
        <section className="grid lg:grid-cols-2 gap-6">
          <div className="rounded-xl border border-border bg-card/60 p-6" style={{ boxShadow: "var(--shadow-card)" }}>
            <h2 className="font-mono text-xs uppercase tracking-[0.25em] text-primary mb-4">Recent Signals</h2>
            <div className="space-y-2 max-h-[480px] overflow-y-auto pr-2">
              {signals.length === 0 && <p className="text-sm text-muted-foreground py-8 text-center">No signals yet.</p>}
              {signals.map((s) => (
                <div key={s.id} className="flex items-center gap-3 p-3 rounded-lg border border-border/50 bg-background/30 hover:border-primary/30 transition-colors">
                  <SignalBadge signal={s.signal} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono font-bold text-sm">{s.symbol}</span>
                      <span className="font-mono text-xs text-muted-foreground tabular-nums">{fmtUSD(s.price)}</span>
                    </div>
                    {s.reason && <p className="text-xs text-muted-foreground truncate mt-0.5">{s.reason}</p>}
                  </div>
                  <span className="font-mono text-[10px] text-muted-foreground whitespace-nowrap">{fmtTime(s.created_at)}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card/60 p-6" style={{ boxShadow: "var(--shadow-card)" }}>
            <h2 className="font-mono text-xs uppercase tracking-[0.25em] text-primary mb-4">Executed Trades</h2>
            <div className="space-y-2 max-h-[480px] overflow-y-auto pr-2">
              {trades.length === 0 && <p className="text-sm text-muted-foreground py-8 text-center">No trades yet.</p>}
              {trades.map((t) => (
                <div key={t.id} className="flex items-center gap-3 p-3 rounded-lg border border-border/50 bg-background/30">
                  <span className={`px-2 py-0.5 rounded-md border text-[10px] font-mono font-bold tracking-wider ${t.side === "buy" ? "bg-success/10 border-success/40 text-success" : "bg-destructive/10 border-destructive/40 text-destructive"}`}>
                    {t.side.toUpperCase()}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-sm">
                      <span className="font-bold">{t.symbol}</span>
                      <span className="text-muted-foreground ml-2">{t.qty} @ {fmtUSD(t.price)}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">Total: {fmtUSD(t.value)}</p>
                  </div>
                  <span className="font-mono text-[10px] text-muted-foreground whitespace-nowrap">{fmtTime(t.created_at)}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Recent runs */}
        <section className="rounded-xl border border-border bg-card/60 p-6" style={{ boxShadow: "var(--shadow-card)" }}>
          <h2 className="font-mono text-xs uppercase tracking-[0.25em] text-primary mb-4">Bot Run History</h2>
          {runs.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">No runs yet — kick one off above.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm font-mono">
                <thead className="text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
                  <tr>
                    <th className="text-left py-2">Time</th>
                    <th className="text-left py-2">Status</th>
                    <th className="text-right py-2">Signals</th>
                    <th className="text-right py-2">Trades</th>
                    <th className="text-right py-2">Duration</th>
                    <th className="text-left py-2 pl-4">Market</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.id} className="border-b border-border/50">
                      <td className="py-2 text-muted-foreground">{fmtTime(r.created_at)}</td>
                      <td className={r.status === "success" ? "text-success" : "text-destructive"}>{r.status.toUpperCase()}</td>
                      <td className="text-right">{r.signals_generated}</td>
                      <td className="text-right">{r.trades_executed}</td>
                      <td className="text-right text-muted-foreground">{r.duration_ms}ms</td>
                      <td className="pl-4">{r.market_open ? <span className="text-success">OPEN</span> : <span className="text-muted-foreground">CLOSED</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <footer className="text-center pt-4 pb-8">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            Maverick Bot v1.0 · Paper Trading · Auto-refresh 30s
          </p>
        </footer>
      </main>
    </div>
  );
}
