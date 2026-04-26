import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { SignalBadge } from "@/components/dashboard/SignalBadge";
import { fmtUSD, fmtPct, fmtTime } from "@/lib/format";
import { toast } from "sonner";
import {
  Activity, DollarSign, Target, TrendingUp, Play, RefreshCw, CircleDot, Brain, Layers,
  Zap, Radio, Cpu, Terminal,
} from "lucide-react";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, BarChart, Bar, Cell,
} from "recharts";

export const Route = createFileRoute("/")({
  component: Dashboard,
  head: () => ({
    meta: [
      { title: "Maverick Bot v2 — Multi-Strategy Trading Dashboard" },
      { name: "description", content: "Live paper-trading dashboard for the Maverick v2 multi-strategy engine: VWAP Z-Score · Adaptive Momentum · Opening Range Breakout." },
    ],
  }),
});

interface Position { symbol: string; qty: number; avg_entry: number; current_price: number; market_value: number; unrealized_pl: number; unrealized_plpc: number }
interface Snapshot { id: string; equity: number; cash: number; portfolio_value: number; buying_power: number; positions: Position[]; daily_pl: number | null; created_at: string }
interface Signal { id: string; symbol: string; signal: string; price: number; reason: string | null; rsi: number | null; strategy: string | null; confidence: number | null; regime: string | null; zscore: number | null; created_at: string }
interface Trade { id: string; symbol: string; side: string; qty: number; price: number; value: number; strategy: string | null; confidence: number | null; stop_price: number | null; target_price: number | null; created_at: string }
interface Run { id: string; status: string; trades_executed: number; signals_generated: number; market_open: boolean | null; duration_ms: number | null; created_at: string; message: string | null; daily_pl: number | null; halt_entries: boolean | null; regime_summary: Record<string, { regime: string; conf: number }> | null }

const REGIME_COLORS: Record<string, string> = {
  TRENDING_UP: "text-success border-success/40 bg-success/10",
  TRENDING_DOWN: "text-destructive border-destructive/40 bg-destructive/10",
  RANGING: "text-primary border-primary/40 bg-primary/10",
  VOLATILE: "text-warning border-warning/40 bg-warning/10",
  UNKNOWN: "text-muted-foreground border-border bg-muted",
};

function ConfidenceBar({ value }: { value: number | null }) {
  const v = value ?? 0;
  const color = v >= 70 ? "bg-success" : v >= 50 ? "bg-primary" : "bg-muted-foreground";
  return (
    <div className="flex items-center gap-1.5 min-w-[60px]">
      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
        <div className={`h-full ${color}`} style={{ width: `${v}%` }} />
      </div>
      <span className="font-mono text-[10px] text-muted-foreground tabular-nums w-6 text-right">{v}</span>
    </div>
  );
}

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
      supabase.from("bot_signals").select("*").order("created_at", { ascending: false }).limit(80),
      supabase.from("bot_trades").select("*").order("created_at", { ascending: false }).limit(80),
      supabase.from("bot_runs").select("*").order("created_at", { ascending: false }).limit(20),
    ]);
    if (snapRes.data) setSnapshots(snapRes.data as unknown as Snapshot[]);
    if (sigRes.data) setSignals(sigRes.data as unknown as Signal[]);
    if (trdRes.data) setTrades(trdRes.data as unknown as Trade[]);
    if (runRes.data) setRuns(runRes.data as unknown as Run[]);
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
      const d = data as { runStatus: string; marketOpen: boolean; tradesExecuted: number; signalsGenerated: number; duration: number; haltEntries: boolean };
      toast.success(
        `Cycle complete (${d.duration}ms) — ${d.signalsGenerated} signals, ${d.tradesExecuted} trades${d.marketOpen ? "" : " · market closed"}${d.haltEntries ? " · ⛔ daily loss halt" : ""}`,
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
  const dailyPL = latest?.daily_pl ?? lastRun?.daily_pl ?? 0;

  const equitySeries = [...snapshots].reverse().map((s) => ({
    t: new Date(s.created_at).getTime(),
    label: fmtTime(s.created_at),
    equity: Number(s.equity),
    cash: Number(s.cash),
  }));

  const regimeMap = lastRun?.regime_summary ?? {};

  // Strategy breakdown from recent signals (excluding HOLD/None)
  const stratCounts: Record<string, number> = {};
  for (const s of signals) {
    if (s.signal === "HOLD" || !s.strategy || s.strategy === "None") continue;
    stratCounts[s.strategy] = (stratCounts[s.strategy] ?? 0) + 1;
  }
  const stratData = Object.entries(stratCounts).map(([strategy, count]) => ({ strategy, count }));

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="border-b border-border/60 bg-card/30 backdrop-blur-xl sticky top-0 z-20 shadow-[0_1px_0_0_color-mix(in_oklab,var(--primary)_15%,transparent)]">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div
                className="h-11 w-11 rounded-lg flex items-center justify-center font-mono font-black text-primary-foreground glow-ring relative overflow-hidden"
                style={{ background: "var(--gradient-primary)" }}
              >
                <span className="relative z-10 text-lg">M</span>
                <div className="absolute inset-0 opacity-30" style={{
                  backgroundImage: "linear-gradient(rgba(255,255,255,.3) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.3) 1px, transparent 1px)",
                  backgroundSize: "6px 6px",
                }} />
              </div>
              <Cpu className="absolute -bottom-1 -right-1 h-4 w-4 text-primary bg-background rounded-sm p-0.5 border border-primary/40" />
            </div>
            <div>
              <h1 className="font-mono font-black text-lg leading-tight tracking-tight flex items-center gap-2">
                MAVERICK
                <span className="text-primary text-[10px] px-1.5 py-0.5 rounded border border-primary/40 bg-primary/10">v2.0</span>
              </h1>
              <p className="text-[9px] uppercase tracking-[0.3em] text-muted-foreground font-mono flex items-center gap-1.5">
                <Terminal className="h-2.5 w-2.5" />
                VWAP·Z · MOMENTUM · ORB · REGIME-ADAPTIVE
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {lastRun?.halt_entries && (
              <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-md border border-destructive/50 bg-destructive/10 text-destructive font-mono text-xs shadow-[0_0_16px_-6px_var(--destructive)]">
                <Zap className="h-3 w-3 live-dot" /> DAILY LOSS HALT
              </div>
            )}
            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-md border border-border/80 bg-card/80 backdrop-blur font-mono text-xs">
              <Radio className={`h-3 w-3 ${lastRun?.market_open ? "text-success live-dot" : "text-muted-foreground"}`} />
              <CircleDot className={`h-2 w-2 ${lastRun?.market_open ? "text-success" : "text-muted-foreground"}`} />
              {lastRun?.market_open ? "MARKET LIVE" : "MARKET CLOSED"}
            </div>
            <Button variant="outline" size="sm" onClick={loadAll} disabled={loading} className="border-border/80 bg-card/60">
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
            <Button
              onClick={runBot}
              disabled={running}
              className="font-mono font-bold tracking-wider shadow-[0_0_24px_-6px_var(--primary)] hover:shadow-[0_0_32px_-4px_var(--primary)] transition-shadow"
              style={{ background: "var(--gradient-primary)", color: "var(--primary-foreground)" }}
            >
              <Play className="h-4 w-4 mr-2" fill="currentColor" />
              {running ? "EXECUTING…" : "RUN CYCLE"}
            </Button>
          </div>
        </div>
        <div className="h-px shimmer-line" style={{ background: "color-mix(in oklab, var(--primary) 12%, transparent)" }} />
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        {/* Hero metrics */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MetricCard label="Portfolio Value" value={latest ? fmtUSD(latest.portfolio_value) : "—"} sub="Live equity + cash" icon={<DollarSign className="h-4 w-4" />} tone="primary" />
          <MetricCard label="Daily P&L" value={latest || lastRun ? fmtUSD(dailyPL) : "—"} sub="Today vs last close" icon={<TrendingUp className="h-4 w-4" />} tone={dailyPL >= 0 ? "positive" : "negative"} />
          <MetricCard label="Total Return" value={latest ? fmtPct(totalReturn) : "—"} sub={latest ? `Since ${fmtTime(first!.created_at)}` : ""} icon={<TrendingUp className="h-4 w-4" />} tone={totalReturn >= 0 ? "positive" : "negative"} />
          <MetricCard label="Open / Max" value={`${positions.length} / 4`} sub={`${trades.length} total trades · Cash ${latest ? fmtUSD(latest.cash, 0) : "—"}`} icon={<Target className="h-4 w-4" />} />
        </section>

        {/* Regime grid */}
        {Object.keys(regimeMap).length > 0 && (
          <section className="tech-card rounded-xl border border-border/80 bg-card/50 backdrop-blur-sm p-6" style={{ boxShadow: "var(--shadow-card)" }}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="font-mono text-xs uppercase tracking-[0.25em] text-primary flex items-center gap-2"><Brain className="h-3.5 w-3.5" /> Market Regime — Per Symbol</h2>
                <p className="text-sm text-muted-foreground mt-1">Latest regime classification driving strategy selection</p>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-3">
              {Object.entries(regimeMap).map(([sym, info]) => (
                <div key={sym} className={`rounded-lg border p-3 ${REGIME_COLORS[info.regime] ?? REGIME_COLORS.UNKNOWN}`}>
                  <div className="font-mono font-bold text-sm">{sym}</div>
                  <div className="font-mono text-[10px] uppercase tracking-wider mt-1 opacity-80">{info.regime.replace("_", " ")}</div>
                  <div className="font-mono text-[10px] mt-1 opacity-60">conf {info.conf}</div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Equity curve */}
        <section className="tech-card rounded-xl border border-border/80 bg-card/50 backdrop-blur-sm p-6" style={{ boxShadow: "var(--shadow-card)" }}>
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

        {/* Strategy mix + Cash sub-row */}
        {stratData.length > 0 && (
          <section className="tech-card rounded-xl border border-border/80 bg-card/50 backdrop-blur-sm p-6" style={{ boxShadow: "var(--shadow-card)" }}>
            <h2 className="font-mono text-xs uppercase tracking-[0.25em] text-primary mb-4 flex items-center gap-2"><Layers className="h-3.5 w-3.5" /> Strategy Activity (recent signals)</h2>
            <div className="h-40">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stratData}>
                  <CartesianGrid stroke="oklch(0.30 0.04 255)" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="strategy" stroke="oklch(0.62 0.03 250)" fontSize={11} />
                  <YAxis stroke="oklch(0.62 0.03 250)" fontSize={11} allowDecimals={false} />
                  <Tooltip contentStyle={{ background: "oklch(0.21 0.03 250)", border: "1px solid oklch(0.30 0.04 255)", borderRadius: 8 }} />
                  <Bar dataKey="count" fill="oklch(0.78 0.16 220)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>
        )}

        {/* Positions */}
        <section className="tech-card rounded-xl border border-border/80 bg-card/50 backdrop-blur-sm p-6" style={{ boxShadow: "var(--shadow-card)" }}>
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
          <div className="tech-card rounded-xl border border-border/80 bg-card/50 backdrop-blur-sm p-6" style={{ boxShadow: "var(--shadow-card)" }}>
            <h2 className="font-mono text-xs uppercase tracking-[0.25em] text-primary mb-4">Recent Signals</h2>
            <div className="space-y-2 max-h-[520px] overflow-y-auto pr-2">
              {signals.length === 0 && <p className="text-sm text-muted-foreground py-8 text-center">No signals yet.</p>}
              {signals.map((s) => (
                <div key={s.id} className="flex items-start gap-3 p-3 rounded-lg border border-border/50 bg-background/30 hover:border-primary/30 transition-colors">
                  <SignalBadge signal={s.signal} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="font-mono font-bold text-sm">{s.symbol}</span>
                      <span className="font-mono text-xs text-muted-foreground tabular-nums">{fmtUSD(s.price)}</span>
                      {s.strategy && s.strategy !== "None" && (
                        <span className="font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-primary/30 text-primary">{s.strategy}</span>
                      )}
                      {s.regime && (
                        <span className={`font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border ${REGIME_COLORS[s.regime] ?? REGIME_COLORS.UNKNOWN}`}>{s.regime.replace("_", " ")}</span>
                      )}
                    </div>
                    {s.reason && <p className="text-xs text-muted-foreground mt-1 break-words">{s.reason}</p>}
                    {s.confidence != null && s.confidence > 0 && (
                      <div className="mt-1.5"><ConfidenceBar value={s.confidence} /></div>
                    )}
                  </div>
                  <span className="font-mono text-[10px] text-muted-foreground whitespace-nowrap">{fmtTime(s.created_at)}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="tech-card rounded-xl border border-border/80 bg-card/50 backdrop-blur-sm p-6" style={{ boxShadow: "var(--shadow-card)" }}>
            <h2 className="font-mono text-xs uppercase tracking-[0.25em] text-primary mb-4">Executed Trades</h2>
            <div className="space-y-2 max-h-[520px] overflow-y-auto pr-2">
              {trades.length === 0 && <p className="text-sm text-muted-foreground py-8 text-center">No trades yet.</p>}
              {trades.map((t) => (
                <div key={t.id} className="flex items-start gap-3 p-3 rounded-lg border border-border/50 bg-background/30">
                  <span className={`px-2 py-0.5 rounded-md border text-[10px] font-mono font-bold tracking-wider ${t.side === "buy" ? "bg-success/10 border-success/40 text-success" : "bg-destructive/10 border-destructive/40 text-destructive"}`}>
                    {t.side.toUpperCase()}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-sm flex flex-wrap gap-x-2 items-baseline">
                      <span className="font-bold">{t.symbol}</span>
                      <span className="text-muted-foreground">{t.qty} @ {fmtUSD(t.price)}</span>
                      {t.strategy && (
                        <span className="font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-primary/30 text-primary">{t.strategy}</span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Total {fmtUSD(t.value)}
                      {t.stop_price != null && <> · Stop {fmtUSD(t.stop_price)}</>}
                      {t.target_price != null && <> · Target {fmtUSD(t.target_price)}</>}
                    </p>
                  </div>
                  <span className="font-mono text-[10px] text-muted-foreground whitespace-nowrap">{fmtTime(t.created_at)}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Recent runs */}
        <section className="tech-card rounded-xl border border-border/80 bg-card/50 backdrop-blur-sm p-6" style={{ boxShadow: "var(--shadow-card)" }}>
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
                    <th className="text-right py-2">Daily P&amp;L</th>
                    <th className="text-right py-2">Duration</th>
                    <th className="text-left py-2 pl-4">Market</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.id} className="border-b border-border/50">
                      <td className="py-2 text-muted-foreground">{fmtTime(r.created_at)}</td>
                      <td className={r.status === "success" ? "text-success" : "text-destructive"}>{r.status.toUpperCase()}{r.halt_entries ? " · HALT" : ""}</td>
                      <td className="text-right">{r.signals_generated}</td>
                      <td className="text-right">{r.trades_executed}</td>
                      <td className={`text-right ${(r.daily_pl ?? 0) >= 0 ? "text-success" : "text-destructive"}`}>{r.daily_pl != null ? fmtUSD(r.daily_pl) : "—"}</td>
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
            Maverick Bot v2 · Multi-Strategy · Paper Trading · Auto-refresh 30s
          </p>
        </footer>
      </main>
    </div>
  );
}
