-- Phase 3: the backtester. Strategies as versioned settings, each saved run
-- with everything needed to repeat it, its trades, and its metrics for the
-- build period, the held-back period and 3-year windows.
--
-- Runs are written server-side with the secret key; the browser only reads.

create table public.strategies (
  id           text primary key,
  label        text not null,
  family       text not null,                  -- the held-back period is single-use per family
  config       jsonb not null,                 -- stockwizard.backtest.Strategy settings
  version      integer not null default 1,     -- bump whenever config changes
  start_date   date not null,                  -- first entry allowed; earlier candles warm up the signal
  split_date   date not null,                  -- build period before, held-back period from here
  position     integer not null default 0,
  enabled      boolean not null default true,
  notes        text,
  updated_at   timestamptz not null default now()
);

create table public.backtest_runs (
  id               bigint generated always as identity primary key,
  strategy_id      text not null references public.strategies (id) on delete cascade,
  strategy_version integer not null,
  config           jsonb not null,
  config_hash      text not null,
  ran_at           timestamptz not null default now(),
  as_of            timestamptz not null,       -- only candles that opened before this were used
  start_date       date not null,
  split_date       date not null,
  code_version     text not null,
  source           text not null,
  data_hash        text not null,
  result_hash      text not null,
  skipped          jsonb not null default '{}'::jsonb,
  warnings         text[] not null default '{}',
  held_back_burned boolean not null default false,  -- the held-back period was already seen with other settings
  trigger          text not null default 'manual' check (trigger in ('manual', 'rerun', 'schedule')),
  notes            text
);

create index backtest_runs_latest on public.backtest_runs (strategy_id, ran_at desc);

create table public.backtest_trades (
  run_id      bigint not null references public.backtest_runs (id) on delete cascade,
  n           integer not null,
  period      text not null check (period in ('build', 'held_back')),
  signal_ts   timestamptz not null,
  entry_ts    timestamptz not null,
  entry_price double precision not null,
  exit_ts     timestamptz,
  exit_price  double precision,
  exit_reason text not null check (exit_reason in ('target', 'stop', 'time', 'open')),
  bars        integer not null,
  return_pct  double precision,
  best_pct    double precision,
  signal_vals jsonb not null default '{}'::jsonb,
  primary key (run_id, n)
);

create table public.backtest_metrics (
  run_id   bigint not null references public.backtest_runs (id) on delete cascade,
  period   text not null,                      -- build, held_back, or a window: 2006-01-02..2009-01-01
  kind     text not null check (kind in ('build', 'held_back', 'window')),
  metrics  jsonb not null,
  position integer not null default 0,
  primary key (run_id, period)
);

alter table public.strategies       enable row level security;
alter table public.backtest_runs    enable row level security;
alter table public.backtest_trades  enable row level security;
alter table public.backtest_metrics enable row level security;

create policy "signed-in read" on public.strategies       for select to authenticated using (true);
create policy "signed-in read" on public.backtest_runs    for select to authenticated using (true);
create policy "signed-in read" on public.backtest_trades  for select to authenticated using (true);
create policy "signed-in read" on public.backtest_metrics for select to authenticated using (true);

-- The first study (Ben, 17 Nov 2026): when an SPY correction signal fires,
-- does the VIX rise far enough, soon enough? Two exit rules side by side.
-- The VIX index itself can't be traded, so these are signal studies with no
-- costs; option pricing comes later. Build 2006 to 16 Nov 2021, held back
-- from 17 Nov 2021 (the last 5 years).
insert into public.strategies (id, label, family, config, start_date, split_date, position, notes) values
  ('vix_trend_break_pct', 'Trend break → VIX +40%', 'spy_vix', '{"signal_symbol":"SPY","signal_rule":"trend_break","signal_params":{"length":50},"trade_symbol":"^VIX","target_pct":40,"stop_pct":15,"max_bars":20,"cost_pct":0,"study":true}', '2006-01-02', '2021-11-17', 0, 'Win: VIX +40% before -15%, within 20 trading days'),
  ('vix_trend_break_22',  'Trend break → VIX 22',   'spy_vix', '{"signal_symbol":"SPY","signal_rule":"trend_break","signal_params":{"length":50},"trade_symbol":"^VIX","target_level":22,"max_bars":30,"cost_pct":0,"study":true}', '2006-01-02', '2021-11-17', 1, 'Win: VIX touches 22 within 30 trading days, no stop'),
  ('vix_drawdown_pct',    'Drawdown → VIX +40%',    'spy_vix', '{"signal_symbol":"SPY","signal_rule":"drawdown","signal_params":{"lookback":60,"pct":5},"trade_symbol":"^VIX","target_pct":40,"stop_pct":15,"max_bars":20,"cost_pct":0,"study":true}', '2006-01-02', '2021-11-17', 2, 'Win: VIX +40% before -15%, within 20 trading days'),
  ('vix_drawdown_22',     'Drawdown → VIX 22',      'spy_vix', '{"signal_symbol":"SPY","signal_rule":"drawdown","signal_params":{"lookback":60,"pct":5},"trade_symbol":"^VIX","target_level":22,"max_bars":30,"cost_pct":0,"study":true}', '2006-01-02', '2021-11-17', 3, 'Win: VIX touches 22 within 30 trading days, no stop'),
  ('vix_divergence_pct',  'RSI divergence → VIX +40%', 'spy_vix', '{"signal_symbol":"SPY","signal_rule":"rsi_divergence","signal_params":{"high_lookback":20,"rsi_length":14,"window":60,"gap":5,"min_drop":2},"trade_symbol":"^VIX","target_pct":40,"stop_pct":15,"max_bars":20,"cost_pct":0,"study":true}', '2006-01-02', '2021-11-17', 4, 'Win: VIX +40% before -15%, within 20 trading days'),
  ('vix_divergence_22',   'RSI divergence → VIX 22',   'spy_vix', '{"signal_symbol":"SPY","signal_rule":"rsi_divergence","signal_params":{"high_lookback":20,"rsi_length":14,"window":60,"gap":5,"min_drop":2},"trade_symbol":"^VIX","target_level":22,"max_bars":30,"cost_pct":0,"study":true}', '2006-01-02', '2021-11-17', 5, 'Win: VIX touches 22 within 30 trading days, no stop');
