// MAVERICK BOT v2 — Multi-Strategy Edge Function (one cycle)
// Strategies: VWAP Z-Score Mean Reversion + Adaptive Momentum + Opening Range Breakout
// Plus regime detector + adaptive Kelly sizing + daily loss circuit breaker
// Runs against Alpaca Paper.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const ALPACA_KEY = Deno.env.get("ALPACA_API_KEY")!;
const ALPACA_SECRET = Deno.env.get("ALPACA_SECRET_KEY")!;
const ALPACA_BASE = "https://paper-api.alpaca.markets";
const ALPACA_DATA = "https://data.alpaca.markets";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

// ── Config (mirrors bot_v2.py) ───────────────────────────────────────────────
const SYMBOLS = ["SPY", "QQQ", "AAPL", "MSFT", "NVDA", "AMZN", "META"];

const ZSCORE_ENTRY_LONG = -1.8;
const ZSCORE_EXIT = 0.2;
const ZSCORE_LOOKBACK = 20;

const EMA_FAST = 8;
const EMA_MED = 21;
const EMA_SLOW = 55;
const ADX_PERIOD = 14;
const ADX_TREND_THRESHOLD = 25;

const BASE_RISK_PCT = 0.015;
const MAX_RISK_PCT = 0.03;
const MIN_RISK_PCT = 0.005;
const MAX_POSITION_PCT = 0.15;
const ATR_STOP_MULT = 2.5;
const ATR_PROFIT_MULT = 3.5;
const MAX_OPEN_POSITIONS = 4;
const DAILY_LOSS_LIMIT = 0.03;

const MIN_BUY_CONFIDENCE = 55;

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

async function getBars(symbol: string, timeframe: "1Day" | "5Min", limit = 120): Promise<Bar[]> {
  const end = new Date();
  end.setMinutes(end.getMinutes() - 16); // free tier delay buffer
  const start = new Date();
  if (timeframe === "1Day") start.setFullYear(start.getFullYear() - 2);
  else start.setDate(start.getDate() - 5);

  const url = `${ALPACA_DATA}/v2/stocks/${symbol}/bars?timeframe=${timeframe}&start=${start.toISOString()}&end=${end.toISOString()}&limit=${limit}&adjustment=raw&feed=iex`;
  const data = await alpacaGet(url);
  return data.bars ?? [];
}

// ── Indicator helpers ────────────────────────────────────────────────────────
function ema(values: number[], period: number): number[] {
  const out: number[] = [];
  const k = 2 / (period + 1);
  let prev = values[0];
  out.push(prev);
  for (let i = 1; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}
function rollingMean(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    out.push(i >= period - 1 ? sum / period : null);
  }
  return out;
}
function rollingStd(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = [];
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) { out.push(null); continue; }
    const slice = values.slice(i - period + 1, i + 1);
    const m = slice.reduce((a, b) => a + b, 0) / period;
    const v = slice.reduce((a, b) => a + (b - m) ** 2, 0) / period;
    out.push(Math.sqrt(v));
  }
  return out;
}
function rsi(closes: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  if (closes.length < period + 1) return out;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gains += d; else losses -= d;
  }
  let avgG = gains / period, avgL = losses / period;
  out[period] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const g = d > 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    avgG = (avgG * (period - 1) + g) / period;
    avgL = (avgL * (period - 1) + l) / period;
    out[i] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
  }
  return out;
}
function trueRanges(bars: Bar[]): number[] {
  const out: number[] = [0];
  for (let i = 1; i < bars.length; i++) {
    const c = bars[i], p = bars[i - 1];
    out.push(Math.max(c.h - c.l, Math.abs(c.h - p.c), Math.abs(c.l - p.c)));
  }
  return out;
}

type Indicators = {
  price: number;
  vwap: number | null;
  zscore: number | null;
  rsi: number | null;
  emaFast: number | null;
  emaMed: number | null;
  emaSlow: number | null;
  emaFastPrev: number | null;
  emaMedPrev: number | null;
  atr: number | null;
  adx: number | null;
  plusDI: number | null;
  minusDI: number | null;
  bbWidth: number | null;
  bbWidthPct: number | null;
  volRatio: number | null;
};

function compute(bars: Bar[]): Indicators | null {
  if (bars.length < 60) return null;
  const closes = bars.map(b => b.c);
  const highs = bars.map(b => b.h);
  const lows = bars.map(b => b.l);
  const vols = bars.map(b => b.v);
  const N = bars.length;
  const last = N - 1;

  // VWAP rolling
  const typicalVol: number[] = bars.map(b => ((b.h + b.l + b.c) / 3) * b.v);
  const tvSum = rollingMean(typicalVol, ZSCORE_LOOKBACK).map(v => v == null ? null : v * ZSCORE_LOOKBACK);
  const vSum = rollingMean(vols, ZSCORE_LOOKBACK).map(v => v == null ? null : v * ZSCORE_LOOKBACK);
  const vwap = tvSum.map((tv, i) => (tv != null && vSum[i] != null && vSum[i]! > 0) ? tv / vSum[i]! : null);

  // Z-Score of (close - vwap)
  const spread = closes.map((c, i) => vwap[i] == null ? null : c - vwap[i]!);
  const spreadNum = spread.map(s => s ?? 0);
  const sMean = rollingMean(spreadNum, ZSCORE_LOOKBACK);
  const sStd = rollingStd(spreadNum, ZSCORE_LOOKBACK);
  const zArr = spread.map((s, i) => (s != null && sMean[i] != null && sStd[i] != null && sStd[i]! > 0)
    ? (s - sMean[i]!) / sStd[i]!
    : null);

  const emaF = ema(closes, EMA_FAST);
  const emaM = ema(closes, EMA_MED);
  const emaS = ema(closes, EMA_SLOW);
  const rsiArr = rsi(closes, 14);

  const tr = trueRanges(bars);
  const atrArr = rollingMean(tr, ADX_PERIOD);

  // ADX
  const plusDM: number[] = [0], minusDM: number[] = [0];
  for (let i = 1; i < N; i++) {
    const upMove = highs[i] - highs[i - 1];
    const dnMove = lows[i - 1] - lows[i];
    plusDM.push((upMove > dnMove && upMove > 0) ? upMove : 0);
    minusDM.push((dnMove > upMove && dnMove > 0) ? dnMove : 0);
  }
  const plusDMavg = rollingMean(plusDM, ADX_PERIOD);
  const minusDMavg = rollingMean(minusDM, ADX_PERIOD);
  const plusDI = plusDMavg.map((v, i) => (v != null && atrArr[i] && atrArr[i]! > 0) ? 100 * v / atrArr[i]! : null);
  const minusDI = minusDMavg.map((v, i) => (v != null && atrArr[i] && atrArr[i]! > 0) ? 100 * v / atrArr[i]! : null);
  const dx = plusDI.map((p, i) => (p != null && minusDI[i] != null && (p + minusDI[i]!) > 0)
    ? 100 * Math.abs(p - minusDI[i]!) / (p + minusDI[i]!)
    : 0);
  const adxArr = rollingMean(dx, ADX_PERIOD);

  // Bollinger width (20)
  const sma20 = rollingMean(closes, 20);
  const std20 = rollingStd(closes, 20);
  const bbWidth = sma20.map((m, i) => (m != null && std20[i] != null && m > 0) ? (4 * std20[i]!) / m : null);
  // bb width percentile (last value rank in array)
  const bbValid = bbWidth.filter(v => v != null) as number[];
  const lastBB = bbWidth[last];
  let bbPct: number | null = null;
  if (lastBB != null && bbValid.length > 0) {
    const below = bbValid.filter(v => v <= lastBB).length;
    bbPct = (below / bbValid.length) * 100;
  }

  // Volume ratio
  const volMean = rollingMean(vols, 20);
  const volRatio = volMean[last] && volMean[last]! > 0 ? vols[last] / volMean[last]! : null;

  return {
    price: closes[last],
    vwap: vwap[last],
    zscore: zArr[last],
    rsi: rsiArr[last],
    emaFast: emaF[last],
    emaMed: emaM[last],
    emaSlow: emaS[last],
    emaFastPrev: emaF[last - 1] ?? null,
    emaMedPrev: emaM[last - 1] ?? null,
    atr: atrArr[last],
    adx: adxArr[last],
    plusDI: plusDI[last],
    minusDI: minusDI[last],
    bbWidth: lastBB,
    bbWidthPct: bbPct,
    volRatio,
  };
}

// ── Regime ───────────────────────────────────────────────────────────────────
type Regime = "TRENDING_UP" | "TRENDING_DOWN" | "RANGING" | "VOLATILE" | "UNKNOWN";

function detectRegime(ind: Indicators): { regime: Regime; conf: number } {
  const { adx, bbWidthPct, emaFast, emaSlow, plusDI, minusDI } = ind;
  if (adx == null || adx === 0) return { regime: "UNKNOWN", conf: 0 };
  if (bbWidthPct != null && bbWidthPct > 85) return { regime: "VOLATILE", conf: Math.round(bbWidthPct) };
  if (adx > ADX_TREND_THRESHOLD && plusDI != null && minusDI != null && emaFast != null && emaSlow != null) {
    if (plusDI > minusDI && emaFast > emaSlow) return { regime: "TRENDING_UP", conf: Math.min(100, Math.round(adx * 2)) };
    if (minusDI > plusDI && emaFast < emaSlow) return { regime: "TRENDING_DOWN", conf: Math.min(100, Math.round(adx * 2)) };
  }
  return { regime: "RANGING", conf: Math.max(0, Math.round(100 - adx)) };
}

// ── Strategies ───────────────────────────────────────────────────────────────
type SignalType = "STRONG_BUY" | "BUY" | "HOLD" | "SELL" | "STRONG_SELL" | "STOP-LOSS";
type StratResult = { signal: SignalType; confidence: number; reason: string; strategy: string };

function stratVWAPZScore(ind: Indicators): StratResult {
  const { zscore, rsi: r, volRatio, vwap, price } = ind;
  if (zscore == null || r == null) return { signal: "HOLD", confidence: 0, reason: "Indicators not ready", strategy: "VWAP_ZScore" };

  if (zscore <= ZSCORE_ENTRY_LONG) {
    let conf = Math.min(95, Math.round(Math.abs(zscore) * 30));
    if (volRatio != null && volRatio > 1.5) conf = Math.min(99, conf + 10);
    if (r < 35) conf = Math.min(99, conf + 15);
    const reason = `Z=${zscore.toFixed(2)}≤${ZSCORE_ENTRY_LONG} | RSI=${r.toFixed(1)} | Vol×${(volRatio ?? 1).toFixed(2)} | VWAP=$${vwap?.toFixed(2)} | $${price.toFixed(2)}`;
    return { signal: conf >= 70 ? "STRONG_BUY" : "BUY", confidence: conf, reason, strategy: "VWAP_ZScore" };
  }
  if (zscore >= ZSCORE_EXIT) {
    return { signal: "SELL", confidence: 80, reason: `Mean reverted: Z=${zscore.toFixed(2)}≥${ZSCORE_EXIT}`, strategy: "VWAP_ZScore" };
  }
  return { signal: "HOLD", confidence: 0, reason: `Z=${zscore.toFixed(2)} | RSI=${r.toFixed(1)}`, strategy: "VWAP_ZScore" };
}

function stratMomentum(ind: Indicators, regime: Regime): StratResult {
  if (regime !== "TRENDING_UP") return { signal: "HOLD", confidence: 0, reason: "Needs TRENDING_UP", strategy: "Momentum" };
  const { emaFast, emaMed, emaSlow, emaFastPrev, emaMedPrev, adx, rsi: r, price } = ind;
  if (emaFast == null || emaMed == null || emaSlow == null || adx == null || r == null) return { signal: "HOLD", confidence: 0, reason: "Indicators not ready", strategy: "Momentum" };

  const aligned = emaFast > emaMed && emaMed > emaSlow;
  const freshCross = emaFastPrev != null && emaMedPrev != null && emaFast > emaMed && emaFastPrev <= emaMedPrev;

  if (aligned && adx > ADX_TREND_THRESHOLD) {
    let conf = Math.min(95, Math.round(adx + (freshCross ? 20 : 0)));
    if (r > 50 && r < 75) conf = Math.min(99, conf + 10);
    const reason = `EMA ${emaFast.toFixed(1)}>${emaMed.toFixed(1)}>${emaSlow.toFixed(1)} | ADX=${adx.toFixed(1)} | RSI=${r.toFixed(1)}${freshCross ? " | Fresh×" : ""} | $${price.toFixed(2)}`;
    return { signal: freshCross ? "STRONG_BUY" : "BUY", confidence: conf, reason, strategy: "Momentum" };
  }
  if (emaFastPrev != null && emaMedPrev != null && emaFast < emaMed && emaFastPrev >= emaMedPrev) {
    return { signal: "SELL", confidence: 75, reason: `EMA bearish cross fast=${emaFast.toFixed(1)}<med=${emaMed.toFixed(1)}`, strategy: "Momentum" };
  }
  return { signal: "HOLD", confidence: 0, reason: `EMAs not aligned | ADX=${adx.toFixed(1)}`, strategy: "Momentum" };
}

const ORB_BUFFER_PCT = 0.001;
function stratORB(symbol: string, currentPrice: number, bars5m: Bar[]): StratResult {
  if (bars5m.length < 6) return { signal: "HOLD", confidence: 0, reason: "ORB: insufficient 5m bars", strategy: "ORB" };
  // Build today's opening range: take the first up to 6 bars (30 min) of the latest session
  const lastTs = new Date(bars5m[bars5m.length - 1].t);
  const sameDay = bars5m.filter(b => {
    const d = new Date(b.t);
    return d.getUTCFullYear() === lastTs.getUTCFullYear() && d.getUTCMonth() === lastTs.getUTCMonth() && d.getUTCDate() === lastTs.getUTCDate();
  });
  if (sameDay.length < 3) return { signal: "HOLD", confidence: 0, reason: "ORB: range not established", strategy: "ORB" };
  const opening = sameDay.slice(0, 6);
  const high = Math.max(...opening.map(b => b.h));
  const low = Math.min(...opening.map(b => b.l));
  const range = high - low;
  if (range <= 0) return { signal: "HOLD", confidence: 0, reason: "ORB: invalid range", strategy: "ORB" };
  const breakoutLevel = high * (1 + ORB_BUFFER_PCT);
  if (currentPrice > breakoutLevel) {
    const conf = Math.min(90, Math.round(((currentPrice - high) / range) * 100 + 50));
    return { signal: "BUY", confidence: conf, reason: `ORB breakout: $${currentPrice.toFixed(2)} > high $${high.toFixed(2)} (range $${range.toFixed(2)})`, strategy: "ORB" };
  }
  void symbol;
  return { signal: "HOLD", confidence: 0, reason: `ORB waiting: $${currentPrice.toFixed(2)} vs high $${high.toFixed(2)}`, strategy: "ORB" };
}

// Map internal strategy names → AI-tracked signal names in `signal_weights`
const STRATEGY_TO_SIGNAL: Record<string, string> = {
  VWAP_ZScore: "zscore_mean_revert",
  Momentum: "trend_follow",
  ORB: "macd_cross",
};

type WeightMap = Record<string, number>; // key: `${signal_name}|${regime}` → weight
let WEIGHTS_CACHE: { map: WeightMap; ts: number } | null = null;
const WEIGHTS_TTL_MS = 60_000;

async function loadWeights(): Promise<WeightMap> {
  if (WEIGHTS_CACHE && Date.now() - WEIGHTS_CACHE.ts < WEIGHTS_TTL_MS) return WEIGHTS_CACHE.map;
  const { data } = await supabase.from("signal_weights").select("signal_name, regime, weight");
  const map: WeightMap = {};
  for (const row of data ?? []) {
    map[`${row.signal_name}|${row.regime}`] = Number(row.weight);
  }
  WEIGHTS_CACHE = { map, ts: Date.now() };
  return map;
}

function weightFor(weights: WeightMap, strategy: string, regime: Regime): number {
  const sig = STRATEGY_TO_SIGNAL[strategy];
  if (!sig) return 1.0;
  const regimeKey = regime === "TRENDING_UP" || regime === "TRENDING_DOWN" ? "trending"
    : regime === "RANGING" ? "ranging"
    : regime === "VOLATILE" ? "volatile" : "all";
  return weights[`${sig}|${regimeKey}`] ?? weights[`${sig}|all`] ?? 1.0;
}

function applyWeight(s: StratResult, w: number): StratResult {
  if (w === 1.0 || s.confidence === 0) return s;
  const adjusted = Math.max(0, Math.min(99, Math.round(s.confidence * w)));
  return { ...s, confidence: adjusted, reason: `${s.reason} [w×${w.toFixed(2)}]` };
}

function combine(signals: StratResult[]): StratResult {
  const buys = signals.filter(s => (s.signal === "BUY" || s.signal === "STRONG_BUY") && s.confidence > 0);
  const sells = signals.filter(s => s.signal === "SELL" || s.signal === "STRONG_SELL");
  if (sells.length) return sells.reduce((a, b) => a.confidence >= b.confidence ? a : b);
  if (buys.length) {
    const best = buys.reduce((a, b) => a.confidence >= b.confidence ? a : b);
    if (buys.length > 1) {
      const bonus = Math.min(15, buys.length * 7);
      return { ...best, confidence: Math.min(99, best.confidence + bonus), reason: `[MULTI-STRAT ×${buys.length}] ${best.reason}` };
    }
    return best;
  }
  return { signal: "HOLD", confidence: 0, reason: "No actionable signal", strategy: "None" };
}

// ── Sizing ───────────────────────────────────────────────────────────────────
function calcQty(equity: number, price: number, atr: number, confidence: number, regime: Regime): number {
  const regimeMult: Record<Regime, number> = {
    TRENDING_UP: 1.2, RANGING: 1.0, VOLATILE: 0.6, TRENDING_DOWN: 0.5, UNKNOWN: 0.4,
  };
  const conf = confidence / 100;
  let riskPct = MIN_RISK_PCT + (MAX_RISK_PCT - MIN_RISK_PCT) * conf * regimeMult[regime];
  riskPct = Math.max(MIN_RISK_PCT, Math.min(MAX_RISK_PCT, riskPct));
  const stopDist = atr * ATR_STOP_MULT;
  if (stopDist <= 0 || price <= 0) return 0;
  const shares = Math.floor((equity * riskPct) / stopDist);
  const maxShares = Math.floor((equity * MAX_POSITION_PCT) / price);
  void BASE_RISK_PCT;
  return Math.max(0, Math.min(shares, maxShares));
}

// ── Alpaca order helpers ─────────────────────────────────────────────────────
async function getPosition(symbol: string) {
  const r = await fetch(`${ALPACA_BASE}/v2/positions/${symbol}`, { headers: alpacaHeaders });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`getPosition ${symbol}: ${r.status}`);
  return r.json();
}
async function submitOrder(symbol: string, side: "buy" | "sell", qty: number) {
  return alpacaPost(`${ALPACA_BASE}/v2/orders`, { symbol, qty, side, type: "market", time_in_force: "day" });
}

// Poll an order up to ~3s for the real fill price. Falls back to fallbackPrice
// if the order is still pending — but we always log the TRUE price when we have it.
async function getFillPrice(orderId: string, fallbackPrice: number): Promise<number> {
  for (let i = 0; i < 6; i++) {
    try {
      const o = await alpacaGet(`${ALPACA_BASE}/v2/orders/${orderId}`);
      const fap = parseFloat(o?.filled_avg_price ?? "");
      if (isFinite(fap) && fap > 0) return fap;
      if (o?.status === "rejected" || o?.status === "canceled") return fallbackPrice;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return fallbackPrice;
}

// Fire-and-forget AI review of a closed trade. Does not block the cycle.
async function fireReview(symbol: string, exitTradeId: string | undefined) {
  if (!exitTradeId) return;
  try {
    fetch(`${SUPABASE_URL}/functions/v1/review-trade`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_KEY}`,
      },
      body: JSON.stringify({ symbol, exitTradeId }),
    }).catch((e) => console.error("review-trade dispatch error", e));
  } catch (e) {
    console.error("fireReview error", e);
  }
}

// ── Main cycle ───────────────────────────────────────────────────────────────
async function runCycle() {
  const start = Date.now();
  let signalsGenerated = 0, tradesExecuted = 0, symbolsProcessed = 0;
  let runStatus = "success", runMessage = "", marketOpen = false;
  let dailyPL = 0, haltEntries = false;
  const regimeSummary: Record<string, { regime: Regime; conf: number }> = {};

  try {
    const [account, clock] = await Promise.all([
      alpacaGet(`${ALPACA_BASE}/v2/account`),
      alpacaGet(`${ALPACA_BASE}/v2/clock`),
    ]);
    marketOpen = !!clock.is_open;
    const equity = parseFloat(account.equity);
    const lastEq = parseFloat(account.last_equity);
    dailyPL = equity - lastEq;
    haltEntries = lastEq > 0 && (dailyPL / lastEq) < -DAILY_LOSS_LIMIT;

    const openPositionsList = await alpacaGet(`${ALPACA_BASE}/v2/positions`);
    let openCount = openPositionsList.length;

    for (const symbol of SYMBOLS) {
      try {
        const [bars, bars5m] = await Promise.all([
          getBars(symbol, "1Day", 120),
          marketOpen ? getBars(symbol, "5Min", 100).catch(() => []) : Promise.resolve([] as Bar[]),
        ]);
        const ind = compute(bars);
        if (!ind || !ind.atr || ind.atr <= 0) continue;
        symbolsProcessed++;

        const { regime, conf: regimeConf } = detectRegime(ind);
        regimeSummary[symbol] = { regime, conf: regimeConf };

        const sigVwap = stratVWAPZScore(ind);
        const sigMom = stratMomentum(ind, regime);
        const sigOrb = bars5m.length ? stratORB(symbol, ind.price, bars5m) : { signal: "HOLD" as SignalType, confidence: 0, reason: "ORB skipped (market closed)", strategy: "ORB" };
        const best = combine([sigVwap, sigMom, sigOrb]);
        signalsGenerated++;

        await supabase.from("bot_signals").insert({
          symbol, signal: best.signal, price: ind.price, reason: best.reason,
          rsi: ind.rsi, sma_fast: ind.emaFast, sma_slow: ind.emaSlow, atr: ind.atr,
          strategy: best.strategy, confidence: best.confidence, regime,
          zscore: ind.zscore, vwap: ind.vwap, adx: ind.adx,
        });

        const position = await getPosition(symbol);

        // Stop / take-profit
        if (position) {
          const entry = parseFloat(position.avg_entry_price);
          const cur = parseFloat(position.current_price);
          const stop = entry - ind.atr * ATR_STOP_MULT;
          const target = entry + ind.atr * ATR_PROFIT_MULT;
          const qty = Math.abs(parseFloat(position.qty));

          if (cur <= stop && marketOpen) {
            const order = await submitOrder(symbol, "sell", qty);
            const fill = await getFillPrice(order.id, cur);
            const { data: tr1 } = await supabase.from("bot_trades").insert({
              symbol, side: "sell", qty, price: fill, value: qty * fill,
              alpaca_order_id: order.id, strategy: "stop_loss",
              stop_price: stop, target_price: target, confidence: 100,
            }).select("id").single();
            await supabase.from("bot_signals").insert({
              symbol, signal: "STOP-LOSS", price: fill, reason: `Stop $${stop.toFixed(2)} hit`,
              strategy: "RiskMgmt", confidence: 100, regime,
            });
            tradesExecuted++; openCount--;
            fireReview(symbol, tr1?.id);
            continue;
          }
          if (cur >= target && marketOpen) {
            const order = await submitOrder(symbol, "sell", qty);
            const fill = await getFillPrice(order.id, cur);
            const { data: tr2 } = await supabase.from("bot_trades").insert({
              symbol, side: "sell", qty, price: fill, value: qty * fill,
              alpaca_order_id: order.id, strategy: "take_profit",
              stop_price: stop, target_price: target, confidence: 95,
            }).select("id").single();
            tradesExecuted++; openCount--;
            fireReview(symbol, tr2?.id);
            continue;
          }
          if ((best.signal === "SELL" || best.signal === "STRONG_SELL") && marketOpen) {
            const order = await submitOrder(symbol, "sell", qty);
            const fill = await getFillPrice(order.id, ind.price);
            const { data: tr3 } = await supabase.from("bot_trades").insert({
              symbol, side: "sell", qty, price: fill, value: qty * fill,
              alpaca_order_id: order.id, strategy: best.strategy,
              stop_price: stop, target_price: target, confidence: best.confidence,
            }).select("id").single();
            tradesExecuted++; openCount--;
            fireReview(symbol, tr3?.id);
          }
          continue;
        }

        // Entries
        if (!marketOpen || haltEntries) continue;
        if (openCount >= MAX_OPEN_POSITIONS) continue;

        if ((best.signal === "BUY" || best.signal === "STRONG_BUY") && best.confidence >= MIN_BUY_CONFIDENCE) {
          const qty = calcQty(equity, ind.price, ind.atr, best.confidence, regime);
          const cash = parseFloat(account.cash);
          if (qty > 0 && qty * ind.price <= cash * 0.95) {
            const stop = ind.price - ind.atr * ATR_STOP_MULT;
            const target = ind.price + ind.atr * ATR_PROFIT_MULT;
            const order = await submitOrder(symbol, "buy", qty);
            const fill = await getFillPrice(order.id, ind.price);
            await supabase.from("bot_trades").insert({
              symbol, side: "buy", qty, price: fill, value: qty * fill,
              alpaca_order_id: order.id, strategy: best.strategy,
              stop_price: fill - ind.atr * ATR_STOP_MULT,
              target_price: fill + ind.atr * ATR_PROFIT_MULT,
              confidence: best.confidence,
            });
            tradesExecuted++; openCount++;
          }
        }
      } catch (e) {
        console.error(`Symbol ${symbol} error:`, e);
      }
    }

    // Snapshot
    try {
      const positions = await alpacaGet(`${ALPACA_BASE}/v2/positions`);
      await supabase.from("portfolio_snapshots").insert({
        equity: parseFloat(account.equity),
        cash: parseFloat(account.cash),
        portfolio_value: parseFloat(account.portfolio_value),
        buying_power: parseFloat(account.buying_power),
        daily_pl: dailyPL,
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
    regime_summary: regimeSummary,
    daily_pl: dailyPL,
    halt_entries: haltEntries,
  });

  return { runStatus, marketOpen, symbolsProcessed, signalsGenerated, tradesExecuted, duration, dailyPL, haltEntries };
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
