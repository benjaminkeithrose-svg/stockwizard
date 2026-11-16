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

-- Workspaces: each person sees and changes only their own tabs.
grant all on public.workspaces to authenticated;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
insert into public.workspaces (name, symbol, timeframe) values ('SPY daily', 'SPY', '1d');
do $$ declare t timestamptz; begin
  if (select count(*) from public.workspaces) <> 1 then raise exception 'FAIL: A cannot see own tab'; end if;
  select updated_at into t from public.workspaces;
  update public.workspaces set updated_at = '2000-01-01', name = 'Renamed';
  if (select updated_at from public.workspaces) < t then raise exception 'FAIL: updated_at not stamped by the server'; end if;
  begin
    insert into public.workspaces (name, symbol, timeframe, indicators) values ('Bad', 'SPY', '1d', '{}');
    raise exception 'FAIL: indicators accepted a non-list';
  exception when check_violation then null; end;
end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
do $$ begin
  if (select count(*) from public.workspaces) <> 0 then raise exception 'FAIL: B sees A''s tab'; end if;
  update public.workspaces set name = 'Hijacked';
  begin
    insert into public.workspaces (owner, name, symbol, timeframe)
      values ('00000000-0000-0000-0000-00000000000a', 'Planted', 'SPY', '1d');
    raise exception 'FAIL: B created a tab owned by A';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ begin
  if (select name from public.workspaces) <> 'Renamed' then raise exception 'FAIL: B changed A''s tab'; end if;
end $$;

-- The keepalive answers anyone with the publishable key, and reads nothing.
set role anon;
do $$ begin
  if public.keepalive() is null then raise exception 'FAIL: keepalive returned nothing'; end if;
end $$;
reset role;

-- Scanner: signed-in users read scans and results; only the server writes.
grant all on public.scans, public.scan_runs, public.scan_results to anon, authenticated;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$ begin
  if (select count(*) from public.scans) <> 9 then raise exception 'FAIL: the 9 starting scans are not readable'; end if;
  begin
    update public.scans set enabled = false;
    if exists (select 1 from public.scans where not enabled) then raise exception 'FAIL: browser changed a scan'; end if;
  end;
  begin
    insert into public.scan_runs (scan_id, as_of, rule_version, code_version, params, symbols, source, data_hash, result_hash, matches)
      values ('breakout_1d', now(), 'x', 'x', '{}', '{}', 'x', 'x', 'x', 0);
    raise exception 'FAIL: browser wrote a scan run';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set role anon;
do $$ begin
  if (select count(*) from public.scans) <> 0 then raise exception 'FAIL: anon reads scans'; end if;
end $$;
reset role;

-- Views: own pages only, at most 10 cards.
grant all on public.views to authenticated;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
insert into public.views (name, cards) values ('Morning scan', '[{"id":"c1","workspace_id":"w","x":0,"y":0,"w":6,"h":5}]');
do $$ begin
  begin
    insert into public.views (name, cards) select 'Too many', jsonb_agg(jsonb_build_object('id', g)) from generate_series(1, 11) g;
    raise exception 'FAIL: 11 cards accepted';
  exception when check_violation then null; end;
end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
do $$ begin
  if (select count(*) from public.views) <> 0 then raise exception 'FAIL: B sees A''s page'; end if;
end $$;
reset role;

select 'all RLS checks passed' as result;
