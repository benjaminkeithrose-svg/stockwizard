-- Phase 3b: the pattern lab. Each search run with its question, split and
-- count of patterns tried; the patterns worth seeing (survivors and the
-- strongest of the rest) with discovery and sealed results kept apart; and the
-- sets of measures searched. Server writes; the browser reads.

create table public.feature_sets (
  id       text primary key,
  label    text not null,
  inputs   jsonb not null,      -- symbols and measures, each known at the signal day's close
  notes    text
);

insert into public.feature_sets (id, label, inputs, notes) values
  ('spy_vix_daily', 'SPY with the VIX and 3-month VIX, daily',
   '{"symbols":["SPY","^VIX","^VIX3M"],"timeframe":"1d","measures":"backend/stockwizard/features.py"}',
   'Cross-symbol values matched by date, never carried forward from a later day.');

create table public.pattern_runs (
  id               bigint generated always as identity primary key,
  question         text not null,
  feature_set      text not null references public.feature_sets (id),
  settings         jsonb not null,    -- rise_pct, days, min_episodes, fdr_q, survivors
  settings_hash    text not null,
  start_date       date not null,
  split_date       date not null,     -- discovery before, sealed from here
  ran_at           timestamptz not null default now(),
  as_of            timestamptz not null,
  code_version     text not null,
  source           text not null,
  data_hash        text not null,
  result_hash      text not null,
  counts           jsonb not null,    -- tried, enough_episodes, passed_fdr, stable, survivors, base rates
  sealed_burned    boolean not null default false,  -- sealed years already used with other settings
  trigger          text not null default 'manual' check (trigger in ('manual', 'rerun', 'schedule')),
  notes            text
);

create index pattern_runs_latest on public.pattern_runs (ran_at desc);

create table public.pattern_candidates (
  run_id     bigint not null references public.pattern_runs (id) on delete cascade,
  n          integer not null,
  rule       jsonb not null,          -- [{feature, op, value, pctl}]
  label      text not null,           -- the rule in words
  status     text not null check (status in ('survivor', 'stable', 'unstable', 'not_significant', 'too_rare')),
  discovery  jsonb not null,          -- episodes, hits, rate, lift, p, q, stable: saw the future, not a win rate
  sealed     jsonb not null default '{}'::jsonb,  -- survivors only: the blind backtester on the sealed years
  primary key (run_id, n)
);

alter table public.feature_sets       enable row level security;
alter table public.pattern_runs       enable row level security;
alter table public.pattern_candidates enable row level security;

create policy "signed-in read" on public.feature_sets       for select to authenticated using (true);
create policy "signed-in read" on public.pattern_runs       for select to authenticated using (true);
create policy "signed-in read" on public.pattern_candidates for select to authenticated using (true);
