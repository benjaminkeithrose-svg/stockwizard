-- Bots made from backtests (Ben, 18 Nov 2026). `source` records the backtest a
-- bot was made from: its kind (option backtest or 0DTE research survivor), id,
-- label, the bot settings it maps to, and its held-back result. A bot whose
-- settings still equal source.config counts as tested and can be switched on;
-- change a setting and it is untested until backtested again. Null for bots
-- set up by hand. The existing row-level security (own rows only, audited)
-- covers the new column.

alter table public.bot_strategies add column source jsonb;
comment on column public.bot_strategies.source is 'The backtest a bot was made from: kind, id, label, config (the settings that were tested), held_back. Null = set up by hand, untested.';
