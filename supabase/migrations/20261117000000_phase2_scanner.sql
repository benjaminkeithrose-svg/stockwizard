-- Phase 2: the scanner. Scan definitions, each run (with what it used, so it
-- can be re-run and checked), and each run's matches.
--
-- The scanner runs server-side with the secret key after the daily top-up.
-- The browser only reads.

create table public.scans (
  id           text primary key,                 -- e.g. squeeze_on_1d
  label        text not null,
  rule         text not null,                    -- a rule in backend/stockwizard/scans.py
  timeframe    text not null check (timeframe in ('5m', '15m', '30m', '1h', '1d')),
  params       jsonb not null default '{}'::jsonb,
  symbols      text[],                           -- fixed symbols (SPY scans); null = the scanner universe
  context      text[] not null default '{}',     -- symbols shown alongside, e.g. ^VIX
  tab          text not null,                    -- which tab of the Scanner screen
  position     integer not null default 0,
  enabled      boolean not null default true,
  updated_at   timestamptz not null default now()
);

create table public.scan_runs (
  id           bigint generated always as identity primary key,
  scan_id      text not null references public.scans (id) on delete cascade,
  ran_at       timestamptz not null default now(),
  as_of        timestamptz not null,             -- only candles that opened before this were used
  rule_version text not null,                    -- e.g. squeeze_on@1
  code_version text not null,                    -- the stockwizard package version
  params       jsonb not null,
  symbols      text[] not null,
  source       text not null,
  data_hash    text not null,                    -- the candles used; a re-run with other data says so
  result_hash  text not null,                    -- the results; a re-run must match it
  matches      integer not null,
  trigger      text not null default 'schedule' check (trigger in ('schedule', 'manual', 'rerun')),
  notes        text
);

create index scan_runs_latest on public.scan_runs (scan_id, ran_at desc);

create table public.scan_results (
  run_id      bigint not null references public.scan_runs (id) on delete cascade,
  symbol      text not null,
  candle_ts   timestamptz not null,              -- the candle the signal is on
  direction   text check (direction in ('up', 'down')),
  vals        jsonb not null default '{}'::jsonb, -- the numbers shown with the result
  context     jsonb not null default '{}'::jsonb, -- e.g. {"^VIX": 15.2}
  primary key (run_id, symbol)
);

alter table public.scans        enable row level security;
alter table public.scan_runs    enable row level security;
alter table public.scan_results enable row level security;

create policy "signed-in read" on public.scans        for select to authenticated using (true);
create policy "signed-in read" on public.scan_runs    for select to authenticated using (true);
create policy "signed-in read" on public.scan_results for select to authenticated using (true);

-- The first scans, as agreed with Ben on 16 Nov 2026. Settings are starting
-- points for the backtester to test, not tested edges.
insert into public.scans (id, label, rule, timeframe, params, symbols, context, tab, position) values
  ('squeeze_on_1d',     'Squeeze on',          'squeeze_on',     '1d', '{"length":20,"bb_mult":2,"kc_mult":1.5}', null, '{}', 'squeeze_on', 0),
  ('squeeze_on_1h',     'Squeeze on',          'squeeze_on',     '1h', '{"length":20,"bb_mult":2,"kc_mult":1.5}', null, '{}', 'squeeze_on', 1),
  ('squeeze_fired_1d',  'Squeeze fired',       'squeeze_fired',  '1d', '{"length":20,"bb_mult":2,"kc_mult":1.5}', null, '{}', 'squeeze_fired', 0),
  ('squeeze_fired_1h',  'Squeeze fired',       'squeeze_fired',  '1h', '{"length":20,"bb_mult":2,"kc_mult":1.5}', null, '{}', 'squeeze_fired', 1),
  ('breakout_1d',       'Breakouts',           'breakout',       '1d', '{"length":20,"volume_mult":0}',           null, '{}', 'breakout', 0),
  ('breakout_1h',       'Breakouts',           'breakout',       '1h', '{"length":20,"volume_mult":0}',           null, '{}', 'breakout', 1),
  ('spy_trend_break',   'SPY trend break',     'trend_break',    '1d', '{"length":50}',                            '{SPY}', '{^VIX}', 'spy', 0),
  ('spy_drawdown',      'SPY drawdown',        'drawdown',       '1d', '{"lookback":60,"pct":5}',                  '{SPY}', '{^VIX}', 'spy', 1),
  ('spy_rsi_divergence','SPY RSI divergence',  'rsi_divergence', '1d', '{"high_lookback":20,"rsi_length":14,"window":60,"gap":5,"min_drop":2}', '{SPY}', '{^VIX}', 'spy', 2);
