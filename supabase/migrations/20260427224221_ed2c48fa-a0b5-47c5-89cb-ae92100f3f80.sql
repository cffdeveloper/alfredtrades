
CREATE TABLE public.deriv_ticks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  quote numeric NOT NULL,
  last_digit smallint NOT NULL,
  epoch bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_deriv_ticks_symbol_epoch ON public.deriv_ticks(symbol, epoch DESC);

CREATE TABLE public.deriv_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  digit smallint,
  contract_type text,
  confidence numeric,
  entropy numeric,
  reasoning text,
  acted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.deriv_trades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  contract_id text,
  contract_type text NOT NULL,
  digit smallint NOT NULL,
  stake numeric NOT NULL,
  payout numeric,
  pnl numeric,
  status text NOT NULL DEFAULT 'open',
  won boolean,
  confidence numeric,
  reasoning text,
  entry_quote numeric,
  exit_quote numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz
);

CREATE TABLE public.deriv_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL,
  message text,
  ticks_collected integer DEFAULT 0,
  signals_generated integer DEFAULT 0,
  trades_executed integer DEFAULT 0,
  duration_ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.deriv_balance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  balance numeric NOT NULL,
  currency text NOT NULL DEFAULT 'USD',
  loginid text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.deriv_ticks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deriv_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deriv_trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deriv_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deriv_balance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read deriv_ticks" ON public.deriv_ticks FOR SELECT USING (true);
CREATE POLICY "Public read deriv_signals" ON public.deriv_signals FOR SELECT USING (true);
CREATE POLICY "Public read deriv_trades" ON public.deriv_trades FOR SELECT USING (true);
CREATE POLICY "Public read deriv_runs" ON public.deriv_runs FOR SELECT USING (true);
CREATE POLICY "Public read deriv_balance" ON public.deriv_balance FOR SELECT USING (true);
