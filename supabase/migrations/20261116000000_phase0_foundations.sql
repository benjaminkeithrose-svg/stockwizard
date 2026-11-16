-- Phase 0: market data, watchlists and indicator definitions.
-- Later phases add their own tables in their own migrations (SPEC.md, Data model).
--
-- Access: row-level security on every table. The browser signs in as Ben and
-- uses the publishable key ("authenticated" role). Loaders and the scanner run
-- server-side with the service-role key, which bypasses RLS and never reaches
-- the browser.

-- Symbols ----------------------------------------------------------------

create table public.symbols (
  symbol          text primary key,              -- e.g. SPY, ^VIX, BHP.AX
  market          text not null check (market in ('US', 'ASX')),
  instrument_type text not null check (instrument_type in ('stock', 'etf', 'index', 'future', 'option')),
  tradable        boolean not null default false, -- false = watch-only; ASX is always watch-only
  name            text,
  created_at      timestamptz not null default now(),
  constraint asx_is_watch_only check (market <> 'ASX' or not tradable)
);

comment on table public.symbols is 'Instruments the app knows. ASX symbols are watch-only.';

-- Candles ----------------------------------------------------------------

create table public.candles (
  symbol         text not null references public.symbols (symbol) on update cascade,
  timeframe      text not null check (timeframe in ('5m', '15m', '30m', '1h', '1d')),
  ts             timestamptz not null,           -- candle OPEN time, UTC
  open           double precision not null check (open > 0),
  high           double precision not null,
  low            double precision not null check (low > 0),
  close          double precision not null check (close > 0),
  volume         double precision not null default 0 check (volume >= 0),
  source         text not null,                  -- e.g. yahoo-unofficial
  source_version text not null,                  -- loader and adjustment, e.g. stockwizard-0.1.0/split-adjusted
  fetched_at     timestamptz not null default now(),
  primary key (symbol, timeframe, source, ts),
  constraint high_is_highest check (high >= greatest(open, close, low)),
  constraint low_is_lowest check (low <= least(open, close, high))
);

create index candles_lookup on public.candles (symbol, timeframe, ts);

comment on table public.candles is
  'One row per candle per source. ts is the open time; a candle is known only at ts + timeframe.';

-- Watchlists -------------------------------------------------------------

create table public.watchlists (
  id          bigint generated always as identity primary key,
  owner       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text not null,
  is_universe boolean not null default false,    -- the scanner universe
  created_at  timestamptz not null default now(),
  unique (owner, name)
);

create table public.watchlist_symbols (
  watchlist_id bigint not null references public.watchlists (id) on delete cascade,
  symbol       text not null references public.symbols (symbol) on update cascade,
  position     integer not null default 0,
  primary key (watchlist_id, symbol)
);

create index watchlist_symbols_symbol on public.watchlist_symbols (symbol);

-- Indicator definitions --------------------------------------------------

create table public.indicator_defs (
  id           bigint generated always as identity primary key,
  name         text not null,                    -- registry name, e.g. squeeze
  params       jsonb not null default '{}'::jsonb,
  code_version text not null,                    -- e.g. squeeze@1
  label        text,
  created_at   timestamptz not null default now(),
  unique (name, params, code_version)
);

comment on table public.indicator_defs is
  'Saved indicator settings. code_version ties each to the exact library code that computes it.';

-- Row-level security ------------------------------------------------------

alter table public.symbols           enable row level security;
alter table public.candles           enable row level security;
alter table public.watchlists        enable row level security;
alter table public.watchlist_symbols enable row level security;
alter table public.indicator_defs    enable row level security;

-- Market data and indicator definitions: read-only from the browser.
create policy "signed-in read" on public.symbols        for select to authenticated using (true);
create policy "signed-in read" on public.candles        for select to authenticated using (true);
create policy "signed-in read" on public.indicator_defs for select to authenticated using (true);

-- Watchlists: each person manages their own.
create policy "own watchlists" on public.watchlists
  for all to authenticated
  using (owner = (select auth.uid()))
  with check (owner = (select auth.uid()));

create policy "own watchlist symbols" on public.watchlist_symbols
  for all to authenticated
  using (exists (select 1 from public.watchlists w
                 where w.id = watchlist_id and w.owner = (select auth.uid())))
  with check (exists (select 1 from public.watchlists w
                      where w.id = watchlist_id and w.owner = (select auth.uid())));
