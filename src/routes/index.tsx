import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { SignalBadge } from "@/components/dashboard/SignalBadge";
import { fmtUSD, fmtPct, fmtTime } from "@/lib/format";
import { toast } from "sonner";
import {
  Activity, Play, RefreshCw, Brain, Layers,
  Zap, Cpu, Terminal, Briefcase,
  ClockIcon as HistoryIcon, LineChart as LineChartIcon, Signal as SignalIcon,
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
      <header className="relative border-b border-border bg-background/80 backdrop-blur-xl sticky top-0 z-20">
        <div className="absolute inset-0 blueprint-grid opacity-60 pointer-events-none" style={{ maskImage: "linear-gradient(to bottom, black 0%, transparent 100%)" }} />
        <div className="relative max-w-7xl mx-auto px-6 lg:px-8 py-5 flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-4">
            <div className="h-10 w-10 rounded-md flex items-center justify-center bg-primary text-primary-foreground font-display text-xl font-medium tracking-tight">
              M
            </div>
            <div className="flex flex-col">
              <h1 className="font-display text-2xl font-medium leading-none tracking-tight text-foreground flex items-baseline gap-2">
                Maverick<span className="text-primary">.</span>
                <span className="eyebrow ml-1 -translate-y-0.5">v2.0</span>
              </h1>
              <p className="eyebrow mt-1.5 text-muted-foreground">
                Multi-Strategy · Regime-Adaptive Engine
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {lastRun?.halt_entries && (
              <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-md border border-destructive/40 bg-destructive/5 text-destructive text-xs font-medium">
                <Zap className="h-3 w-3" /> Daily Loss Halt
              </div>
            )}
            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-md border border-border bg-card text-xs">
              <span className={`relative flex h-2 w-2 ${lastRun?.market_open ? "" : "opacity-40"}`}>
                {lastRun?.market_open && <span className="absolute inline-flex h-full w-full rounded-full bg-success opacity-60 animate-ping" />}
                <span className={`relative inline-flex rounded-full h-2 w-2 ${lastRun?.market_open ? "bg-success" : "bg-muted-foreground"}`} />
              </span>
              <span className="eyebrow !text-muted-foreground">{lastRun?.market_open ? "Market Live" : "Market Closed"}</span>
            </div>
            <Button variant="ghost" size="sm" onClick={loadAll} disabled={loading} className="text-muted-foreground hover:text-foreground">
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
            <Button
              onClick={runBot}
              disabled={running}
              className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md font-medium tracking-wide"
            >
              <Play className="h-3.5 w-3.5 mr-2" fill="currentColor" />
              {running ? "Executing…" : "Run Cycle"}
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 lg:px-8 py-10 lg:py-14 space-y-12">
        {/* Thesis line — italic serif, the page's voice */}
        <section className="max-w-3xl">
          <p className="eyebrow mb-3">The Thesis</p>
          <p className="font-display italic text-2xl lg:text-3xl text-foreground leading-snug tracking-tight">
            Disciplined capital, deployed by rule.
            <span className="text-muted-foreground"> A multi-strategy engine that reads the regime before it reads the price.</span>
          </p>
        </section>

        {/* Hero metrics */}
        <section>
          <p className="eyebrow mb-4">Portfolio · Live</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <MetricCard ornament="01" label="Portfolio Value" value={latest ? fmtUSD(latest.portfolio_value) : "—"} sub="Live equity + cash" />
            <MetricCard ornament="02" label="Daily P&L" value={latest || lastRun ? fmtUSD(dailyPL) : "—"} sub="Today vs last close" tone={dailyPL >= 0 ? "positive" : "negative"} />
            <MetricCard ornament="03" label="Total Return" value={latest ? fmtPct(totalReturn) : "—"} sub={latest ? `Since ${fmtTime(first!.created_at)}` : ""} tone={totalReturn >= 0 ? "positive" : "negative"} />
            <MetricCard ornament="04" label="Open / Max" value={`${positions.length} / 4`} sub={`${trades.length} trades · Cash ${latest ? fmtUSD(latest.cash, 0) : "—"}`} />
          </div>
        </section>

        {/* Regime grid */}
        {Object.keys(regimeMap).length > 0 && (
          <section className="tech-card rounded-xl border border-border bg-card p-6 lg:p-8">
            <div className="flex items-start justify-between mb-6">
              <div>
                <p className="eyebrow flex items-center gap-2"><Brain className="h-3 w-3" /> Market Regime</p>
                <h2 className="font-display text-2xl font-medium tracking-tight mt-1">Per-symbol classification</h2>
                <p className="text-sm text-muted-foreground mt-1.5">The regime drives strategy selection — never the other way around.</p>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-3">
              {Object.entries(regimeMap).map(([sym, info]) => (
                <div key={sym} className={`rounded-lg border p-3 ${REGIME_COLORS[info.regime] ?? REGIME_COLORS.UNKNOWN}`}>
                  <div className="font-display text-base font-medium">{sym}</div>
                  <div className="text-[10px] uppercase tracking-[0.18em] mt-1.5 opacity-80">{info.regime.replace("_", " ")}</div>
                  <div className="font-mono text-[10px] mt-1 opacity-60">conf {info.conf}</div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Equity curve */}
        <section className="tech-card rounded-xl border border-border bg-card p-6 lg:p-8">
          <div className="mb-6">
            <p className="eyebrow flex items-center gap-2"><Activity className="h-3 w-3" /> Performance</p>
            <h2 className="font-display text-2xl font-medium tracking-tight mt-1">Equity curve</h2>
            <p className="text-sm text-muted-foreground mt-1.5">Portfolio value, marked-to-market across every cycle.</p>
          </div>
          {equitySeries.length > 1 ? (
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={equitySeries} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="eq" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="oklch(0.28 0.06 255)" stopOpacity={0.18} />
                    <stop offset="100%" stopColor="oklch(0.28 0.06 255)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="oklch(0.91 0.005 250)" strokeDasharray="2 4" vertical={false} />
                <XAxis dataKey="label" stroke="oklch(0.48 0.015 250)" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="oklch(0.48 0.015 250)" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} domain={["auto", "auto"]} />
                <Tooltip
                  contentStyle={{ background: "oklch(1 0 0)", border: "1px solid oklch(0.91 0.005 250)", borderRadius: 6, fontSize: 12 }}
                  labelStyle={{ color: "oklch(0.48 0.015 250)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.15em" }}
                  formatter={(v: number) => fmtUSD(v)}
                />
                <Area type="monotone" dataKey="equity" stroke="oklch(0.28 0.06 255)" strokeWidth={1.5} fill="url(#eq)" />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[300px] flex flex-col items-center justify-center text-center text-muted-foreground border border-dashed border-border rounded-lg">
              <Activity className="h-8 w-8 mb-3 opacity-30" />
              <p className="font-display italic text-base">No snapshots yet.</p>
              <p className="text-xs mt-1">Run a cycle to capture your first portfolio snapshot.</p>
            </div>
          )}
        </section>

        {/* Strategy mix */}
        {stratData.length > 0 && (
          <section className="tech-card rounded-xl border border-border bg-card p-6 lg:p-8">
            <div className="mb-6">
              <p className="eyebrow flex items-center gap-2"><Layers className="h-3 w-3" /> Strategy Mix</p>
              <h2 className="font-display text-2xl font-medium tracking-tight mt-1">Signal distribution</h2>
              <p className="text-sm text-muted-foreground mt-1.5">Recent signal counts by strategy.</p>
            </div>
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stratData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="oklch(0.91 0.005 250)" strokeDasharray="2 4" vertical={false} />
                  <XAxis dataKey="strategy" stroke="oklch(0.48 0.015 250)" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis stroke="oklch(0.48 0.015 250)" fontSize={11} allowDecimals={false} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ background: "oklch(1 0 0)", border: "1px solid oklch(0.91 0.005 250)", borderRadius: 6, fontSize: 12 }} />
                  <Bar dataKey="count" fill="oklch(0.28 0.06 255)" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>
        )}

        {/* Positions */}
        <section className="tech-card rounded-xl border border-border bg-card p-6 lg:p-8">
          <div className="mb-6">
            <p className="eyebrow">Book</p>
            <h2 className="font-display text-2xl font-medium tracking-tight mt-1">Open positions</h2>
            <p className="text-sm text-muted-foreground mt-1.5">Live exposure with realized stops &amp; targets.</p>
          </div>
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
                    <CartesianGrid stroke="oklch(0.92 0.005 250)" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="symbol" stroke="oklch(0.50 0.015 250)" fontSize={11} />
                    <YAxis stroke="oklch(0.50 0.015 250)" fontSize={11} tickFormatter={(v) => `$${v}`} />
                    <Tooltip contentStyle={{ background: "oklch(1 0 0)", border: "1px solid oklch(0.92 0.005 250)", borderRadius: 8 }} formatter={(v: number) => fmtUSD(v)} />
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
          <div className="tech-card rounded-xl border border-border bg-card p-6 lg:p-8" style={{ boxShadow: "var(--shadow-card)" }}>
            <div className="mb-5">
              <p className="eyebrow flex items-center gap-2"><SignalIcon className="h-3 w-3" /> Tape</p>
              <h2 className="font-display text-2xl font-medium tracking-tight mt-1">Recent signals</h2>
            </div>
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

          <div className="tech-card rounded-xl border border-border bg-card p-6 lg:p-8" style={{ boxShadow: "var(--shadow-card)" }}>
            <div className="mb-5">
              <p className="eyebrow flex items-center gap-2"><LineChartIcon className="h-3 w-3" /> Blotter</p>
              <h2 className="font-display text-2xl font-medium tracking-tight mt-1">Executed trades</h2>
            </div>
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
        <section className="tech-card rounded-xl border border-border bg-card p-6 lg:p-8" style={{ boxShadow: "var(--shadow-card)" }}>
          <div className="mb-6">
            <p className="eyebrow flex items-center gap-2"><HistoryIcon className="h-3 w-3" /> Audit Log</p>
            <h2 className="font-display text-2xl font-medium tracking-tight mt-1">Cycle history</h2>
            <p className="text-sm text-muted-foreground mt-1.5">Every run, signed and timestamped.</p>
          </div>
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
