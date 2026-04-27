// FIFO realized P&L computation from a chronological trade ledger.
// Input: trades sorted DESCENDING by created_at (as the dashboard fetches them).
// Output: realized P&L in dollars across all closed (matched) lots.

export interface TradeLite {
  symbol: string;
  side: string;
  qty: number | string;
  price: number | string;
  created_at: string;
}

export function computeRealizedPnL(trades: TradeLite[]): number {
  // Sort ASCENDING (oldest first) so FIFO matching is chronological.
  const ordered = [...trades].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );

  // Per-symbol queue of open BUY lots: { qty, price }.
  const lots: Record<string, Array<{ qty: number; price: number }>> = {};
  let realized = 0;

  for (const t of ordered) {
    const qty = Number(t.qty);
    const price = Number(t.price);
    if (!isFinite(qty) || !isFinite(price) || qty <= 0) continue;

    const sym = t.symbol;
    lots[sym] ??= [];

    if (t.side === "buy") {
      lots[sym].push({ qty, price });
      continue;
    }
    if (t.side === "sell") {
      let remaining = qty;
      while (remaining > 0 && lots[sym].length > 0) {
        const lot = lots[sym][0];
        const matched = Math.min(remaining, lot.qty);
        realized += (price - lot.price) * matched;
        lot.qty -= matched;
        remaining -= matched;
        if (lot.qty <= 1e-9) lots[sym].shift();
      }
      // If remaining > 0 we ignore (would be a short — bot doesn't short).
    }
  }

  return realized;
}
