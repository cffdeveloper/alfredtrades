
CREATE TABLE public.trade_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  entry_price numeric NOT NULL,
  exit_price numeric NOT NULL,
  qty numeric NOT NULL,
  pnl numeric NOT NULL,
  pnl_pct numeric NOT NULL,
  hold_seconds integer,
  exit_reason text,
  regime text,
  entry_signals jsonb,
  ai_verdict text,
  ai_lesson text,
  ai_weight_adjustments jsonb,
  model text,
  entry_trade_id uuid,
  exit_trade_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.trade_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read trade_reviews" ON public.trade_reviews FOR SELECT USING (true);

CREATE TABLE public.signal_weights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_name text NOT NULL,
  regime text NOT NULL DEFAULT 'all',
  weight numeric NOT NULL DEFAULT 1.0,
  wins integer NOT NULL DEFAULT 0,
  losses integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (signal_name, regime)
);
ALTER TABLE public.signal_weights ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read signal_weights" ON public.signal_weights FOR SELECT USING (true);

INSERT INTO public.signal_weights (signal_name, regime, weight) VALUES
  ('rsi_oversold', 'all', 1.0),
  ('macd_cross', 'all', 1.0),
  ('vwap_reclaim', 'all', 1.0),
  ('zscore_mean_revert', 'all', 1.0),
  ('trend_follow', 'trending', 1.2),
  ('mean_revert', 'ranging', 1.2);
