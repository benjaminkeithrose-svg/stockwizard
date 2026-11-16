-- Row-level security checks for the phase 0 tables. Run after supabase_stub.sql
-- and the migrations; any failed check raises an error and stops the run.
\set ON_ERROR_STOP on
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;

insert into auth.users values ('00000000-0000-0000-0000-00000000000a'), ('00000000-0000-0000-0000-00000000000b');

-- The loader (service role) writes market data.
set role service_role;
insert into public.symbols values ('SPY', 'US', 'etf', true, 'Example ETF', now());
insert into public.candles (symbol, timeframe, ts, open, high, low, close, volume, source, source_version)
  values ('SPY', '1d', '2026-01-02 05:00+00', 10, 11, 9, 10.5, 100, 'test', 't');
reset role;

do $$ begin
  -- ASX symbols cannot be tradable.
  begin
    insert into public.symbols values ('BHP.AX', 'ASX', 'stock', true, null, now());
    raise exception 'FAIL: tradable ASX symbol accepted';
  exception when check_violation then null; end;
  -- A candle whose high is below its close is refused.
  begin
    insert into public.candles (symbol, timeframe, ts, open, high, low, close, source, source_version)
      values ('SPY', '1d', '2026-01-05 05:00+00', 10, 10, 9, 10.5, 'test', 't');
    raise exception 'FAIL: bad candle accepted';
  exception when check_violation then null; end;
  -- Unknown timeframes are refused.
  begin
    insert into public.candles (symbol, timeframe, ts, open, high, low, close, source, source_version)
      values ('SPY', '1m', '2026-01-05 05:00+00', 10, 11, 9, 10.5, 'test', 't');
    raise exception 'FAIL: 1-minute candle accepted';
  exception when check_violation then null; end;
end $$;

-- Not signed in: sees nothing.
set role anon;
do $$ begin
  if (select count(*) from public.candles) <> 0 then raise exception 'FAIL: anon can read candles'; end if;
end $$;
reset role;

-- Signed in as A: reads market data, cannot write it, manages own watchlists.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$ begin
  if (select count(*) from public.candles) <> 1 then raise exception 'FAIL: signed-in user cannot read candles'; end if;
  begin
    insert into public.candles (symbol, timeframe, ts, open, high, low, close, source, source_version)
      values ('SPY', '1d', '2026-01-06 05:00+00', 10, 11, 9, 10.5, 'test', 't');
    raise exception 'FAIL: browser can write candles';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.symbols (symbol, market, instrument_type) values ('QQQ', 'US', 'etf');
    raise exception 'FAIL: browser can write symbols';
  exception when insufficient_privilege then null; end;
end $$;
insert into public.watchlists (name, is_universe) values ('Universe', true);
insert into public.watchlist_symbols (watchlist_id, symbol)
  select id, 'SPY' from public.watchlists where name = 'Universe';

-- Signed in as B: cannot see or change A's watchlists.
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
do $$ begin
  if (select count(*) from public.watchlists) <> 0 then raise exception 'FAIL: B sees A''s watchlist'; end if;
  if (select count(*) from public.watchlist_symbols) <> 0 then raise exception 'FAIL: B sees A''s symbols'; end if;
  begin
    insert into public.watchlist_symbols (watchlist_id, symbol)
      select id, 'SPY' from public.watchlists limit 1;  -- B cannot even find A's id
    insert into public.watchlist_symbols (watchlist_id, symbol) values (1, 'SPY');
    raise exception 'FAIL: B added to A''s watchlist';
  exception when insufficient_privilege or unique_violation then null; end;
end $$;
reset role;

select 'all RLS checks passed' as result;
