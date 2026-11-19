-- 1-minute candles (Ben, 19 Nov 2026): the PC's data program stores a week of them, and a chart tab can use them.
alter table candles drop constraint candles_timeframe_check;
alter table candles add constraint candles_timeframe_check check (timeframe in ('1m', '5m', '15m', '30m', '1h', '1d'));
alter table workspaces drop constraint workspaces_timeframe_check;
alter table workspaces add constraint workspaces_timeframe_check check (timeframe in ('1m', '5m', '15m', '30m', '1h', '1d'));
