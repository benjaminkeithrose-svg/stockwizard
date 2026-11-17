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

-- Favourites and option structures: own rows only; a structure needs 1 to 4 legs and a known status.
grant all on public.user_settings, public.option_positions to authenticated;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
insert into public.user_settings (favourites) values ('[{"kind":"indicator","name":"ema","params":{"length":21}}]');
insert into public.option_positions (symbol, structure, expiry, legs)
  values ('SPY', 'iron_condor', '2026-11-20', '[{"right":"P","side":"buy","strike":589,"qty":1},{"right":"P","side":"sell","strike":594,"qty":1},{"right":"C","side":"sell","strike":606,"qty":1},{"right":"C","side":"buy","strike":611,"qty":1}]');
do $$ begin
  begin
    insert into public.option_positions (symbol, structure, expiry, legs) values ('SPY', 'call', '2026-11-20', '[]');
    raise exception 'FAIL: a structure with no legs accepted';
  exception when check_violation then null; end;
  begin
    insert into public.option_positions (symbol, structure, expiry, legs, status) values ('SPY', 'call', '2026-11-20', '[{"right":"C","side":"buy","strike":600,"qty":1}]', 'sent');
    raise exception 'FAIL: an unknown status accepted';
  exception when check_violation then null; end;
end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
do $$ begin
  if (select count(*) from public.option_positions) <> 0 then raise exception 'FAIL: B sees A''s option structures'; end if;
  if (select count(*) from public.user_settings) <> 0 then raise exception 'FAIL: B sees A''s favourites'; end if;
  update public.option_positions set status = 'bought';
  begin
    insert into public.option_positions (owner, symbol, structure, expiry, legs)
      values ('00000000-0000-0000-0000-00000000000a', 'SPY', 'call', '2026-11-20', '[{"right":"C","side":"buy","strike":600,"qty":1}]');
    raise exception 'FAIL: B wrote a structure as A';
  exception when insufficient_privilege then null; end;
end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$ begin
  if (select status from public.option_positions) <> 'planned' then raise exception 'FAIL: B changed A''s structure'; end if;
end $$;
reset role;

-- Safety rails: the daily limit starts empty; every limit change is audited; Ben can't write orders,
-- only decide them; the kill switch drops waiting proposals and blocks approval; no live setting exists.
grant all on public.safety_limits, public.paper_orders to authenticated;
grant select on public.audit_log to authenticated;
insert into public.paper_orders (owner, symbol, structure, expiry, legs, quantity, limit_price, price_kind, max_loss)
  select '00000000-0000-0000-0000-00000000000a', 'SPY', 'iron_condor', '2026-11-18', '[]', 1, 4.6, 'credit', 40 from generate_series(1, 3);
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
insert into public.safety_limits default values;
do $$ declare n int; begin
  if (select max_loss_per_day from public.safety_limits) is not null then raise exception 'FAIL: the daily limit does not start empty'; end if;
  if (select approval_mode from public.safety_limits) <> 'approval' then raise exception 'FAIL: approval is not the default'; end if;
  if (select max_loss_per_trade from public.safety_limits) <> 50 then raise exception 'FAIL: the per-trade limit does not start at 50'; end if;
  if exists (select 1 from information_schema.columns where table_name = 'safety_limits' and column_name ilike '%live%') then
    raise exception 'FAIL: a live-trading setting exists';
  end if;
  update public.safety_limits set max_loss_per_day = 100;
  if (select count(*) from public.audit_log where action in ('limits_set', 'limits_changed')) <> 2 then raise exception 'FAIL: limit changes are not audited'; end if;
  if (select detail->'old'->>'max_loss_per_day' from public.audit_log where action = 'limits_changed') is not null
     or (select (detail->'new'->>'max_loss_per_day')::numeric from public.audit_log where action = 'limits_changed') <> 100 then
    raise exception 'FAIL: the audit entry does not show old and new';
  end if;
  begin
    update public.safety_limits set max_loss_per_trade = -1;
    raise exception 'FAIL: a negative limit accepted';
  exception when check_violation then null; end;
  begin
    insert into public.paper_orders (owner, symbol, structure, expiry, legs, quantity, limit_price, price_kind)
      values ('00000000-0000-0000-0000-00000000000a', 'SPY', 'call', '2026-11-18', '[]', 1, 1, 'debit');
    raise exception 'FAIL: the app wrote an order';
  exception when insufficient_privilege then null; end;
  update public.paper_orders set status = 'sent';
  if (select count(*) from public.paper_orders where status = 'sent') <> 0 then raise exception 'FAIL: the app changed an order directly'; end if;
  if public.decide_order((select min(id) from public.paper_orders), true) <> 'approved' then raise exception 'FAIL: approval'; end if;
  begin
    perform public.decide_order((select min(id) from public.paper_orders), false);
    raise exception 'FAIL: an order was decided twice';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  n := public.kill_switch();
  if n <> 3 then raise exception 'FAIL: the kill switch dropped % orders, not 3', n; end if;
  if not (select kill_switch from public.safety_limits) then raise exception 'FAIL: the kill switch is not on'; end if;
  if not exists (select 1 from public.audit_log where action = 'kill_switch') then raise exception 'FAIL: the kill switch is not audited'; end if;
  begin
    delete from public.audit_log;
    if exists (select 1 from public.audit_log where action = 'kill_switch') then null; else raise exception 'FAIL: audit rows deleted'; end if;
  exception when insufficient_privilege or raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
do $$ begin
  if (select count(*) from public.paper_orders) <> 0 then raise exception 'FAIL: B sees A''s orders'; end if;
  if (select count(*) from public.safety_limits) <> 0 then raise exception 'FAIL: B sees A''s limits'; end if;
  begin
    perform public.decide_order((select min(id) from public.paper_orders), true);
    raise exception 'FAIL: B decided A''s order';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
end $$;
reset role;
do $$ begin
  if (select count(*) from public.paper_orders where status = 'cancelled') <> 3 then raise exception 'FAIL: kill switch did not cancel the waiting orders'; end if;
end $$;

-- Backtests: signed-in users read; only the server writes.
grant all on public.strategies, public.backtest_runs, public.backtest_trades, public.backtest_metrics to anon, authenticated;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$ begin
  if (select count(*) from public.strategies) <> 12 then raise exception 'FAIL: the 12 starting strategies are not readable'; end if;
  update public.strategies set enabled = false;
  if exists (select 1 from public.strategies where not enabled) then raise exception 'FAIL: browser changed a strategy'; end if;
  begin
    insert into public.backtest_runs (strategy_id, strategy_version, config, config_hash, as_of, start_date, split_date, code_version, source, data_hash, result_hash)
      values ('vix_drawdown_pct', 1, '{}', 'x', now(), '2006-01-02', '2021-11-17', 'x', 'x', 'x', 'x');
    raise exception 'FAIL: browser wrote a backtest run';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set role anon;
do $$ begin
  if (select count(*) from public.strategies) <> 0 then raise exception 'FAIL: anon reads strategies'; end if;
end $$;
reset role;

-- Pattern lab: signed-in users read; only the server writes.
grant all on public.feature_sets, public.pattern_runs, public.pattern_candidates to anon, authenticated;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$ begin
  if (select count(*) from public.feature_sets) <> 1 then raise exception 'FAIL: feature set not readable'; end if;
  begin
    insert into public.pattern_runs (question, feature_set, settings, settings_hash, start_date, split_date, as_of, code_version, source, data_hash, result_hash, counts)
      values ('x', 'spy_vix_daily', '{}', 'x', '2006-01-02', '2021-11-17', now(), 'x', 'x', 'x', 'x', '{}');
    raise exception 'FAIL: browser wrote a pattern run';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- Audit log: append-only for everyone, readable only by its owner; Claude's cap.
insert into public.audit_log (actor, user_id, action) values ('claude', '00000000-0000-0000-0000-00000000000a', 'test');
do $$ begin
  begin
    update public.audit_log set action = 'changed';
    raise exception 'FAIL: audit log row changed';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  begin
    delete from public.audit_log;
    raise exception 'FAIL: audit log row deleted';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  if not public.claude_take('00000000-0000-0000-0000-00000000000a', 2) then raise exception 'FAIL: first request refused'; end if;
  if not public.claude_take('00000000-0000-0000-0000-00000000000a', 2) then raise exception 'FAIL: second request refused'; end if;
  if public.claude_take('00000000-0000-0000-0000-00000000000a', 2) then raise exception 'FAIL: cap not enforced'; end if;
  if (select requests from public.claude_usage) <> 2 then raise exception 'FAIL: refused request was counted'; end if;
end $$;
grant select on public.audit_log, public.claude_usage to authenticated;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
do $$ begin
  if (select count(*) from public.audit_log) <> 0 then raise exception 'FAIL: B reads A''s audit log'; end if;
  begin
    perform public.claude_take('00000000-0000-0000-0000-00000000000b', 100);
    raise exception 'FAIL: browser can take Claude requests';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

select 'all RLS checks passed' as result;
