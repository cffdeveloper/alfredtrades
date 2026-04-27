import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { SignalBadge } from "@/components/dashboard/SignalBadge";
import { fmtUSD, fmtPct, fmtTime } from "@/lib/format";
import { computeRealizedPnL } from "@/lib/pnl";
import { toast } from "sonner";
import bullBearImg from "@/assets/bull-bear-color.png";
import bullMark from "@/assets/bull-mark-color.png";
import {
  Activity, Play, RefreshCw, Brain, Layers,
  Zap,
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
interface TradeReview { id: string; symbol: string; pnl: number; pnl_pct: number; hold_seconds: number | null; exit_reason: string | null; regime: string | null; ai_verdict: string | null; ai_lesson: string | null; ai_weight_adjustments: Array<{ signal_name: string; regime: string; delta: number }> | null; created_at: string }
interface SignalWeight { id: string; signal_name: string; regime: string; weight: number; wins: number; losses: number; updated_at: string }

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
  const [reviews, setReviews] = useState<TradeReview[]>([]);
  const [weights, setWeights] = useState<SignalWeight[]>([]);
  const [running, setRunning] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadAll = async () => {
    const [snapRes, sigRes, trdRes, runRes, revRes, wRes] = await Promise.all([
      supabase.from("portfolio_snapshots").select("*").order("created_at", { ascending: false }).limit(200),
      supabase.from("bot_signals").select("*").order("created_at", { ascending: false }).limit(80),
      supabase.from("bot_trades").select("*").order("created_at", { ascending: false }).limit(80),
      supabase.from("bot_runs").select("*").order("created_at", { ascending: false }).limit(20),
      supabase.from("trade_reviews").select("*").order("created_at", { ascending: false }).limit(10),
      supabase.from("signal_weights").select("*").order("weight", { ascending: false }),
    ]);
    if (snapRes.data) setSnapshots(snapRes.data as unknown as Snapshot[]);
    if (sigRes.data) setSignals(sigRes.data as unknown as Signal[]);
    if (trdRes.data) setTrades(trdRes.data as unknown as Trade[]);
    if (runRes.data) setRuns(runRes.data as unknown as Run[]);
    if (revRes.data) setReviews(revRes.data as unknown as TradeReview[]);
    if (wRes.data) setWeights(wRes.data as unknown as SignalWeight[]);
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
  const totalReturn = latest && first && first.equity > 0
    ? ((latest.equity - first.equity) / first.equity) * 100
    : 0;
  const lastRun = runs[0];
  const positions = latest?.positions ?? [];
  const dailyPL = latest?.daily_pl ?? lastRun?.daily_pl ?? 0;

  // P&L breakdown
  const realizedPL = useMemo(() => computeRealizedPnL(trades), [trades]);
  const unrealizedPL = positions.reduce((sum, p) => sum + Number(p.unrealized_pl ?? 0), 0);
  const totalPL = realizedPL + unrealizedPL;

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
    <div className="min-h-screen relative">
      {/* Bull & Bear watermark — fixed, very faint */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 bottom-0 z-0 flex justify-center opacity-[0.18] select-none mix-blend-multiply"
      >
        <img
          src={bullBearImg}
          alt=""
          className="w-[min(1400px,140vw)] max-w-none"
        />
      </div>

      {/* Header */}
      <header className="relative border-b border-border bg-background/85 backdrop-blur-xl sticky top-0 z-20">
        <div className="absolute inset-0 blueprint-grid opacity-60 pointer-events-none" style={{ maskImage: "linear-gradient(to bottom, black 0%, transparent 100%)" }} />
        <div className="relative max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-3 sm:py-5 flex items-center justify-between flex-wrap gap-2 sm:gap-4">
          <div className="flex items-center gap-2 sm:gap-4 min-w-0">
            <div className="h-10 w-10 sm:h-12 sm:w-12 rounded-md flex items-center justify-center overflow-hidden shrink-0 ring-2 ring-[var(--gold)]/60 shadow-md">
              <img src={bullMark} alt="Maverick" className="h-full w-full object-cover" />
            </div>
            <div className="flex flex-col min-w-0">
              <h1 className="font-display text-xl sm:text-3xl font-semibold leading-none tracking-tight flex items-baseline gap-1.5 sm:gap-2">
                <span className="bg-gradient-to-br from-primary via-[var(--primary-glow)] to-[var(--gold)] bg-clip-text text-transparent">Maverick</span>
                <span className="text-[var(--gold)]">.</span>
                <span className="eyebrow ml-0.5 sm:ml-1 -translate-y-1 hidden sm:inline !text-[var(--gold)]">v2.0</span>
              </h1>
              <p className="font-serif italic mt-0.5 sm:mt-1 text-muted-foreground text-[11px] sm:text-sm truncate tracking-wide">
                Multi-Strategy · Regime-Adaptive
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2">
            {lastRun?.halt_entries && (
              <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-md border border-destructive/40 bg-destructive/5 text-destructive text-xs font-medium">
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
            <Button variant="ghost" size="sm" onClick={loadAll} disabled={loading} className="text-muted-foreground hover:text-foreground h-8 w-8 sm:h-9 sm:w-9 p-0">
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
            <Button
              onClick={runBot}
              disabled={running}
              size="sm"
              className="rounded-md font-medium tracking-wide text-xs sm:text-sm h-8 sm:h-9 px-3 text-primary-foreground shadow-md border border-[var(--gold)]/40"
              style={{ background: "var(--gradient-primary)" }}
            >
              <Play className="h-3 w-3 sm:h-3.5 sm:w-3.5 mr-1.5 sm:mr-2" fill="currentColor" />
              {running ? "…" : "Run"}
              <span className="hidden sm:inline">&nbsp;Cycle</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="relative z-10 max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-6 sm:py-10 lg:py-14 space-y-8 sm:space-y-12">
        {/* Thesis line — italic serif, the page's voice */}
        <section className="max-w-3xl">
          <p className="eyebrow mb-2 sm:mb-3 !text-[var(--gold)]">— The Thesis —</p>
          <p className="font-serif italic text-lg sm:text-3xl lg:text-4xl text-foreground leading-snug tracking-tight">
            <span className="font-display not-italic text-primary">D</span>isciplined capital, deployed by rule.
            <span className="text-muted-foreground"> A multi-strategy engine that reads the regime before it reads the price.</span>
          </p>
        </section>

        {/* Hero metrics */}
        <section>
          <p className="eyebrow mb-3 sm:mb-4">Portfolio · Live</p>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2.5 sm:gap-4">
            <MetricCard ornament="01" label="Portfolio Value" value={latest ? fmtUSD(latest.portfolio_value) : "—"} sub="Equity + cash" />
            <MetricCard ornament="02" label="Daily P&L" value={latest || lastRun ? fmtUSD(dailyPL) : "—"} sub="Today vs last close" tone={dailyPL >= 0 ? "positive" : "negative"} />
            <MetricCard ornament="03" label="Realized P&L" value={trades.length ? fmtUSD(realizedPL) : "—"} sub="Closed round-trips" tone={realizedPL >= 0 ? "positive" : "negative"} />
            <MetricCard ornament="04" label="Unrealized P&L" value={positions.length ? fmtUSD(unrealizedPL) : "—"} sub={`${positions.length} open · ${positions.length}/4 max`} tone={unrealizedPL >= 0 ? "positive" : "negative"} />
            <MetricCard ornament="05" label="Net P&L" value={(trades.length || positions.length) ? fmtUSD(totalPL) : "—"} sub={latest ? `Return ${fmtPct(totalReturn)}` : ""} tone={totalPL >= 0 ? "positive" : "negative"} />
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
                    <stop offset="0%" stopColor="oklch(0.42 0.13 160)" stopOpacity={0.45} />
                    <stop offset="50%" stopColor="oklch(0.72 0.14 75)" stopOpacity={0.18} />
                    <stop offset="100%" stopColor="oklch(0.42 0.13 160)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="oklch(0.82 0.04 85)" strokeDasharray="2 4" vertical={false} />
                <XAxis dataKey="label" stroke="oklch(0.45 0.04 130)" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="oklch(0.45 0.04 130)" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} domain={["auto", "auto"]} />
                <Tooltip
                  contentStyle={{ background: "oklch(0.985 0.012 85)", border: "1px solid oklch(0.72 0.14 75)", borderRadius: 6, fontSize: 12 }}
                  labelStyle={{ color: "oklch(0.45 0.04 130)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.15em" }}
                  formatter={(v: number) => fmtUSD(v)}
                />
                <Area type="monotone" dataKey="equity" stroke="oklch(0.42 0.13 160)" strokeWidth={2} fill="url(#eq)" />
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
                  <CartesianGrid stroke="oklch(0.82 0.04 85)" strokeDasharray="2 4" vertical={false} />
                  <XAxis dataKey="strategy" stroke="oklch(0.45 0.04 130)" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis stroke="oklch(0.45 0.04 130)" fontSize={11} allowDecimals={false} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ background: "oklch(0.985 0.012 85)", border: "1px solid oklch(0.82 0.04 85)", borderRadius: 6, fontSize: 12 }} />
                  <Bar dataKey="count" fill="oklch(0.42 0.13 160)" radius={[3, 3, 0, 0]} />
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
                    <CartesianGrid stroke="oklch(0.82 0.04 85)" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="symbol" stroke="oklch(0.50 0.015 250)" fontSize={11} />
                    <YAxis stroke="oklch(0.50 0.015 250)" fontSize={11} tickFormatter={(v) => `$${v}`} />
                    <Tooltip contentStyle={{ background: "oklch(0.985 0.012 85)", border: "1px solid oklch(0.82 0.04 85)", borderRadius: 8 }} formatter={(v: number) => fmtUSD(v)} />
                    <Bar dataKey="unrealized_pl" radius={[6, 6, 0, 0]}>
                      {positions.map((p) => (
                        <Cell key={p.symbol} fill={p.unrealized_pl >= 0 ? "oklch(0.50 0.15 155)" : "oklch(0.45 0.18 25)"} />
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
            <p className="text-[11px] text-muted-foreground/80 mt-2 italic">"Acct Day P&amp;L" = the broker's intraday equity change at the instant of the cycle. It is <span className="text-foreground/80">not</span> profit earned by that cycle. For real performance see Realized / Net P&amp;L above.</p>
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
                    <th className="text-right py-2" title="Account intraday P&L at the moment of this cycle — NOT profit from this cycle alone">Acct Day P&amp;L</th>
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
