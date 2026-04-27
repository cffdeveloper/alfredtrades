// Deriv Master Bot v3.0 — faithful port of the Python spec to a Deno edge function.
// One cycle per cron invocation:
//   1. Open WS, authorize, snapshot balance.
//   2. Load tick history per symbol from DB; collect fresh ticks (warmed up to ≥60).
//   3. Per-symbol StatEngine: Bayesian + 2/3-gram + bias z + entropy + chi-square + autocorr.
//   4. Build scan list (strategy-dependent: ev_scan / hybrid / conservative / stats_only).
//   5. Send all proposals in parallel; on each, build an EVCandidate.
//   6. Pick best by score(); if blended EV ≥ MIN_EV and risk OK, Kelly-size and BUY.
//   7. Subscribe POC, await settle, persist run/trade/state.
//
// All constants and formulas mirror the user-supplied document.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// ─── Constants (mirror the spec) ──────────────────────────────────────────
const DERIV_WS_URL = "wss://ws.derivws.com/websockets/v3?app_id=1089";
const ALL_SYMBOLS = ["R_10", "R_25", "R_50", "R_75", "R_100"];
const ACTIVE_SYMBOLS = ["R_50", "R_25", "R_10"]; // matches "R_25, R_50 + focus" default
const OVER_BARRIERS = [0, 1, 2, 3, 4, 5, 6, 7, 8];
const UNDER_BARRIERS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

const WARM_UP_TICKS = 60;
const MAX_HISTORY = 1000;
const MIN_EV = 0.005;       // 0.5% edge (per spec)
const TICK_DURATION = 1;
const STRATEGY: "ev_scan" | "hybrid" | "conservative" | "stats_only" = "ev_scan";

// Risk manager (per spec defaults)
const BASE_STAKE = 0.35;
const KELLY_FRACTION = 0.25;
const MAX_STAKE = 5.0;
const MAX_DRAWDOWN_PCT = 0.25;
const MAX_DAILY_LOSS_PCT = 0.15;
const MAX_CONSEC_LOSSES = 8;
const COOLDOWN_LOSSES = 5;
const COOLDOWN_SECONDS = 60;

// Cycle budget
const TICK_COLLECT_MS = 35_000;
const TICKS_TARGET_PER_CYCLE = 30;   // top up history each cycle
const PROPOSAL_WAIT_MS = 4_000;
const SETTLE_TIMEOUT_MS = 15_000;
const STALE_PROPOSAL_S = 3.0;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// ─── Helpers ──────────────────────────────────────────────────────────────
const lastDigitOf = (quote: number): number => {
  // Per spec: take rightmost decimal digit.
  const s = String(quote);
  if (s.includes(".")) return parseInt(s.split(".")[1].slice(-1), 10) || 0;
  return parseInt(s.slice(-1), 10) || 0;
};

function theoreticalWinProb(ct: string, barrier: number | null): number {
  switch (ct) {
    case "DIGITMATCH": return 0.1;
    case "DIGITDIFF":  return 0.9;
    case "DIGITEVEN":  return 0.5;
    case "DIGITODD":   return 0.5;
    case "DIGITOVER":  return barrier === null ? 0.5 : Math.max(0, (9 - barrier) / 10);
    case "DIGITUNDER": return barrier === null ? 0.5 : Math.min(1, barrier / 10);
  }
  return 0;
}

function erf(x: number): number {
  // Abramowitz & Stegun approximation
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}
const normalCdf = (z: number): number => 0.5 * (1 + erf(z / Math.SQRT2));

// ─── StatEngine (port of the Python class) ────────────────────────────────
class StatEngine {
  symbol: string;
  history: number[] = [];
  alpha = 1.0;
  ngrams: Map<string, number[]> = new Map(); // key = digits joined; value = counts[10]

  constructor(symbol: string) { this.symbol = symbol; }

  push(d: number) {
    const h = this.history;
    for (const n of [1, 2, 3]) {
      if (h.length >= n) {
        const key = h.slice(-n).join(",");
        let row = this.ngrams.get(key);
        if (!row) { row = new Array(10).fill(0); this.ngrams.set(key, row); }
        row[d]++;
      }
    }
    h.push(d);
    if (h.length > MAX_HISTORY) h.shift();
  }

  ready(): boolean { return this.history.length >= WARM_UP_TICKS; }

  bayesian(): number[] {
    const c = new Array(10).fill(0);
    for (const d of this.history) c[d]++;
    const total = this.history.length + this.alpha * 10;
    return c.map((x) => (x + this.alpha) / total);
  }

  ngram(n: number): number[] | null {
    const h = this.history;
    if (h.length < n) return null;
    const key = h.slice(-n).join(",");
    const row = this.ngrams.get(key);
    if (!row) return null;
    const sum = row.reduce((a, b) => a + b, 0);
    if (sum < 8) return null;
    const total = sum + this.alpha * 10;
    return row.map((x) => (x + this.alpha) / total);
  }

  recentBias(lookback = 30): number[] {
    const r = this.history.slice(-lookback);
    const out = new Array(10).fill(0);
    if (!r.length) return out;
    const n = r.length;
    const c = new Array(10).fill(0);
    for (const d of r) c[d]++;
    const expected = 0.10;
    const stdErr = Math.sqrt(expected * (1 - expected) / n) || 1e-9;
    for (let d = 0; d < 10; d++) out[d] = (c[d] / n - expected) / stdErr;
    return out;
  }

  entropy(lookback = 50): number {
    const r = this.history.slice(-lookback);
    if (!r.length) return Math.log2(10);
    const c = new Array(10).fill(0);
    for (const d of r) c[d]++;
    const n = r.length;
    let H = 0;
    for (const x of c) if (x > 0) H -= (x / n) * Math.log2(x / n);
    return H;
  }

  entropyRegime(): "structured" | "normal" | "random" {
    const r = this.entropy() / Math.log2(10);
    return r < 0.88 ? "structured" : r < 0.97 ? "normal" : "random";
  }

  chiSquarePValue(lookback = 200): number {
    const r = this.history.slice(-lookback);
    const n = r.length;
    if (n < 50) return 1.0;
    const c = new Array(10).fill(0);
    for (const d of r) c[d]++;
    const expected = n / 10;
    let chi2 = 0;
    for (let d = 0; d < 10; d++) chi2 += ((c[d] - expected) ** 2) / expected;
    const df = 9;
    const x = chi2 / df;
    const mu = 1 - 2 / (9 * df);
    const sigma = Math.sqrt(2 / (9 * df));
    const z = (Math.cbrt(x) - mu) / sigma;
    return Math.max(0, Math.min(1, 1 - normalCdf(z)));
  }

  digitsAreBiased(sig = 0.05): boolean { return this.chiSquarePValue() < sig; }

  autocorrelation(maxLag = 5): number[] {
    const h = this.history.slice(-200);
    const n = h.length;
    const out = new Array(maxLag + 1).fill(0);
    if (n < 20) return out;
    const mean = h.reduce((a, b) => a + b, 0) / n;
    let denom = 0; for (const x of h) denom += (x - mean) ** 2;
    denom = denom || 1e-9;
    for (let lag = 1; lag <= maxLag; lag++) {
      let num = 0;
      for (let i = lag; i < n; i++) num += (h[i] - mean) * (h[i - lag] - mean);
      out[lag] = num / denom;
    }
    return out;
  }

  hasMemory(threshold = 0.08): boolean {
    return this.autocorrelation().some((v) => Math.abs(v) > threshold);
  }

  compositeDigitProbs(): { probs: number[]; confidence: number } {
    const bay = this.bayesian();
    const ng2 = this.ngram(2);
    const ng3 = this.ngram(3);
    const bias = this.recentBias();
    const H = this.entropy();
    const Hmax = Math.log2(10);

    let wBay = 0.40;
    let wNg2 = ng2 ? 0.25 : 0;
    let wNg3 = ng3 ? 0.20 : 0;
    let wBias = 0.15;
    const tot = wBay + wNg2 + wNg3 + wBias;
    wBay /= tot; wNg2 /= tot; wNg3 /= tot; wBias /= tot;

    const probs: number[] = [];
    for (let d = 0; d < 10; d++) {
      let p = wBay * bay[d];
      if (ng2) p += wNg2 * ng2[d];
      if (ng3) p += wNg3 * ng3[d];
      const z = bias[d] ?? 0;
      const biasContrib = 1 / (1 + Math.exp(-z * 0.5));
      p = p * (1 - wBias) + (biasContrib / 10) * wBias * 10;
      probs.push(Math.max(1e-9, p));
    }
    const s = probs.reduce((a, b) => a + b, 0);
    const norm = probs.map((p) => p / s);

    const entropyFactor = 1 + 0.4 * (1 - H / Hmax);
    const biasFactor = 1 + 0.3 * (1 - this.chiSquarePValue());
    const acFactor = 1 + (this.hasMemory() ? 0.2 : 0);
    let confidence = entropyFactor * biasFactor * acFactor;
    confidence = Math.min(2.0, Math.max(0.5, confidence));
    return { probs: norm, confidence };
  }
}

// ─── EV candidate ─────────────────────────────────────────────────────────
type Candidate = {
  symbol: string; contractType: string; barrier: number | null;
  wpTheory: number; wpStat: number;
  payoutRatio: number; proposalId: string; askPrice: number; payout: number;
  statConfidence: number; ts: number;
};

const evTheoretical = (c: Candidate) => c.wpTheory * c.payoutRatio - (1 - c.wpTheory);
const evStatistical = (c: Candidate) => c.wpStat * c.payoutRatio - (1 - c.wpStat);
const evBlended = (c: Candidate) => {
  const wStat = Math.min(0.6, (c.statConfidence - 1.0) * 0.5 + 0.2);
  const wTheory = 1 - wStat;
  const blended = wTheory * c.wpTheory + wStat * c.wpStat;
  return blended * c.payoutRatio - (1 - blended);
};
const candidateScore = (c: Candidate): number => {
  const ev = evBlended(c);
  if (ev <= 0) return -999;
  const winP = c.wpTheory * 0.7 + c.wpStat * 0.3;
  return ev * c.statConfidence * Math.sqrt(Math.max(0.1, winP));
};
const isStale = (c: Candidate) => (Date.now() / 1000 - c.ts) > STALE_PROPOSAL_S;

// ─── WS session helper ────────────────────────────────────────────────────
type Listener = (msg: any) => void;
async function openWS(): Promise<{
  send: (p: any) => Promise<number>;
  waitFor: (pred: (m: any) => boolean, ms: number) => Promise<any>;
  onAll: (l: Listener) => () => void;
  close: () => void;
}> {
  return await new Promise((resolve, reject) => {
    const ws = new WebSocket(DERIV_WS_URL);
    const listeners: Listener[] = [];
    let reqId = 0;
    const t = setTimeout(() => reject(new Error("WS open timeout")), 10_000);
    ws.onopen = () => {
      clearTimeout(t);
      resolve({
        send: async (p) => { reqId++; ws.send(JSON.stringify({ ...p, req_id: reqId })); return reqId; },
        waitFor: (pred, ms) => new Promise((res, rej) => {
          const to = setTimeout(() => { off(); rej(new Error("waitFor timeout")); }, ms);
          const h: Listener = (m) => { if (pred(m)) { clearTimeout(to); off(); res(m); } };
          const off = () => { const i = listeners.indexOf(h); if (i >= 0) listeners.splice(i, 1); };
          listeners.push(h);
        }),
        onAll: (l) => { listeners.push(l); return () => { const i = listeners.indexOf(l); if (i >= 0) listeners.splice(i, 1); }; },
        close: () => { try { ws.close(); } catch { /* ignore */ } },
      });
    };
    ws.onerror = () => { clearTimeout(t); reject(new Error("WS error")); };
    ws.onmessage = (ev) => {
      let msg: any; try { msg = JSON.parse(ev.data); } catch { return; }
      for (const l of [...listeners]) l(msg);
    };
  });
}

// ─── Risk gate (per spec) ─────────────────────────────────────────────────
type RiskState = {
  startingBalance: number | null;
  sessionStartBal: number | null;
  peakBalance: number;
  consecLosses: number;
  cooldownUntil: number; // unix seconds
  currentBalance: number;
};
function isSafeToTrade(r: RiskState): { safe: boolean; reason: string } {
  const now = Date.now() / 1000;
  if (r.currentBalance == null) return { safe: false, reason: "balance unknown" };
  if (now < r.cooldownUntil) return { safe: false, reason: `cooldown ${Math.round(r.cooldownUntil - now)}s` };
  if (r.consecLosses >= MAX_CONSEC_LOSSES) return { safe: false, reason: `≥${MAX_CONSEC_LOSSES} consec losses` };
  const dd = r.peakBalance ? (r.peakBalance - r.currentBalance) / r.peakBalance : 0;
  if (dd >= MAX_DRAWDOWN_PCT) return { safe: false, reason: `drawdown ${(dd * 100).toFixed(1)}%` };
  const dl = r.sessionStartBal ? (r.sessionStartBal - r.currentBalance) / r.sessionStartBal : 0;
  if (dl >= MAX_DAILY_LOSS_PCT) return { safe: false, reason: `daily loss ${(dl * 100).toFixed(1)}%` };
  return { safe: true, reason: "ok" };
}
function kellyStake(winProb: number, payoutRatio: number, balance: number): number {
  const b = payoutRatio, p = winProb, q = 1 - p;
  const fStar = (b * p - q) / b;
  if (fStar <= 0) return 0;
  let stake = KELLY_FRACTION * fStar * balance;
  stake = Math.min(stake, MAX_STAKE);
  stake = Math.max(stake, BASE_STAKE);
  return Math.round(stake * 100) / 100;
}

// ─── Build scan list (strategy-aware, per spec) ───────────────────────────
type ScanItem = { symbol: string; contractType: string; barrier: number | null; wpTheory: number; wpStat: number; conf: number };
function buildScanList(engines: Record<string, StatEngine>): ScanItem[] {
  const scan: ScanItem[] = [];
  for (const sym of ACTIVE_SYMBOLS) {
    const e = engines[sym];
    if (!e || !e.ready()) continue;
    const { probs, confidence } = e.compositeDigitProbs();

    if (STRATEGY === "ev_scan" || STRATEGY === "hybrid" || STRATEGY === "conservative") {
      for (const b of OVER_BARRIERS) {
        const wpStat = probs.slice(b + 1, 10).reduce((a, x) => a + x, 0);
        scan.push({ symbol: sym, contractType: "DIGITOVER", barrier: b, wpTheory: theoreticalWinProb("DIGITOVER", b), wpStat, conf: confidence });
      }
      for (const b of UNDER_BARRIERS) {
        const wpStat = probs.slice(0, b).reduce((a, x) => a + x, 0);
        scan.push({ symbol: sym, contractType: "DIGITUNDER", barrier: b, wpTheory: theoreticalWinProb("DIGITUNDER", b), wpStat, conf: confidence });
      }
    }
    if (STRATEGY !== "conservative") {
      const evenP = [0, 2, 4, 6, 8].reduce((a, d) => a + probs[d], 0);
      const oddP = [1, 3, 5, 7, 9].reduce((a, d) => a + probs[d], 0);
      scan.push({ symbol: sym, contractType: "DIGITEVEN", barrier: null, wpTheory: 0.5, wpStat: evenP, conf: confidence });
      scan.push({ symbol: sym, contractType: "DIGITODD", barrier: null, wpTheory: 0.5, wpStat: oddP, conf: confidence });
    }
    if ((STRATEGY === "stats_only" || STRATEGY === "hybrid") && e.digitsAreBiased(0.10)) {
      let mostCommon = 0, leastCommon = 0;
      for (let d = 1; d < 10; d++) {
        if (probs[d] > probs[mostCommon]) mostCommon = d;
        if (probs[d] < probs[leastCommon]) leastCommon = d;
      }
      scan.push({ symbol: sym, contractType: "DIGITMATCH", barrier: leastCommon, wpTheory: 0.1, wpStat: probs[leastCommon], conf: confidence });
      scan.push({ symbol: sym, contractType: "DIGITDIFF", barrier: mostCommon, wpTheory: 0.9, wpStat: 1 - probs[mostCommon], conf: confidence });
    }
  }
  return scan;
}

// ─── Main cycle ───────────────────────────────────────────────────────────
async function runCycle() {
  const t0 = Date.now();
  const rawToken = Deno.env.get("DERIV_API_TOKEN") ?? "";
  const token = rawToken.trim().replace(/[\r\n\t ]+/g, "");
  if (!token) {
    await supabase.from("dm_runs").insert({ status: "error", message: "Missing DERIV_API_TOKEN" });
    return { ok: false, error: "missing token" };
  }
  if (!/^[\w\-]{1,128}$/.test(token)) {
    const m = `Invalid token format (len=${token.length})`;
    await supabase.from("dm_runs").insert({ status: "error", message: m });
    return { ok: false, error: m };
  }

  let session: Awaited<ReturnType<typeof openWS>> | null = null;
  let runId: string | null = null;
  let ticksCollected = 0, candidatesScanned = 0, tradesExecuted = 0;
  let bestEv: number | null = null;
  let runMessage = "";

  try {
    session = await openWS();
    await session.send({ authorize: token });
    const auth = await session.waitFor((m) => m.msg_type === "authorize" || m.error, 10_000);
    if (auth.error) throw new Error("auth: " + auth.error.message);
    const balance = parseFloat(auth.authorize.balance);
    const currency = auth.authorize.currency || "USD";
    const loginid = auth.authorize.loginid || null;
    await supabase.from("dm_balance").insert({ balance, currency, loginid });

    // Load risk state
    const { data: stateRow } = await supabase.from("dm_state").select("*").eq("id", 1).single();
    const risk: RiskState = {
      startingBalance: stateRow?.session_start_balance ?? balance,
      sessionStartBal: stateRow?.session_start_balance ?? balance,
      peakBalance: Math.max(stateRow?.peak_balance ?? balance, balance),
      consecLosses: stateRow?.consec_losses ?? 0,
      cooldownUntil: stateRow?.cooldown_until ? new Date(stateRow.cooldown_until).getTime() / 1000 : 0,
      currentBalance: balance,
    };

    // Build engines, hydrate from DB
    const engines: Record<string, StatEngine> = {};
    for (const sym of ACTIVE_SYMBOLS) {
      const e = new StatEngine(sym);
      const { data } = await supabase.from("dm_ticks").select("last_digit,epoch")
        .eq("symbol", sym).order("epoch", { ascending: false }).limit(MAX_HISTORY);
      const arr = (data ?? []).reverse().map((r: any) => r.last_digit as number);
      for (const d of arr) e.push(d);
      engines[sym] = e;
    }

    // Subscribe to ticks
    const collected: Record<string, number> = Object.fromEntries(ACTIVE_SYMBOLS.map((s) => [s, 0]));
    const tickRows: Array<{ symbol: string; quote: number; last_digit: number; epoch: number }> = [];
    const lastQuote: Record<string, number> = {};
    const target = TICKS_TARGET_PER_CYCLE;
    for (const sym of ACTIVE_SYMBOLS) await session.send({ ticks: sym, subscribe: 1 });

    // Need warm-up if ANY engine is below WARM_UP_TICKS
    const needWarmup = ACTIVE_SYMBOLS.some((s) => engines[s].history.length < WARM_UP_TICKS);
    const collectTarget = needWarmup ? Math.max(target, WARM_UP_TICKS) : target;

    await new Promise<void>((resolve) => {
      const off = session!.onAll((m) => {
        if (m.msg_type !== "tick" || !m.tick) return;
        const t = m.tick;
        const sym = t.symbol;
        if (!ACTIVE_SYMBOLS.includes(sym) || collected[sym] >= collectTarget) return;
        const q = parseFloat(t.quote);
        const d = lastDigitOf(q);
        lastQuote[sym] = q;
        engines[sym].push(d);
        tickRows.push({ symbol: sym, quote: q, last_digit: d, epoch: t.epoch });
        collected[sym]++;
        if (ACTIVE_SYMBOLS.every((s) => collected[s] >= collectTarget)) { off(); resolve(); }
      });
      setTimeout(() => { off(); resolve(); }, TICK_COLLECT_MS);
    });
    ticksCollected = tickRows.length;
    if (tickRows.length) await supabase.from("dm_ticks").insert(tickRows);
    await session.send({ forget_all: "ticks" });

    // Open run row
    const { data: runRow } = await supabase.from("dm_runs")
      .insert({ status: "running", ticks_collected: ticksCollected }).select().single();
    runId = runRow?.id ?? null;

    // Risk gate (pre-scan)
    const pre = isSafeToTrade(risk);
    if (!pre.safe) {
      runMessage = `Risk block: ${pre.reason}`;
      await supabase.from("dm_runs").update({
        status: "skipped", message: runMessage, duration_ms: Date.now() - t0,
      }).eq("id", runId!);
      session.close();
      return { ok: true, skipped: true, message: runMessage };
    }

    // Need all engines ready
    if (!ACTIVE_SYMBOLS.every((s) => engines[s].ready())) {
      const sizes = ACTIVE_SYMBOLS.map((s) => `${s}:${engines[s].history.length}`).join(" ");
      runMessage = `Warming up (${sizes})`;
      await supabase.from("dm_runs").update({
        status: "skipped", message: runMessage, duration_ms: Date.now() - t0,
      }).eq("id", runId!);
      session.close();
      return { ok: true, skipped: true, message: runMessage };
    }

    // Build scan list
    const scanList = buildScanList(engines);

    // Send proposals in parallel
    const pending = new Map<number, ScanItem>();
    const candidates: Candidate[] = [];

    const propWaiter = new Promise<void>((resolve) => {
      const off = session!.onAll((msg) => {
        if (msg.msg_type !== "proposal") return;
        const rid = msg.req_id;
        const item = pending.get(rid);
        if (!item) return;
        pending.delete(rid);
        if (msg.error || !msg.proposal) {
          if (pending.size === 0) { off(); resolve(); }
          return;
        }
        const p = msg.proposal;
        const ask = parseFloat(p.ask_price ?? "0");
        const payout = parseFloat(p.payout ?? "0");
        let payoutRatio = 0.85;
        if (ask > 0 && payout > ask) payoutRatio = (payout - ask) / ask;
        payoutRatio = Math.max(0.01, Math.min(20, payoutRatio));
        candidates.push({
          symbol: item.symbol, contractType: item.contractType, barrier: item.barrier,
          wpTheory: item.wpTheory, wpStat: item.wpStat,
          payoutRatio, proposalId: p.id, askPrice: ask, payout,
          statConfidence: item.conf, ts: Date.now() / 1000,
        });
        if (pending.size === 0) { off(); resolve(); }
      });
      setTimeout(() => { off(); resolve(); }, PROPOSAL_WAIT_MS + 1000);
    });

    for (const item of scanList) {
      const payload: any = {
        proposal: 1, amount: BASE_STAKE, basis: "stake",
        contract_type: item.contractType, currency, duration: TICK_DURATION, duration_unit: "t",
        symbol: item.symbol,
      };
      if (item.barrier !== null) payload.barrier = String(item.barrier);
      const rid = await session.send(payload);
      pending.set(rid, item);
    }
    await propWaiter;
    candidatesScanned = candidates.length;

    // Persist top 20 by score
    const sorted = [...candidates].sort((a, b) => candidateScore(b) - candidateScore(a));
    const best = sorted[0];
    bestEv = best ? evBlended(best) : null;

    if (sorted.length) {
      const top = sorted.slice(0, 20).map((c, i) => ({
        run_id: runId, symbol: c.symbol, contract_type: c.contractType, barrier: c.barrier,
        win_prob_theoretical: c.wpTheory, win_prob_statistical: c.wpStat,
        payout_ratio: c.payoutRatio, ev: evBlended(c), stat_confidence: c.statConfidence,
        picked: i === 0 && evBlended(c) >= MIN_EV && !isStale(c),
      }));
      await supabase.from("dm_candidates").insert(top);
    }

    // Decide
    if (!best || evBlended(best) < MIN_EV) {
      runMessage = `No EV ≥ ${(MIN_EV * 100).toFixed(2)}% (best ${best ? (evBlended(best) * 100).toFixed(2) + "%" : "n/a"})`;
      await supabase.from("dm_state").update({
        peak_balance: risk.peakBalance, updated_at: new Date().toISOString(),
      }).eq("id", 1);
    } else if (isStale(best)) {
      runMessage = `Best went stale before execution`;
    } else {
      const post = isSafeToTrade(risk);
      if (!post.safe) {
        runMessage = `Risk block (post-scan): ${post.reason}`;
      } else {
        const winProbForKelly = best.wpTheory * 0.7 + best.wpStat * 0.3;
        const stake = kellyStake(winProbForKelly, best.payoutRatio, balance);
        if (stake <= 0) {
          runMessage = `Kelly returned 0 — skipping`;
        } else {
          // Refresh proposal at the actual stake (Deriv requires matching ask_price)
          const reqPayload: any = {
            proposal: 1, amount: stake, basis: "stake",
            contract_type: best.contractType, currency, duration: TICK_DURATION, duration_unit: "t",
            symbol: best.symbol,
          };
          if (best.barrier !== null) reqPayload.barrier = String(best.barrier);
          await session.send(reqPayload);
          const fresh = await session.waitFor((m) => m.msg_type === "proposal" || m.error, 6_000);
          if (fresh.error) throw new Error("re-proposal: " + fresh.error.message);
          const freshAsk = parseFloat(fresh.proposal.ask_price);
          const freshPayout = parseFloat(fresh.proposal.payout);
          const freshRatio = (freshPayout - freshAsk) / freshAsk;

          await session.send({ buy: fresh.proposal.id, price: freshAsk });
          const buy = await session.waitFor((m) => m.msg_type === "buy" || m.error, 8_000);
          if (buy.error) throw new Error("buy: " + buy.error.message);
          const contractId = String(buy.buy.contract_id);
          tradesExecuted = 1;

          const reasoning =
            `${best.symbol} ${best.contractType}${best.barrier !== null ? " " + best.barrier : ""} ` +
            `EV=${(evBlended(best) * 100).toFixed(2)}% wpT=${best.wpTheory.toFixed(3)} wpS=${best.wpStat.toFixed(3)} ` +
            `conf=${best.statConfidence.toFixed(2)} payoutR=${freshRatio.toFixed(3)} ` +
            `kellyP=${winProbForKelly.toFixed(3)} stake=${stake}`;

          const { data: tradeRow } = await supabase.from("dm_trades").insert({
            symbol: best.symbol, contract_id: contractId,
            contract_type: best.contractType, barrier: best.barrier,
            stake, payout: freshPayout, payout_ratio: freshRatio, ev: evBlended(best),
            win_prob_theoretical: best.wpTheory, win_prob_statistical: best.wpStat,
            stat_confidence: best.statConfidence, status: "open", reasoning,
            strategy: STRATEGY, entry_quote: lastQuote[best.symbol] ?? null,
          }).select().single();

          // Settle
          await session.send({ proposal_open_contract: 1, contract_id: contractId, subscribe: 1 });
          try {
            const settle = await session.waitFor(
              (m) => m.msg_type === "proposal_open_contract" &&
                     m.proposal_open_contract?.contract_id == contractId &&
                     m.proposal_open_contract?.status !== "open",
              SETTLE_TIMEOUT_MS,
            );
            const poc = settle.proposal_open_contract;
            const profit = parseFloat(poc.profit);
            const won = profit > 0;
            if (tradeRow) {
              await supabase.from("dm_trades").update({
                status: poc.status, pnl: profit, won,
                exit_quote: parseFloat(poc.exit_tick ?? poc.current_spot ?? "0") || null,
                settled_at: new Date().toISOString(),
              }).eq("id", tradeRow.id);
            }
            const newConsec = won ? 0 : risk.consecLosses + 1;
            const cd = newConsec >= COOLDOWN_LOSSES
              ? new Date(Date.now() + COOLDOWN_SECONDS * 1000).toISOString()
              : null;
            await supabase.from("dm_state").update({
              peak_balance: Math.max(risk.peakBalance, balance + profit),
              consec_losses: newConsec, cooldown_until: cd,
              session_start_balance: risk.sessionStartBal,
              updated_at: new Date().toISOString(),
            }).eq("id", 1);
            runMessage = `${best.symbol} ${best.contractType}` +
              (best.barrier !== null ? ` ${best.barrier}` : "") +
              ` → ${won ? "WIN" : "LOSS"} ${profit >= 0 ? "+" : ""}${profit.toFixed(2)} ` +
              `(EV ${(evBlended(best) * 100).toFixed(2)}%)`;
          } catch {
            runMessage = `Trade ${contractId} placed (settlement pending)`;
          }
        }
      }
    }

    await supabase.from("dm_runs").update({
      status: "success", message: runMessage,
      candidates_scanned: candidatesScanned, trades_executed: tradesExecuted,
      best_ev: bestEv, duration_ms: Date.now() - t0,
    }).eq("id", runId!);

    session.close();
    return { ok: true, ticksCollected, candidatesScanned, tradesExecuted, bestEv, message: runMessage };
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    if (runId) {
      await supabase.from("dm_runs").update({
        status: "error", message: m,
        candidates_scanned: candidatesScanned, trades_executed: tradesExecuted,
        best_ev: bestEv, duration_ms: Date.now() - t0,
      }).eq("id", runId);
    } else {
      await supabase.from("dm_runs").insert({
        status: "error", message: m, ticks_collected: ticksCollected,
        candidates_scanned: candidatesScanned, trades_executed: tradesExecuted,
        duration_ms: Date.now() - t0,
      });
    }
    if (session) session.close();
    return { ok: false, error: m };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const result = await runCycle();
  return new Response(JSON.stringify(result), {
    headers: { ...cors, "Content-Type": "application/json" },
    status: result.ok ? 200 : 500,
  });
});
