-- Option-structure backtests (Ben, 18 Nov 2026): iron condors and iron flies
-- on SPY, priced by model (backend/stockwizard/option_backtest.py). Same
-- rules as the other backtests: settings saved and versioned, each run kept
-- with what it used, build and held-back years apart, the held-back years
-- single-use per family. Runs are written server-side; the app only reads.

create table public.option_strategies (
  id           text primary key,
  label        text not null,
  family       text not null,
  config       jsonb not null,                 -- stockwizard.option_backtest.OptionStrategy settings
  version      integer not null default 1,
  start_date   date not null,
  split_date   date not null,
  position     integer not null default 0,
  enabled      boolean not null default true,
  notes        text,
  updated_at   timestamptz not null default now()
);

create table public.option_runs (
  id               bigint generated always as identity primary key,
  strategy_id      text not null references public.option_strategies (id) on delete cascade,
  strategy_version integer not null,
  config           jsonb not null,
  config_hash      text not null,
  ran_at           timestamptz not null default now(),
  as_of            timestamptz not null,
  start_date       date not null,
  split_date       date not null,
  code_version     text not null,
  source           text not null,
  data_hash        text not null,
  result_hash      text not null,
  report           jsonb not null,             -- {build, held_back, warnings, skipped}
  trades           jsonb not null,             -- every trade, in order
  held_back_burned boolean not null default false,
  trigger          text not null default 'manual' check (trigger in ('manual', 'rerun', 'schedule')),
  notes            text
);

create index option_runs_strategy on public.option_runs (strategy_id, ran_at desc);

create trigger option_strategies_touch before update on public.option_strategies
  for each row execute function public.touch_updated_at();

alter table public.option_strategies enable row level security;
alter table public.option_runs enable row level security;
create policy "signed-in read" on public.option_strategies for select to authenticated using (true);
create policy "signed-in read" on public.option_runs for select to authenticated using (true);

-- The starting set, family spy_condor: each structure every day (the baseline) and on signal days.
insert into public.option_strategies (id, label, family, config, start_date, split_date, position, notes) values
  ('ic_0dte_daily', '0DTE iron condor, every day', 'spy_condor',
   '{"structure":"iron_condor","dte":0,"short_atr":1.0,"wing":5,"manage":"expiry","commission":0.65,"slippage":0.05}',
   '2006-01-02', '2021-11-17', 0, 'Shorts one daily range from the open, $5 wings; settles at the close'),
  ('fly_0dte_daily', '0DTE iron fly, every day', 'spy_condor',
   '{"structure":"iron_fly","dte":0,"wing":5,"manage":"expiry","commission":0.65,"slippage":0.05}',
   '2006-01-02', '2021-11-17', 1, 'Shorts at the open, $5 wings; settles at the close'),
  ('ic_0dte_squeeze', '0DTE iron condor, squeeze on', 'spy_condor',
   '{"structure":"iron_condor","dte":0,"short_atr":1.0,"wing":5,"manage":"expiry","commission":0.65,"slippage":0.05,"signal_rule":"squeeze_on","signal_params":{}}',
   '2006-01-02', '2021-11-17', 2, 'Only the day after SPY''s daily squeeze is on'),
  ('ic_0dte_vixlow', '0DTE iron condor, VIX at or below 15', 'spy_condor',
   '{"structure":"iron_condor","dte":0,"short_atr":1.0,"wing":5,"manage":"expiry","commission":0.65,"slippage":0.05,"vix_max":15}',
   '2006-01-02', '2021-11-17', 3, 'Only when the VIX closed at or below 15 the day before'),
  ('ic_3d_hold', '3-day iron condor, held to expiry', 'spy_condor',
   '{"structure":"iron_condor","dte":3,"short_atr":1.0,"wing":5,"manage":"expiry","commission":0.65,"slippage":0.05}',
   '2006-01-02', '2021-11-17', 4, 'Opens at the open, expires at the close two trading days later'),
  ('ic_9d_hold', '9-day iron condor, held to expiry', 'spy_condor',
   '{"structure":"iron_condor","dte":9,"short_atr":1.0,"wing":5,"manage":"expiry","commission":0.65,"slippage":0.05}',
   '2006-01-02', '2021-11-17', 5, 'Opens at the open, expires at the close eight trading days later'),
  ('ic_9d_take50', '9-day iron condor, take 50%', 'spy_condor',
   '{"structure":"iron_condor","dte":9,"short_atr":1.0,"wing":5,"manage":"take_50","commission":0.65,"slippage":0.05}',
   '2006-01-02', '2021-11-17', 6, 'Closed at the first daily close showing half the credit, otherwise held to expiry'),
  ('ic_9d_take50_squeeze', '9-day iron condor, take 50%, squeeze on', 'spy_condor',
   '{"structure":"iron_condor","dte":9,"short_atr":1.0,"wing":5,"manage":"take_50","commission":0.65,"slippage":0.05,"signal_rule":"squeeze_on","signal_params":{}}',
   '2006-01-02', '2021-11-17', 7, 'Only the day after SPY''s daily squeeze is on');
