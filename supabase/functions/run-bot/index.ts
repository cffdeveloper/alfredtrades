// MAVERICK TRADING BOT — Edge function (one cycle)
// Strategy: Golden Cross (50/200 SMA) + RSI(14) + ATR(14) stop-loss
// Runs against Alpaca Paper. Triggered on demand or via cron.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const ALPACA_KEY = Deno.env.get("ALPACA_API_KEY")!;
const ALPACA_SECRET = Deno.env.get("ALPACA_SECRET_KEY")!;
const ALPACA_BASE = "https://paper-api.alpaca.markets";
const ALPACA_DATA = "https://data.alpaca.markets";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

// Strategy params
const SYMBOLS = ["SPY", "QQQ", "AAPL", "MSFT", "NVDA"];
const FAST_MA = 50;
const SLOW_MA = 200;
const RSI_PERIOD = 14;
const RSI_OVERSOLD = 35;
const RSI_OVERBOUGHT = 70;
const ATR_PERIOD = 14;
const ATR_MULT = 2.0;
const RISK_PER_TRADE = 0.02;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const alpacaHeaders = {
  "APCA-API-KEY-ID": ALPACA_KEY,
  "APCA-API-SECRET-KEY": ALPACA_SECRET,
};

async function alpacaGet(url: string) {
  const r = await fetch(url, { headers: alpacaHeaders });
  if (!r.ok) throw new Error(`Alpaca GET ${url} -> ${r.status} ${await r.text()}`);
  return r.json();
}
async function alpacaPost(url: string, body: unknown) {
  const r = await fetch(url, {
    method: "POST",
    headers: { ...alpacaHeaders, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Alpaca POST ${url} -> ${r.status} ${await r.text()}`);
  return r.json();
}

type Bar = { o: number; h: number; l: number; c: number; v: number; t: string };

async function getBars(symbol: string): Promise<Bar[]> {
  // ~1 year of daily bars
  const end = new Date();
  end.setDate(end.getDate() - 1); // Alpaca free tier: end must be <= yesterday
  const start = new Date();
  start.setFullYear(start.getFullYear() - 2);
  const url = `${ALPACA_DATA}/v2/stocks/${symbol}/bars?timeframe=1Day&start=${start.toISOString()}&end=${end.toISOString()}&limit=500&adjustment=raw&feed=iex`;
  const data = await alpacaGet(url);
  return data.bars ?? [];
}

function sma(arr: number[], period: number): number | null {
  if (arr.length < period) return null;
  const slice = arr.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function rsi(closes: number[], period: number): number | null {
  if (closes.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gains += d; else losses -= d;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function atr(bars: Bar[], period: number): number | null {
  if (bars.length < period + 1) return null;
  const trs: number[] = [];
  for (let i = bars.length - period; i < bars.length; i++) {
    const cur = bars[i], prev = bars[i - 1];
    const tr = Math.max(
      cur.h - cur.l,
      Math.abs(cur.h - prev.c),
      Math.abs(cur.l - prev.c),
    );
    trs.push(tr);
  }
  return trs.reduce((a, b) => a + b, 0) / period;
}

type Indicators = {
  price: number;
  smaFast: number | null;
  smaSlow: number | null;
  rsi: number | null;
  atr: number | null;
};

function compute(bars: Bar[]): Indicators | null {
  if (bars.length < SLOW_MA + 5) return null;
  const closes = bars.map((b) => b.c);
  return {
    price: closes[closes.length - 1],
    smaFast: sma(closes, FAST_MA),
    smaSlow: sma(closes, SLOW_MA),
    rsi: rsi(closes, RSI_PERIOD),
    atr: atr(bars, ATR_PERIOD),
  };
}

type Signal = "BUY" | "SELL" | "HOLD" | "STOP-LOSS";
function generateSignal(ind: Indicators): { signal: Signal; reason: string } {
  const { price, smaFast, smaSlow, rsi: r } = ind;
  if (smaFast == null || smaSlow == null || r == null) {
    return { signal: "HOLD", reason: "Insufficient data" };
  }
  const golden = smaFast > smaSlow;
  const death = smaFast < smaSlow;
  if (golden && r < RSI_OVERSOLD && price > smaFast) {
    return { signal: "BUY", reason: `Golden Cross + RSI=${r.toFixed(1)}<${RSI_OVERSOLD} + price>$${smaFast.toFixed(2)}` };
  }
  if (death) return { signal: "SELL", reason: "Death Cross" };
  if (r > RSI_OVERBOUGHT) return { signal: "SELL", reason: `RSI=${r.toFixed(1)}>${RSI_OVERBOUGHT} overbought` };
  return { signal: "HOLD", reason: `RSI=${r.toFixed(1)}, golden=${golden}` };
}

async function getPosition(symbol: string) {
  const r = await fetch(`${ALPACA_BASE}/v2/positions/${symbol}`, { headers: alpacaHeaders });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`getPosition ${symbol}: ${r.status}`);
  return r.json();
}

async function submitOrder(symbol: string, side: "buy" | "sell", qty: number) {
  return alpacaPost(`${ALPACA_BASE}/v2/orders`, {
    symbol, qty, side, type: "market", time_in_force: "day",
  });
}

function calcQty(equity: number, price: number, atrVal: number): number {
  const stopDist = atrVal * ATR_MULT;
  if (stopDist <= 0) return 0;
  const riskDollars = equity * RISK_PER_TRADE;
  const shares = Math.floor(riskDollars / stopDist);
  const maxShares = Math.floor((equity * 0.10) / price);
  return Math.max(0, Math.min(shares, maxShares));
}

async function runCycle() {
  const start = Date.now();
  let signalsGenerated = 0;
  let tradesExecuted = 0;
  let symbolsProcessed = 0;
  let runStatus = "success";
  let runMessage = "";
  let marketOpen = false;

  try {
    // Account & clock
    const [account, clock] = await Promise.all([
      alpacaGet(`${ALPACA_BASE}/v2/account`),
      alpacaGet(`${ALPACA_BASE}/v2/clock`),
    ]);
    marketOpen = !!clock.is_open;
    const equity = parseFloat(account.equity);

    for (const symbol of SYMBOLS) {
      try {
        const bars = await getBars(symbol);
        const ind = compute(bars);
        if (!ind) continue;
        symbolsProcessed++;

        const { signal, reason } = generateSignal(ind);
        signalsGenerated++;

        await supabase.from("bot_signals").insert({
          symbol, signal, price: ind.price, reason,
          rsi: ind.rsi, sma_fast: ind.smaFast, sma_slow: ind.smaSlow, atr: ind.atr,
        });

        const position = await getPosition(symbol);

        // Stop-loss
        if (position && ind.atr) {
          const entry = parseFloat(position.avg_entry_price);
          const cur = parseFloat(position.current_price);
          const stop = entry - ind.atr * ATR_MULT;
          if (cur < stop && marketOpen) {
            const qty = Math.abs(parseInt(position.qty));
            const order = await submitOrder(symbol, "sell", qty);
            await supabase.from("bot_trades").insert({
              symbol, side: "sell", qty, price: cur, value: qty * cur,
              alpaca_order_id: order.id,
            });
            await supabase.from("bot_signals").insert({
              symbol, signal: "STOP-LOSS", price: cur,
              reason: `Stop @ $${stop.toFixed(2)} hit`,
            });
            tradesExecuted++;
            continue;
          }
        }

        if (!marketOpen) continue;

        if (signal === "BUY" && !position && ind.atr) {
          const qty = calcQty(equity, ind.price, ind.atr);
          if (qty > 0) {
            const order = await submitOrder(symbol, "buy", qty);
            await supabase.from("bot_trades").insert({
              symbol, side: "buy", qty, price: ind.price, value: qty * ind.price,
              alpaca_order_id: order.id,
            });
            tradesExecuted++;
          }
        } else if (signal === "SELL" && position) {
          const qty = Math.abs(parseInt(position.qty));
          const order = await submitOrder(symbol, "sell", qty);
          await supabase.from("bot_trades").insert({
            symbol, side: "sell", qty, price: ind.price, value: qty * ind.price,
            alpaca_order_id: order.id,
          });
          tradesExecuted++;
        }
      } catch (e) {
        console.error(`Symbol ${symbol} error:`, e);
      }
    }

    // Snapshot portfolio
    try {
      const positions = await alpacaGet(`${ALPACA_BASE}/v2/positions`);
      await supabase.from("portfolio_snapshots").insert({
        equity: parseFloat(account.equity),
        cash: parseFloat(account.cash),
        portfolio_value: parseFloat(account.portfolio_value),
        buying_power: parseFloat(account.buying_power),
        positions: positions.map((p: Record<string, string>) => ({
          symbol: p.symbol,
          qty: parseFloat(p.qty),
          avg_entry: parseFloat(p.avg_entry_price),
          current_price: parseFloat(p.current_price),
          market_value: parseFloat(p.market_value),
          unrealized_pl: parseFloat(p.unrealized_pl),
          unrealized_plpc: parseFloat(p.unrealized_plpc) * 100,
        })),
      });
    } catch (e) {
      console.error("Snapshot error:", e);
    }
  } catch (e) {
    runStatus = "error";
    runMessage = (e as Error).message;
    console.error("Cycle error:", e);
  }

  const duration = Date.now() - start;
  await supabase.from("bot_runs").insert({
    status: runStatus, message: runMessage,
    symbols_processed: symbolsProcessed,
    signals_generated: signalsGenerated,
    trades_executed: tradesExecuted,
    duration_ms: duration,
    market_open: marketOpen,
  });

  return { runStatus, marketOpen, symbolsProcessed, signalsGenerated, tradesExecuted, duration };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const result = await runCycle();
    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
