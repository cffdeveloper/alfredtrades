
-- Drop old tables
DROP TABLE IF EXISTS public.bot_runs CASCADE;
DROP TABLE IF EXISTS public.bot_signals CASCADE;
DROP TABLE IF EXISTS public.bot_trades CASCADE;
DROP TABLE IF EXISTS public.portfolio_snapshots CASCADE;
DROP TABLE IF EXISTS public.signal_weights CASCADE;
DROP TABLE IF EXISTS public.trade_reviews CASCADE;
DROP TABLE IF EXISTS public.deriv_balance CASCADE;
DROP TABLE IF EXISTS public.deriv_runs CASCADE;
DROP TABLE IF EXISTS public.deriv_signals CASCADE;
DROP TABLE IF EXISTS public.deriv_ticks CASCADE;
DROP TABLE IF EXISTS public.deriv_trades CASCADE;

-- Unschedule previous cron jobs (ignore errors if they don't exist)
DO $$ BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname IN ('run-bot-every-minute','deriv-bot-every-minute','deriv-master-every-minute');
EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- Tick storage (multi-symbol)
CREATE TABLE public.dm_ticks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  quote numeric NOT NULL,
  last_digit smallint NOT NULL,
  epoch bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_dm_ticks_symbol_epoch ON public.dm_ticks(symbol, epoch DESC);
ALTER TABLE public.dm_ticks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read dm_ticks" ON public.dm_ticks FOR SELECT USING (true);

-- Cycle runs
CREATE TABLE public.dm_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL,
  message text,
  ticks_collected int DEFAULT 0,
  candidates_scanned int DEFAULT 0,
  trades_executed int DEFAULT 0,
  best_ev numeric,
  duration_ms int,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.dm_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read dm_runs" ON public.dm_runs FOR SELECT USING (true);

-- EV candidates per cycle (top N saved)
CREATE TABLE public.dm_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid REFERENCES public.dm_runs(id) ON DELETE CASCADE,
  symbol text NOT NULL,
  contract_type text NOT NULL,
  barrier smallint,
  win_prob_theoretical numeric,
  win_prob_statistical numeric,
  payout_ratio numeric,
  ev numeric,
  stat_confidence numeric,
  picked boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.dm_candidates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read dm_candidates" ON public.dm_candidates FOR SELECT USING (true);

-- Trades
CREATE TABLE public.dm_trades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  contract_id text,
  contract_type text NOT NULL,
  barrier smallint,
  stake numeric NOT NULL,
  payout numeric,
  payout_ratio numeric,
  ev numeric,
  win_prob_theoretical numeric,
  win_prob_statistical numeric,
  stat_confidence numeric,
  status text NOT NULL DEFAULT 'open',
  pnl numeric,
  won boolean,
  entry_quote numeric,
  exit_quote numeric,
  reasoning text,
  strategy text,
  settled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_dm_trades_created ON public.dm_trades(created_at DESC);
ALTER TABLE public.dm_trades ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read dm_trades" ON public.dm_trades FOR SELECT USING (true);

-- Balance snapshots
CREATE TABLE public.dm_balance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  balance numeric NOT NULL,
  currency text NOT NULL DEFAULT 'USD',
  loginid text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.dm_balance ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read dm_balance" ON public.dm_balance FOR SELECT USING (true);

-- Singleton state (id=1)
CREATE TABLE public.dm_state (
  id int PRIMARY KEY DEFAULT 1,
  peak_balance numeric,
  consec_losses int NOT NULL DEFAULT 0,
  cooldown_until timestamptz,
  session_start_balance numeric,
  session_started_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dm_state_singleton CHECK (id = 1)
);
INSERT INTO public.dm_state (id) VALUES (1) ON CONFLICT DO NOTHING;
ALTER TABLE public.dm_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read dm_state" ON public.dm_state FOR SELECT USING (true);

-- Schedule the new edge function every minute
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.schedule(
  'deriv-master-every-minute',
  '* * * * *',
  $$
  SELECT net.http_post(
    url:='https://decvcncoojtelporould.supabase.co/functions/v1/deriv-master',
    headers:='{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRlY3ZjbmNvb2p0ZWxwb3JvdWxkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcyMjczMjEsImV4cCI6MjA5MjgwMzMyMX0.BH5XAsF1W30uQxKQGmrKkV8pIWLfmmnYct5XpsV8ppU"}'::jsonb,
    body:='{}'::jsonb
  ) AS request_id;
  $$
);
