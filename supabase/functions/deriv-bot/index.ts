// Deriv Matches/Differs autonomous bot — runs every minute via pg_cron.
// Each cycle: opens a WebSocket to Deriv, collects a tick window, evaluates
// an ensemble signal (Bayesian + streak + n-gram + entropy), places at most
// one MATCH/DIFF trade if confidence is high enough, waits for settlement,
// then logs everything to deriv_* tables.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const DERIV_WS = "wss://ws.derivws.com/websockets/v3?app_id=1089";
const SYMBOL = "R_50";
const STAKE = 0.35;
const MIN_CONFIDENCE = 0.62;
const TICK_WINDOW = 60;          // ticks to collect per cycle
const COLLECT_TIMEOUT_MS = 75_000;
const SETTLE_TIMEOUT_MS = 15_000;
const MAX_HISTORY = 500;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// ─── Analytics ───────────────────────────────────────────────────────────
function lastDigitOf(quote: number): number {
  const s = quote.toString();
  // Use the last character of the cleaned numeric string
  const cleaned = s.replace(".", "").replace(/0+$/, "");
  const ch = cleaned.length ? cleaned[cleaned.length - 1] : "0";
  const d = parseInt(ch, 10);
  return isNaN(d) ? 0 : d;
}

function bayesianProbs(history: number[], alpha = 2.0): number[] {
  const counts = new Array(10).fill(0);
  for (const d of history) counts[d]++;
  const total = history.length + alpha * 10;
  return counts.map((c) => (c + alpha) / total);
}

function recentBias(history: number[], lookback = 20): number[] {
  const recent = history.slice(-lookback);
  const counts = new Array(10).fill(0);
  for (const d of recent) counts[d]++;
  const n = recent.length || 1;
  return counts.map((c) => c / n - 0.1);
}

function ngramProbs(history: number[], n: number, alpha = 2.0): number[] | null {
  if (history.length < n + 5) return null;
  const key = history.slice(-n).join(",");
  const counts = new Array(10).fill(0);
  let matches = 0;
  for (let i = 0; i < history.length - n; i++) {
    if (history.slice(i, i + n).join(",") === key) {
      counts[history[i + n]]++;
      matches++;
    }
  }
  if (matches < 5) return null;
  const total = matches + alpha * 10;
  return counts.map((c) => (c + alpha) / total);
}

function entropy(history: number[], lookback = 30): number {
  const recent = history.slice(-lookback);
  if (recent.length === 0) return Math.log2(10);
  const counts = new Array(10).fill(0);
  for (const d of recent) counts[d]++;
  const n = recent.length;
  let H = 0;
  for (const c of counts) if (c > 0) H -= (c / n) * Math.log2(c / n);
  return H;
}

function ensembleSignal(history: number[]) {
  if (history.length < 50) {
    return { digit: null, contract: null, confidence: 0, reasoning: "warming up", entropy: entropy(history) };
  }
  const bay = bayesianProbs(history);
  const bias = recentBias(history, 20);
  const ng2 = ngramProbs(history, 2);
  const ng3 = ngramProbs(history, 3);
  const H = entropy(history);
  const Hmax = Math.log2(10);
  const eBoost = 1.0 + 0.4 * (1.0 - H / Hmax);

  const scores = new Array(10).fill(0);
  for (let d = 0; d < 10; d++) {
    scores[d] += bay[d] * 0.4;
    scores[d] += (bias[d] + 0.1) * 0.25;
    if (ng2) scores[d] += ng2[d] * 0.20;
    if (ng3) scores[d] += ng3[d] * 0.15;
  }
  const total = scores.reduce((a, b) => a + b, 0) || 1;
  const norm = scores.map((s) => s / total);

  let best = 0, worst = 0;
  for (let d = 1; d < 10; d++) {
    if (norm[d] > norm[best]) best = d;
    if (norm[d] < norm[worst]) worst = d;
  }
  const confMatch = Math.min(1, norm[best] * eBoost);
  const confDiff = Math.min(1, (1 - norm[worst]) * eBoost);

  if (confMatch >= confDiff) {
    return {
      digit: best,
      contract: "DIGITMATCH",
      confidence: confMatch,
      reasoning: `MATCH ${best} p=${bay[best].toFixed(3)} bias=${bias[best].toFixed(3)} eBoost=${eBoost.toFixed(2)}`,
      entropy: H,
    };
  }
  return {
    digit: worst,
    contract: "DIGITDIFF",
    confidence: confDiff,
    reasoning: `DIFF ${worst} p=${norm[worst].toFixed(3)} eBoost=${eBoost.toFixed(2)}`,
    entropy: H,
  };
}

// ─── Deriv WebSocket session ─────────────────────────────────────────────
type WSSession = {
  ws: WebSocket;
  send: (payload: Record<string, unknown>) => Promise<void>;
  waitFor: (predicate: (msg: any) => boolean, timeoutMs: number) => Promise<any>;
  close: () => void;
};

function openSession(token: string): Promise<WSSession> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(DERIV_WS);
    const listeners: Array<(msg: any) => void> = [];
    let reqId = 0;

    const timer = setTimeout(() => reject(new Error("WS open timeout")), 10_000);

    ws.onopen = () => {
      clearTimeout(timer);
      resolve({
        ws,
        send: async (payload) => {
          reqId++;
          ws.send(JSON.stringify({ ...payload, req_id: reqId }));
        },
        waitFor: (predicate, timeoutMs) =>
          new Promise((res, rej) => {
            const t = setTimeout(() => {
              const idx = listeners.indexOf(handler);
              if (idx >= 0) listeners.splice(idx, 1);
              rej(new Error("waitFor timeout"));
            }, timeoutMs);
            const handler = (msg: any) => {
              if (predicate(msg)) {
                clearTimeout(t);
                const idx = listeners.indexOf(handler);
                if (idx >= 0) listeners.splice(idx, 1);
                res(msg);
              }
            };
            listeners.push(handler);
          }),
        close: () => { try { ws.close(); } catch (_) { /* ignore */ } },
      });
    };
    ws.onerror = (e) => { clearTimeout(timer); reject(new Error("WS error: " + (e as any).message)); };
    ws.onmessage = (ev) => {
      let msg: any;
      try { msg = JSON.parse(ev.data); } catch { return; }
      // dispatch to all listeners (copy to avoid mutation issues)
      for (const l of [...listeners]) l(msg);
    };
  });
}

// ─── Main cycle ──────────────────────────────────────────────────────────
async function runCycle() {
  const startedAt = Date.now();
  const token = Deno.env.get("DERIV_API_TOKEN");
  if (!token) {
    await supabase.from("deriv_runs").insert({ status: "error", message: "Missing DERIV_API_TOKEN" });
    return { ok: false, error: "missing token" };
  }

  let session: WSSession | null = null;
  let ticksCollected = 0;
  let signalsGenerated = 0;
  let tradesExecuted = 0;
  let runMessage = "";

  try {
    session = await openSession(token);

    // Authorize
    await session.send({ authorize: token });
    const auth = await session.waitFor((m) => m.msg_type === "authorize" || m.error, 10_000);
    if (auth.error) throw new Error("Auth failed: " + auth.error.message);
    const balance = parseFloat(auth.authorize.balance);
    const currency = auth.authorize.currency || "USD";
    const loginid = auth.authorize.loginid || null;
    await supabase.from("deriv_balance").insert({ balance, currency, loginid });

    // Build history: pull recent ticks from DB, then top up via WS
    const { data: dbTicks } = await supabase
      .from("deriv_ticks")
      .select("last_digit, epoch")
      .eq("symbol", SYMBOL)
      .order("epoch", { ascending: false })
      .limit(MAX_HISTORY);
    const history: number[] = (dbTicks ?? []).reverse().map((r: any) => r.last_digit);

    // Subscribe to live ticks for this cycle
    await session.send({ ticks: SYMBOL, subscribe: 1 });

    const tickRows: Array<{ symbol: string; quote: number; last_digit: number; epoch: number }> = [];
    const collectStart = Date.now();
    let currentQuote: number | null = null;

    while (tickRows.length < TICK_WINDOW && Date.now() - collectStart < COLLECT_TIMEOUT_MS) {
      const msg = await session.waitFor((m) => m.msg_type === "tick" || m.error, COLLECT_TIMEOUT_MS).catch(() => null);
      if (!msg) break;
      if (msg.error) throw new Error("Tick error: " + msg.error.message);
      const t = msg.tick;
      const q = parseFloat(t.quote);
      const d = lastDigitOf(q);
      currentQuote = q;
      tickRows.push({ symbol: SYMBOL, quote: q, last_digit: d, epoch: t.epoch });
      history.push(d);
      if (history.length > MAX_HISTORY) history.shift();
    }
    ticksCollected = tickRows.length;
    if (tickRows.length) await supabase.from("deriv_ticks").insert(tickRows);

    // Generate signal
    const signal = ensembleSignal(history);
    signalsGenerated = 1;
    const { data: sigRow } = await supabase.from("deriv_signals").insert({
      symbol: SYMBOL,
      digit: signal.digit,
      contract_type: signal.contract,
      confidence: signal.confidence,
      entropy: signal.entropy,
      reasoning: signal.reasoning,
      acted: false,
    }).select().single();

    // Trade?
    if (signal.digit !== null && signal.confidence >= MIN_CONFIDENCE && signal.contract) {
      // Request proposal
      await session.send({
        proposal: 1,
        amount: STAKE,
        basis: "stake",
        contract_type: signal.contract,
        currency,
        duration: 1,
        duration_unit: "t",
        symbol: SYMBOL,
        barrier: String(signal.digit),
      });
      const prop = await session.waitFor((m) => m.msg_type === "proposal" || m.error, 8_000);
      if (prop.error) throw new Error("Proposal error: " + prop.error.message);
      const proposalId = prop.proposal.id;
      const payout = parseFloat(prop.proposal.payout);

      // Buy
      await session.send({ buy: proposalId, price: STAKE });
      const buy = await session.waitFor((m) => m.msg_type === "buy" || m.error, 8_000);
      if (buy.error) throw new Error("Buy error: " + buy.error.message);
      const contractId = String(buy.buy.contract_id);
      tradesExecuted = 1;

      const { data: tradeRow } = await supabase.from("deriv_trades").insert({
        symbol: SYMBOL,
        contract_id: contractId,
        contract_type: signal.contract,
        digit: signal.digit,
        stake: STAKE,
        payout,
        status: "open",
        confidence: signal.confidence,
        reasoning: signal.reasoning,
        entry_quote: currentQuote,
      }).select().single();

      if (sigRow) await supabase.from("deriv_signals").update({ acted: true }).eq("id", sigRow.id);

      // Wait for settlement
      await session.send({ proposal_open_contract: 1, contract_id: contractId, subscribe: 1 });
      try {
        const settle = await session.waitFor(
          (m) => m.msg_type === "proposal_open_contract" && m.proposal_open_contract.status !== "open",
          SETTLE_TIMEOUT_MS,
        );
        const poc = settle.proposal_open_contract;
        const profit = parseFloat(poc.profit);
        const won = profit > 0;
        if (tradeRow) {
          await supabase.from("deriv_trades").update({
            status: poc.status,
            pnl: profit,
            won,
            exit_quote: parseFloat(poc.exit_tick ?? poc.current_spot ?? "0") || null,
            settled_at: new Date().toISOString(),
          }).eq("id", tradeRow.id);
        }
        runMessage = `Traded ${signal.contract} ${signal.digit} → ${won ? "WON" : "LOST"} ${profit.toFixed(2)}`;
      } catch (_) {
        runMessage = `Trade placed ${contractId} (settlement pending)`;
      }
    } else {
      runMessage = `No trade (conf=${signal.confidence.toFixed(3)} < ${MIN_CONFIDENCE})`;
    }
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    await supabase.from("deriv_runs").insert({
      status: "error",
      message: m,
      ticks_collected: ticksCollected,
      signals_generated: signalsGenerated,
      trades_executed: tradesExecuted,
      duration_ms: Date.now() - startedAt,
    });
    if (session) session.close();
    return { ok: false, error: m };
  }

  if (session) session.close();
  await supabase.from("deriv_runs").insert({
    status: "success",
    message: runMessage,
    ticks_collected: ticksCollected,
    signals_generated: signalsGenerated,
    trades_executed: tradesExecuted,
    duration_ms: Date.now() - startedAt,
  });
  return { ok: true, ticksCollected, signalsGenerated, tradesExecuted, message: runMessage };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const result = await runCycle();
  return new Response(JSON.stringify(result), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status: result.ok ? 200 : 500,
  });
});
