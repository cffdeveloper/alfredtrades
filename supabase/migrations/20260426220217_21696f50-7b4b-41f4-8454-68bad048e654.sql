ALTER TABLE public.bot_signals
  ADD COLUMN IF NOT EXISTS strategy text,
  ADD COLUMN IF NOT EXISTS confidence integer,
  ADD COLUMN IF NOT EXISTS regime text,
  ADD COLUMN IF NOT EXISTS zscore numeric,
  ADD COLUMN IF NOT EXISTS vwap numeric,
  ADD COLUMN IF NOT EXISTS adx numeric;

ALTER TABLE public.bot_trades
  ADD COLUMN IF NOT EXISTS strategy text,
  ADD COLUMN IF NOT EXISTS stop_price numeric,
  ADD COLUMN IF NOT EXISTS target_price numeric,
  ADD COLUMN IF NOT EXISTS confidence integer;

ALTER TABLE public.bot_runs
  ADD COLUMN IF NOT EXISTS regime_summary jsonb,
  ADD COLUMN IF NOT EXISTS daily_pl numeric,
  ADD COLUMN IF NOT EXISTS halt_entries boolean DEFAULT false;

ALTER TABLE public.portfolio_snapshots
  ADD COLUMN IF NOT EXISTS daily_pl numeric;