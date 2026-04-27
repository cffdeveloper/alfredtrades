import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Activity, Brain, TrendingUp, AlertTriangle, Zap, Target, Wallet, Clock } from "lucide-react";

export const Route = createFileRoute("/")({
  component: DashboardPage,
  head: () => ({
    meta: [
      { title: "Deriv Master Bot · EV Arbitrage Dashboard" },
      { name: "description", content: "Live monitor for the Deriv Master Bot v3.0 — EV arbitrage scanner across R_10/25/50/75/100 with Bayesian + n-gram statistical intelligence." },
    ],
  }),
});

type Run = { id: string; status: string; message: string | null; ticks_collected: number | null; candidates_scanned: number | null; trades_executed: number | null; best_ev: number | null; duration_ms: number | null; created_at: string };
type Trade = { id: string; symbol: string; contract_type: string; barrier: number | null; stake: number; payout: number | null; payout_ratio: number | null; ev: number | null; status: string; pnl: number | null; won: boolean | null; reasoning: string | null; created_at: string };
type Candidate = { id: string; run_id: string | null; symbol: string; contract_type: string; barrier: number | null; ev: number | null; payout_ratio: number | null; win_prob_theoretical: number | null; win_prob_statistical: number | null; stat_confidence: number | null; picked: boolean | null; created_at: string };
type Balance = { balance: number; currency: string; loginid: string | null; created_at: string };
type State = { peak_balance: number | null; consec_losses: number; cooldown_until: string | null; session_start_balance: number | null; session_started_at: string };

const SYMBOLS = ["R_10", "R_25", "R_50", "R_75", "R_100"];
const CONTRACT_LABEL: Record<string, string> = {
  DIGITMATCH: "Match", DIGITDIFF: "Differ", DIGITEVEN: "Even",
  DIGITODD: "Odd", DIGITOVER: "Over", DIGITUNDER: "Under",
};

function DashboardPage() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [balance, setBalance] = useState<Balance | null>(null);
  const [state, setState] = useState<State | null>(null);
  const [digitDist, setDigitDist] = useState<Record<string, number[]>>({});
  const [nowTick, setNowTick] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setNowTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const load = async () => {
      const [r, t, c, b, s] = await Promise.all([
        supabase.from("dm_runs").select("*").order("created_at", { ascending: false }).limit(15),
        supabase.from("dm_trades").select("*").order("created_at", { ascending: false }).limit(20),
        supabase.from("dm_candidates").select("*").order("created_at", { ascending: false }).limit(40),
        supabase.from("dm_balance").select("*").order("created_at", { ascending: false }).limit(1).maybeSingle(),
        supabase.from("dm_state").select("*").eq("id", 1).maybeSingle(),
      ]);
      if (r.data) setRuns(r.data as Run[]);
      if (t.data) setTrades(t.data as Trade[]);
      if (c.data) setCandidates(c.data as Candidate[]);
      if (b.data) setBalance(b.data as Balance);
      if (s.data) setState(s.data as State);

      // Per-symbol digit distribution from last 200 ticks each
      const dist: Record<string, number[]> = {};
      for (const sym of SYMBOLS) {
        const { data } = await supabase.from("dm_ticks").select("last_digit")
          .eq("symbol", sym).order("epoch", { ascending: false }).limit(200);
        const counts = new Array(10).fill(0);
        for (const row of data ?? []) counts[(row as any).last_digit]++;
        dist[sym] = counts;
      }
      setDigitDist(dist);
    };
    load();
    const i = setInterval(load, 5000);
    return () => clearInterval(i);
  }, []);

  const settled = trades.filter((t) => t.status !== "open" && t.pnl !== null);
  const wins = settled.filter((t) => t.won).length;
  const totalPnl = settled.reduce((s, t) => s + (t.pnl ?? 0), 0);
  const winRate = settled.length ? (wins / settled.length) * 100 : 0;
  const lastRun = runs[0];
  const cooldown = state?.cooldown_until ? new Date(state.cooldown_until) : null;
  const inCooldown = cooldown && cooldown > new Date();
  const drawdown = state?.peak_balance && balance
    ? Math.max(0, ((state.peak_balance - balance.balance) / state.peak_balance) * 100) : 0;

  const triggerRun = async () => {
    await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/deriv-master`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}` },
    });
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-primary to-primary/40 flex items-center justify-center">
              <Brain className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-lg font-semibold tracking-tight">Deriv Master Bot</h1>
              <p className="text-xs text-muted-foreground">v3.0 · EV Arbitrage + Statistical Intelligence</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {inCooldown ? (
              <Badge variant="destructive" className="gap-1.5"><AlertTriangle className="h-3 w-3" /> Cooldown</Badge>
            ) : (
              <Badge variant="outline" className="gap-1.5 border-green-500/40 text-green-500">
                <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" /> Live · 1m cycle
              </Badge>
            )}
            <button onClick={triggerRun} className="text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">
              Run cycle now
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* KPI strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Kpi icon={<Wallet className="h-4 w-4" />} label="Balance" value={balance ? `${balance.balance.toFixed(2)} ${balance.currency}` : "—"} sub={balance?.loginid ?? "demo"} />
          <Kpi icon={<TrendingUp className={totalPnl >= 0 ? "h-4 w-4 text-green-500" : "h-4 w-4 text-red-500"} />} label="Session P&L" value={`${totalPnl >= 0 ? "+" : ""}${totalPnl.toFixed(2)}`} sub={`${settled.length} settled · ${winRate.toFixed(0)}% win`} tone={totalPnl >= 0 ? "pos" : "neg"} />
          <Kpi icon={<Target className="h-4 w-4" />} label="Best EV (last cycle)" value={lastRun?.best_ev != null ? `${(lastRun.best_ev * 100).toFixed(2)}%` : "—"} sub={`${lastRun?.candidates_scanned ?? 0} scanned`} />
          <Kpi icon={<Activity className="h-4 w-4" />} label="Drawdown" value={`${drawdown.toFixed(1)}%`} sub={`Peak ${state?.peak_balance?.toFixed(2) ?? "—"} · Streak L${state?.consec_losses ?? 0}`} tone={drawdown > 10 ? "neg" : "default"} />
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Digit distribution heatmap */}
          <Card className="lg:col-span-2 p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-sm font-semibold flex items-center gap-2"><Zap className="h-4 w-4 text-primary" /> Digit Distribution</h2>
                <p className="text-xs text-muted-foreground">Last 200 ticks per symbol · deviation from uniform 10%</p>
              </div>
            </div>
            <div className="space-y-2">
              <div className="grid grid-cols-[60px_repeat(10,1fr)] gap-1 text-[10px] text-muted-foreground">
                <div></div>
                {Array.from({ length: 10 }, (_, i) => <div key={i} className="text-center">{i}</div>)}
              </div>
              {SYMBOLS.map((sym) => {
                const counts = digitDist[sym] ?? new Array(10).fill(0);
                const total = counts.reduce((a, b) => a + b, 0) || 1;
                return (
                  <div key={sym} className="grid grid-cols-[60px_repeat(10,1fr)] gap-1 items-center">
                    <div className="text-xs font-mono text-muted-foreground">{sym}</div>
                    {counts.map((c, i) => {
                      const pct = c / total;
                      const dev = pct - 0.1;
                      const intensity = Math.min(1, Math.abs(dev) * 8);
                      const color = dev > 0
                        ? `rgba(34, 197, 94, ${0.15 + intensity * 0.55})`
                        : `rgba(239, 68, 68, ${0.15 + intensity * 0.55})`;
                      return (
                        <div key={i} className="aspect-square rounded text-[10px] flex items-center justify-center font-mono tabular-nums" style={{ background: total > 0 ? color : "hsl(var(--muted))" }} title={`${sym} digit ${i}: ${c} (${(pct*100).toFixed(1)}%)`}>
                          {total > 0 ? (pct * 100).toFixed(0) : "·"}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </Card>

          {/* Cycle log */}
          <Card className="p-5">
            <h2 className="text-sm font-semibold flex items-center gap-2 mb-4"><Clock className="h-4 w-4 text-primary" /> Recent Cycles</h2>
            <div className="space-y-2 max-h-[420px] overflow-y-auto">
              {runs.length === 0 && <p className="text-xs text-muted-foreground">No cycles yet. Trigger one above.</p>}
              {runs.map((r) => (
                <div key={r.id} className="text-xs border-l-2 pl-2.5 py-1" style={{ borderColor: r.status === "success" ? "rgb(34 197 94)" : r.status === "error" ? "rgb(239 68 68)" : "rgb(234 179 8)" }}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-muted-foreground">{new Date(r.created_at).toLocaleTimeString()}</span>
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{r.status}</span>
                  </div>
                  <div className="mt-0.5">{r.message ?? "—"}</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    {r.ticks_collected ?? 0}t · {r.candidates_scanned ?? 0}c · {r.trades_executed ?? 0}x · {r.duration_ms ?? 0}ms
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* Candidates ranking */}
        <Card className="p-5">
          <h2 className="text-sm font-semibold flex items-center gap-2 mb-4"><Target className="h-4 w-4 text-primary" /> Latest EV Candidates</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground border-b border-border">
                <tr>
                  <th className="text-left py-2 px-2 font-medium">Symbol</th>
                  <th className="text-left py-2 px-2 font-medium">Contract</th>
                  <th className="text-right py-2 px-2 font-medium">Theo p</th>
                  <th className="text-right py-2 px-2 font-medium">Stat p</th>
                  <th className="text-right py-2 px-2 font-medium">Payout×</th>
                  <th className="text-right py-2 px-2 font-medium">EV</th>
                  <th className="text-right py-2 px-2 font-medium">Conf</th>
                  <th className="text-center py-2 px-2 font-medium">Picked</th>
                </tr>
              </thead>
              <tbody>
                {candidates.length === 0 && (
                  <tr><td colSpan={8} className="py-6 text-center text-muted-foreground">Waiting for first scan…</td></tr>
                )}
                {candidates.slice(0, 15).map((c) => (
                  <tr key={c.id} className="border-b border-border/40 hover:bg-muted/30">
                    <td className="py-1.5 px-2 font-mono">{c.symbol}</td>
                    <td className="py-1.5 px-2">{CONTRACT_LABEL[c.contract_type] ?? c.contract_type}{c.barrier !== null ? ` ${c.barrier}` : ""}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums">{c.win_prob_theoretical?.toFixed(3) ?? "—"}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums">{c.win_prob_statistical?.toFixed(3) ?? "—"}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums">{c.payout_ratio?.toFixed(3) ?? "—"}</td>
                    <td className={`py-1.5 px-2 text-right tabular-nums font-medium ${(c.ev ?? 0) > 0 ? "text-green-500" : "text-red-500"}`}>
                      {c.ev != null ? `${(c.ev * 100).toFixed(2)}%` : "—"}
                    </td>
                    <td className="py-1.5 px-2 text-right tabular-nums">{c.stat_confidence?.toFixed(2) ?? "—"}</td>
                    <td className="py-1.5 px-2 text-center">{c.picked ? <Badge variant="default" className="text-[10px]">✓</Badge> : <span className="text-muted-foreground">·</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Trades */}
        <Card className="p-5">
          <h2 className="text-sm font-semibold flex items-center gap-2 mb-4"><TrendingUp className="h-4 w-4 text-primary" /> Trade History</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground border-b border-border">
                <tr>
                  <th className="text-left py-2 px-2 font-medium">Time</th>
                  <th className="text-left py-2 px-2 font-medium">Symbol</th>
                  <th className="text-left py-2 px-2 font-medium">Contract</th>
                  <th className="text-right py-2 px-2 font-medium">Stake</th>
                  <th className="text-right py-2 px-2 font-medium">EV</th>
                  <th className="text-right py-2 px-2 font-medium">P&L</th>
                  <th className="text-center py-2 px-2 font-medium">Result</th>
                </tr>
              </thead>
              <tbody>
                {trades.length === 0 && (
                  <tr><td colSpan={7} className="py-6 text-center text-muted-foreground">No trades yet.</td></tr>
                )}
                {trades.map((t) => (
                  <tr key={t.id} className="border-b border-border/40 hover:bg-muted/30">
                    <td className="py-1.5 px-2 text-muted-foreground font-mono">{new Date(t.created_at).toLocaleTimeString()}</td>
                    <td className="py-1.5 px-2 font-mono">{t.symbol}</td>
                    <td className="py-1.5 px-2">{CONTRACT_LABEL[t.contract_type] ?? t.contract_type}{t.barrier !== null ? ` ${t.barrier}` : ""}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums">{t.stake.toFixed(2)}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums">{t.ev != null ? `${(t.ev * 100).toFixed(2)}%` : "—"}</td>
                    <td className={`py-1.5 px-2 text-right tabular-nums font-medium ${(t.pnl ?? 0) >= 0 ? "text-green-500" : "text-red-500"}`}>
                      {t.pnl != null ? `${t.pnl >= 0 ? "+" : ""}${t.pnl.toFixed(2)}` : "…"}
                    </td>
                    <td className="py-1.5 px-2 text-center">
                      {t.status === "open" ? <Badge variant="outline" className="text-[10px]">open</Badge>
                        : t.won ? <Badge className="text-[10px] bg-green-500/20 text-green-500 hover:bg-green-500/30">WIN</Badge>
                        : <Badge variant="destructive" className="text-[10px]">LOSS</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <p className="text-[10px] text-center text-muted-foreground pt-4 pb-2">
          Demo-first tool · Synthetic indices use cryptographic RNG · Past performance ≠ future results
        </p>
      </main>
    </div>
  );
}

function Kpi({ icon, label, value, sub, tone }: { icon: React.ReactNode; label: string; value: string; sub?: string; tone?: "pos" | "neg" | "default" }) {
  const valColor = tone === "pos" ? "text-green-500" : tone === "neg" ? "text-red-500" : "text-foreground";
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between text-xs text-muted-foreground mb-2">
        <span>{label}</span>
        {icon}
      </div>
      <div className={`text-xl sm:text-2xl font-semibold tabular-nums tracking-tight ${valColor}`}>{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground mt-1 truncate">{sub}</div>}
    </Card>
  );
}
