
CREATE TABLE public.bot_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol TEXT NOT NULL,
  signal TEXT NOT NULL,
  price NUMERIC NOT NULL,
  reason TEXT,
  rsi NUMERIC,
  sma_fast NUMERIC,
  sma_slow NUMERIC,
  atr NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_bot_signals_created ON public.bot_signals (created_at DESC);
CREATE INDEX idx_bot_signals_symbol ON public.bot_signals (symbol);

CREATE TABLE public.bot_trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  qty NUMERIC NOT NULL,
  price NUMERIC NOT NULL,
  value NUMERIC NOT NULL,
  alpaca_order_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_bot_trades_created ON public.bot_trades (created_at DESC);

CREATE TABLE public.portfolio_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  equity NUMERIC NOT NULL,
  cash NUMERIC NOT NULL,
  portfolio_value NUMERIC NOT NULL,
  buying_power NUMERIC NOT NULL,
  positions JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_snapshots_created ON public.portfolio_snapshots (created_at DESC);

CREATE TABLE public.bot_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status TEXT NOT NULL,
  message TEXT,
  symbols_processed INTEGER DEFAULT 0,
  signals_generated INTEGER DEFAULT 0,
  trades_executed INTEGER DEFAULT 0,
  duration_ms INTEGER,
  market_open BOOLEAN,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_bot_runs_created ON public.bot_runs (created_at DESC);

ALTER TABLE public.bot_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portfolio_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read signals" ON public.bot_signals FOR SELECT USING (true);
CREATE POLICY "Public read trades" ON public.bot_trades FOR SELECT USING (true);
CREATE POLICY "Public read snapshots" ON public.portfolio_snapshots FOR SELECT USING (true);
CREATE POLICY "Public read runs" ON public.bot_runs FOR SELECT USING (true);
