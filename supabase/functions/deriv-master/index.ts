// Deriv Master Bot v3.0 — EV arbitrage + statistical intelligence
// One cycle per invocation (called every minute via pg_cron):
//   1. Open WS, authorize, snapshot balance.
//   2. Collect ticks across R_10/25/50/75/100 in parallel (~30 ticks each).
//   3. Build per-symbol Bayesian + n-gram + bias composite digit probs.
//   4. Risk gates: drawdown, daily loss, consec losses, cooldown.
//   5. Request proposals across MATCH/DIFF/EVEN/ODD/OVER/UNDER × digits.
//   6. Compute true EV = p_win*(payout/stake) - (1-p_win); rank candidates.
//   7. If best EV > threshold, size with fractional Kelly, BUY, await POC settle.
//   8. Persist runs, candidates, trade, balance, state.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const DERIV_WS = "wss://ws.derivws.com/websockets/v3?app_id=1089";
const SYMBOLS = ["R_10", "R_25", "R_50", "R_75", "R_100"];
const TICKS_PER_SYMBOL = 30;
const COLLECT_TIMEOUT_MS = 35_000;
const PROPOSAL_TIMEOUT_MS = 6_000;
const SETTLE_TIMEOUT_MS = 15_000;
const MAX_HISTORY = 400;

const BASE_STAKE = 0.35;
const MAX_STAKE = 2.50;
const KELLY_FRACTION = 0.25;
const MIN_EV = 0.02;             // require ≥2% edge
const MIN_STAT_CONF = 0.40;
const MAX_DRAWDOWN_PCT = 25;     // halt if balance falls 25% from peak
const MAX_DAILY_LOSS_PCT = 10;
const MAX_CONSEC_LOSSES = 5;
const COOLDOWN_SECONDS = 300;    // 5 min cooldown after streak

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// ─── Math helpers ────────────────────────────────────────────────────────
const lastDigit = (q: number): number => {
  // Deriv quotes have 2-4 decimals; the volatility-RNG digit is the last
  // significant decimal digit. Use stringified quote, take last char.
  const s = q.toFixed(4);
  return parseInt(s[s.length - 1], 10) || 0;
};

function bayesianProbs(history: number[], alpha = 1.5): number[] {
  const c = new Array(10).fill(0);
  for (const d of history) c[d]++;
  const total = history.length + alpha * 10;
  return c.map((x) => (x + alpha) / total);
}

function biasZ(history: number[], lookback = 50): number[] {
  const recent = history.slice(-lookback);
  const n = recent.length || 1;
  const expected = n / 10;
  const sd = Math.sqrt(n * 0.1 * 0.9) || 1;
  const counts = new Array(10).fill(0);
  for (const d of recent) counts[d]++;
  return counts.map((c) => (c - expected) / sd);
}

function ngram(history: number[], n: number, alpha = 1.0): number[] | null {
  if (history.length < n + 8) return null;
  const key = history.slice(-n).join(",");
  const c = new Array(10).fill(0);
  let m = 0;
  for (let i = 0; i < history.length - n; i++) {
    if (history.slice(i, i + n).join(",") === key) {
      c[history[i + n]]++;
      m++;
    }
  }
  if (m < 4) return null;
  const total = m + alpha * 10;
  return c.map((x) => (x + alpha) / total);
}

function entropy(history: number[], lookback = 60): number {
  const r = history.slice(-lookback);
  if (!r.length) return Math.log2(10);
  const c = new Array(10).fill(0);
  for (const d of r) c[d]++;
  const n = r.length;
  let H = 0;
  for (const x of c) if (x > 0) H -= (x / n) * Math.log2(x / n);
  return H;
}

function compositeProbs(history: number[]): { probs: number[]; conf: number } {
  if (history.length < 30) {
    return { probs: new Array(10).fill(0.1), conf: 0 };
  }
  const bay = bayesianProbs(history);
  const z = biasZ(history);
  const ng2 = ngram(history, 2);
  const ng3 = ngram(history, 3);
  const H = entropy(history);
  const Hmax = Math.log2(10);
  const eBoost = 1 + 0.5 * (1 - H / Hmax);

  const probs = new Array(10).fill(0);
  for (let d = 0; d < 10; d++) {
    let p = bay[d] * 0.45;
    p += (1 / (1 + Math.exp(-z[d] * 0.5))) * 0.10;
    if (ng2) p += ng2[d] * 0.25;
    if (ng3) p += ng3[d] * 0.20;
    probs[d] = Math.max(1e-6, p);
  }
  const sum = probs.reduce((a, b) => a + b, 0);
  const norm = probs.map((p) => p / sum);
  // Confidence: max deviation from uniform, scaled by entropy boost
  const maxDev = Math.max(...norm.map((p) => Math.abs(p - 0.1)));
  const conf = Math.min(1, maxDev * 10 * eBoost);
  return { probs: norm, conf };
}

function statWinProb(probs: number[], contract: string, barrier: number | null): number {
  switch (contract) {
    case "DIGITMATCH": return probs[barrier!];
    case "DIGITDIFF":  return 1 - probs[barrier!];
    case "DIGITEVEN":  return probs[0]+probs[2]+probs[4]+probs[6]+probs[8];
    case "DIGITODD":   return probs[1]+probs[3]+probs[5]+probs[7]+probs[9];
    case "DIGITOVER":  { let s=0; for (let d=barrier!+1; d<=9; d++) s+=probs[d]; return s; }
    case "DIGITUNDER": { let s=0; for (let d=0; d<barrier!; d++) s+=probs[d]; return s; }
  }
  return 0.1;
}

function theoreticalWinProb(contract: string, barrier: number | null): number {
  switch (contract) {
    case "DIGITMATCH": return 0.1;
    case "DIGITDIFF":  return 0.9;
    case "DIGITEVEN":  return 0.5;
    case "DIGITODD":   return 0.5;
    case "DIGITOVER":  return Math.max(0, (9 - barrier!) / 10);
    case "DIGITUNDER": return Math.min(1, barrier! / 10);
  }
  return 0.1;
}

function kellyStake(p: number, payoutRatio: number, bankroll: number): number {
  // payoutRatio = profit_per_unit_stake (e.g. 0.95 means win 95¢ per $1)
  const b = payoutRatio;
  if (b <= 0) return BASE_STAKE;
  const f = (p * (b + 1) - 1) / b;
  if (f <= 0) return BASE_STAKE;
  const stake = bankroll * f * KELLY_FRACTION;
  return Math.max(BASE_STAKE, Math.min(MAX_STAKE, Math.round(stake * 100) / 100));
}

// ─── WS session ──────────────────────────────────────────────────────────
type Listener = (msg: any) => void;
function openWS(token: string): Promise<{
  send: (p: any) => Promise<number>;
  waitFor: (pred: (m: any) => boolean, ms: number) => Promise<any>;
  onAll: (l: Listener) => () => void;
  close: () => void;
}> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(DERIV_WS);
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
        close: () => { try { ws.close(); } catch {} },
      });
    };
    ws.onerror = () => { clearTimeout(t); reject(new Error("WS error")); };
    ws.onmessage = (ev) => {
      let msg: any; try { msg = JSON.parse(ev.data); } catch { return; }
      for (const l of [...listeners]) l(msg);
    };
  });
}

// ─── Main cycle ──────────────────────────────────────────────────────────
async function runCycle() {
  const t0 = Date.now();
  const rawToken = Deno.env.get("DERIV_API_TOKEN") ?? "";
  const token = rawToken.trim().replace(/[\r\n\t ]+/g, "");
  console.log(`[deriv-master] token len=${token.length} raw_len=${rawToken.length} first3=${token.slice(0,3)} last3=${token.slice(-3)}`);
  if (!token) {
    await supabase.from("dm_runs").insert({ status: "error", message: "Missing DERIV_API_TOKEN" });
    return { ok: false, error: "missing token" };
  }
  if (!/^[\w\-]{1,128}$/.test(token)) {
    const msg = `Token failed format check (len=${token.length}). Deriv requires ^[\\w\\-]{1,128}$ — likely whitespace/special chars in secret value.`;
    console.log(`[deriv-master] ${msg}`);
    await supabase.from("dm_runs").insert({ status: "error", message: msg });
    return { ok: false, error: msg };
  }

  let session: Awaited<ReturnType<typeof openWS>> | null = null;
  let ticksCollected = 0, candidatesScanned = 0, tradesExecuted = 0;
  let bestEv: number | null = null;
  let runMessage = "";
  let runId: string | null = null;

  try {
    session = await openWS(token);
    await session.send({ authorize: token });
    const auth = await session.waitFor((m) => m.msg_type === "authorize" || m.error, 10_000);
    if (auth.error) throw new Error("auth: " + auth.error.message);
    const balance = parseFloat(auth.authorize.balance);
    const currency = auth.authorize.currency || "USD";
    const loginid = auth.authorize.loginid || null;
    await supabase.from("dm_balance").insert({ balance, currency, loginid });

    // Load state (peak / cooldown / daily)
    const { data: stateRow } = await supabase.from("dm_state").select("*").eq("id", 1).single();
    const peak = Math.max(stateRow?.peak_balance ?? balance, balance);
    const sessionStart = stateRow?.session_start_balance ?? balance;
    const consecLosses = stateRow?.consec_losses ?? 0;
    const cooldownUntil = stateRow?.cooldown_until ? new Date(stateRow.cooldown_until) : null;

    // Risk gates
    const drawdown = ((peak - balance) / peak) * 100;
    const dailyLoss = ((sessionStart - balance) / sessionStart) * 100;
    if (cooldownUntil && cooldownUntil > new Date()) {
      runMessage = `Cooldown until ${cooldownUntil.toISOString()}`;
    } else if (drawdown > MAX_DRAWDOWN_PCT) {
      runMessage = `Drawdown ${drawdown.toFixed(1)}% > ${MAX_DRAWDOWN_PCT}% — halted`;
    } else if (dailyLoss > MAX_DAILY_LOSS_PCT) {
      runMessage = `Daily loss ${dailyLoss.toFixed(1)}% > ${MAX_DAILY_LOSS_PCT}% — halted`;
    }

    // Collect ticks (parallel subscription)
    const histories: Record<string, number[]> = {};
    for (const sym of SYMBOLS) {
      const { data } = await supabase.from("dm_ticks").select("last_digit, epoch")
        .eq("symbol", sym).order("epoch", { ascending: false }).limit(MAX_HISTORY);
      histories[sym] = (data ?? []).reverse().map((r: any) => r.last_digit);
    }

    const tickRows: Array<{ symbol: string; quote: number; last_digit: number; epoch: number }> = [];
    const collected: Record<string, number> = Object.fromEntries(SYMBOLS.map((s) => [s, 0]));
    const lastQuote: Record<string, number> = {};
    for (const sym of SYMBOLS) await session.send({ ticks: sym, subscribe: 1 });

    await new Promise<void>((resolve) => {
      const off = session!.onAll((msg) => {
        if (msg.msg_type !== "tick" || !msg.tick) return;
        const t = msg.tick;
        const sym = t.symbol;
        if (!SYMBOLS.includes(sym) || collected[sym] >= TICKS_PER_SYMBOL) return;
        const q = parseFloat(t.quote);
        const d = lastDigit(q);
        lastQuote[sym] = q;
        tickRows.push({ symbol: sym, quote: q, last_digit: d, epoch: t.epoch });
        histories[sym].push(d);
        if (histories[sym].length > MAX_HISTORY) histories[sym].shift();
        collected[sym]++;
        if (SYMBOLS.every((s) => collected[s] >= TICKS_PER_SYMBOL)) { off(); resolve(); }
      });
      setTimeout(() => { off(); resolve(); }, COLLECT_TIMEOUT_MS);
    });
    ticksCollected = tickRows.length;
    if (tickRows.length) await supabase.from("dm_ticks").insert(tickRows);

    // Unsubscribe ticks
    await session.send({ forget_all: "ticks" });

    // Insert run row early so we can attach candidates
    const { data: runRow } = await supabase.from("dm_runs").insert({
      status: "running", ticks_collected: ticksCollected,
    }).select().single();
    runId = runRow?.id ?? null;

    // If risk-gated, stop here
    if (runMessage) {
      await supabase.from("dm_runs").update({ status: "skipped", message: runMessage, duration_ms: Date.now() - t0 }).eq("id", runId!);
      session.close();
      return { ok: true, skipped: true, message: runMessage };
    }

    // Build composites & assemble proposal requests
    type Combo = { symbol: string; contract: string; barrier: number | null; statP: number; statConf: number; theoP: number };
    const combos: Combo[] = [];
    for (const sym of SYMBOLS) {
      const { probs, conf } = compositeProbs(histories[sym]);
      if (conf < MIN_STAT_CONF) continue;
      // For each contract type, pick the most promising barrier(s)
      const types: Array<{ ct: string; barriers: (number | null)[] }> = [
        { ct: "DIGITMATCH", barriers: [probs.indexOf(Math.max(...probs))] },
        { ct: "DIGITDIFF",  barriers: [probs.indexOf(Math.min(...probs))] },
        { ct: "DIGITEVEN",  barriers: [null] },
        { ct: "DIGITODD",   barriers: [null] },
        { ct: "DIGITOVER",  barriers: [2, 3, 4, 5] },
        { ct: "DIGITUNDER", barriers: [4, 5, 6, 7] },
      ];
      for (const { ct, barriers } of types) {
        for (const b of barriers) {
          combos.push({
            symbol: sym, contract: ct, barrier: b,
            statP: statWinProb(probs, ct, b),
            statConf: conf,
            theoP: theoreticalWinProb(ct, b),
          });
        }
      }
    }

    // Request proposals
    type PendingProposal = { combo: Combo; reqId: number };
    const pending = new Map<number, PendingProposal>();
    type ProposalResult = { combo: Combo; ev: number; payoutRatio: number; askPrice: number; payout: number; proposalId: string };
    const results: ProposalResult[] = [];

    const propWaiter = new Promise<void>((resolve) => {
      const off = session!.onAll((msg) => {
        if (msg.msg_type !== "proposal") return;
        const rid = msg.req_id;
        const p = pending.get(rid);
        if (!p) return;
        pending.delete(rid);
        if (msg.error || !msg.proposal) {
          if (pending.size === 0) { off(); resolve(); }
          return;
        }
        const ask = parseFloat(msg.proposal.ask_price ?? msg.proposal.display_value ?? "0");
        const payout = parseFloat(msg.proposal.payout ?? "0");
        if (ask > 0 && payout > 0) {
          const payoutRatio = (payout - ask) / ask; // profit per $1 stake
          // Use *blended* prob: weighted average of theoretical + statistical
          const w = Math.min(0.5, p.combo.statConf);
          const pBlend = p.combo.theoP * (1 - w) + p.combo.statP * w;
          const ev = pBlend * payoutRatio - (1 - pBlend);
          results.push({
            combo: p.combo, ev, payoutRatio, askPrice: ask, payout,
            proposalId: msg.proposal.id,
          });
        }
        if (pending.size === 0) { off(); resolve(); }
      });
      setTimeout(() => { off(); resolve(); }, PROPOSAL_TIMEOUT_MS + 1000);
    });

    for (const combo of combos) {
      const payload: any = {
        proposal: 1, amount: BASE_STAKE, basis: "stake",
        contract_type: combo.contract, currency, duration: 1, duration_unit: "t",
        symbol: combo.symbol,
      };
      if (combo.barrier !== null) payload.barrier = String(combo.barrier);
      const rid = await session.send(payload);
      pending.set(rid, { combo, reqId: rid });
    }
    await propWaiter;
    candidatesScanned = results.length;

    // Persist top candidates (top 20 by EV)
    results.sort((a, b) => b.ev - a.ev);
    const toLog = results.slice(0, 20).map((r, i) => ({
      run_id: runId, symbol: r.combo.symbol, contract_type: r.combo.contract,
      barrier: r.combo.barrier, win_prob_theoretical: r.combo.theoP,
      win_prob_statistical: r.combo.statP, payout_ratio: r.payoutRatio,
      ev: r.ev, stat_confidence: r.combo.statConf, picked: i === 0 && r.ev >= MIN_EV,
    }));
    if (toLog.length) await supabase.from("dm_candidates").insert(toLog);
    bestEv = results[0]?.ev ?? null;

    // Trade?
    const best = results[0];
    if (best && best.ev >= MIN_EV) {
      const stake = kellyStake(
        best.combo.theoP * (1 - Math.min(0.5, best.combo.statConf)) + best.combo.statP * Math.min(0.5, best.combo.statConf),
        best.payoutRatio, balance,
      );
      // New proposal at adjusted stake (for accurate buy)
      const buyPayload: any = {
        proposal: 1, amount: stake, basis: "stake",
        contract_type: best.combo.contract, currency, duration: 1, duration_unit: "t",
        symbol: best.combo.symbol,
      };
      if (best.combo.barrier !== null) buyPayload.barrier = String(best.combo.barrier);
      await session.send(buyPayload);
      const fresh = await session.waitFor((m) => m.msg_type === "proposal" || m.error, PROPOSAL_TIMEOUT_MS);
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
        `EV=${(best.ev * 100).toFixed(2)}% theo_p=${best.combo.theoP.toFixed(3)} ` +
        `stat_p=${best.combo.statP.toFixed(3)} conf=${best.combo.statConf.toFixed(2)} ` +
        `payout_ratio=${freshRatio.toFixed(3)} stake=${stake} kelly=${KELLY_FRACTION}`;

      const { data: tradeRow } = await supabase.from("dm_trades").insert({
        symbol: best.combo.symbol, contract_id: contractId,
        contract_type: best.combo.contract, barrier: best.combo.barrier,
        stake, payout: freshPayout, payout_ratio: freshRatio, ev: best.ev,
        win_prob_theoretical: best.combo.theoP, win_prob_statistical: best.combo.statP,
        stat_confidence: best.combo.statConf, status: "open", reasoning,
        strategy: "ev_scan", entry_quote: lastQuote[best.combo.symbol] ?? null,
      }).select().single();

      // Subscribe to settlement
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
        // Update state
        const newConsec = won ? 0 : consecLosses + 1;
        const cd = newConsec >= MAX_CONSEC_LOSSES
          ? new Date(Date.now() + COOLDOWN_SECONDS * 1000).toISOString() : null;
        await supabase.from("dm_state").update({
          peak_balance: Math.max(peak, balance + profit),
          consec_losses: newConsec, cooldown_until: cd,
          session_start_balance: stateRow?.session_start_balance ?? balance,
          updated_at: new Date().toISOString(),
        }).eq("id", 1);
        runMessage = `${best.combo.symbol} ${best.combo.contract}` +
          (best.combo.barrier !== null ? ` ${best.combo.barrier}` : "") +
          ` → ${won ? "WIN" : "LOSS"} ${profit >= 0 ? "+" : ""}${profit.toFixed(2)} (EV ${(best.ev*100).toFixed(2)}%)`;
      } catch {
        runMessage = `Trade ${contractId} placed (settlement pending)`;
      }
    } else {
      runMessage = `No EV opportunity (best EV ${best ? (best.ev*100).toFixed(2)+"%" : "n/a"} < ${MIN_EV*100}%)`;
      // Still update peak
      await supabase.from("dm_state").update({
        peak_balance: Math.max(peak, balance), updated_at: new Date().toISOString(),
      }).eq("id", 1);
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
