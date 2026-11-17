-- Option backtests sized to Ben's $50 per-trade limit (18 Nov 2026). The first
-- set used $5 wings, which risk hundreds a trade, so the bot would refuse every
-- one. These use $1 wings and skip any trade that could lose more than $50
-- (max_loss_cap), as the bot's per-trade rail would. Family spy_fly_50.

insert into public.option_strategies (id, label, family, config, start_date, split_date, position, notes) values
  ('fly1_0dte', '0DTE iron fly, $1 wings ($50 cap)', 'spy_fly_50',
   '{"structure":"iron_fly","dte":0,"wing":1,"manage":"expiry","commission":0.65,"slippage":0.05,"max_loss_cap":50}',
   '2006-01-02', '2021-11-17', 10, 'Shorts at the open, $1 wings; settles at the close'),
  ('fly1_3d', '3-day iron fly, $1 wings ($50 cap)', 'spy_fly_50',
   '{"structure":"iron_fly","dte":3,"wing":1,"manage":"expiry","commission":0.65,"slippage":0.05,"max_loss_cap":50}',
   '2006-01-02', '2021-11-17', 11, 'Shorts at the open, $1 wings; expires two trading days later'),
  ('fly1_3d_take50', '3-day iron fly, $1 wings, take 50% ($50 cap)', 'spy_fly_50',
   '{"structure":"iron_fly","dte":3,"wing":1,"manage":"take_50","commission":0.65,"slippage":0.05,"max_loss_cap":50}',
   '2006-01-02', '2021-11-17', 12, 'Closed at the first daily close showing half the credit, otherwise held to expiry'),
  ('fly1_0dte_squeeze', '0DTE iron fly, $1 wings, squeeze on ($50 cap)', 'spy_fly_50',
   '{"structure":"iron_fly","dte":0,"wing":1,"manage":"expiry","commission":0.65,"slippage":0.05,"max_loss_cap":50,"signal_rule":"squeeze_on","signal_params":{}}',
   '2006-01-02', '2021-11-17', 13, 'Only the day after SPY''s daily squeeze is on'),
  ('ic1_3d_quarter', '3-day iron condor, shorts ¼ range out, $1 wings ($50 cap)', 'spy_fly_50',
   '{"structure":"iron_condor","dte":3,"short_atr":0.25,"wing":1,"manage":"expiry","commission":0.65,"slippage":0.05,"max_loss_cap":50}',
   '2006-01-02', '2021-11-17', 14, 'Only taken on days the credit keeps the risk at $50 or under');
