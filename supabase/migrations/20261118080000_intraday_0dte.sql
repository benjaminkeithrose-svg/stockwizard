-- Same-day (0DTE) choices from the research (Ben, 18 Nov 2026), each tested
-- against a baseline on SPY's hourly candles (stockwizard.intraday_options).
-- Only ~2 years of free hourly candles: start 19 Nov 2024, the last year held
-- back. $5 wings: research into the methods, not sized to the $50 limit
-- (none of these fit it; see the $1-wing family). Family spy_0dte_methods.

insert into public.option_strategies (id, label, family, config, start_date, split_date, position, notes) values
  ('d0_base', '0DTE condor: baseline (open, VIX, 1 range out)', 'spy_0dte_methods',
   '{"intraday":true,"structure":"iron_condor","entry":"open","vol_source":"vix","strikes":"atr","short_atr":1.0,"wing":5,"commission":0.65,"slippage":0.05}',
   '2024-11-19', '2025-11-17', 20, 'Opens at 09:30, priced with the previous VIX close, shorts one daily range out'),
  ('d0_1030', '0DTE condor: enter 10:30', 'spy_0dte_methods',
   '{"intraday":true,"structure":"iron_condor","entry":"10:30","vol_source":"vix","strikes":"atr","short_atr":1.0,"wing":5,"commission":0.65,"slippage":0.05}',
   '2024-11-19', '2025-11-17', 21, 'The baseline, entered after the first hour'),
  ('d0_vix1d', '0DTE condor: priced with VIX1D', 'spy_0dte_methods',
   '{"intraday":true,"structure":"iron_condor","entry":"open","vol_source":"vix1d","strikes":"atr","short_atr":1.0,"wing":5,"commission":0.65,"slippage":0.05}',
   '2024-11-19', '2025-11-17', 22, 'The baseline, priced with the one-day VIX at the open'),
  ('d0_em', '0DTE condor: shorts at 1.2× the expected move', 'spy_0dte_methods',
   '{"intraday":true,"structure":"iron_condor","entry":"10:30","vol_source":"vix1d","strikes":"expected_move","em_mult":1.2,"wing":5,"commission":0.65,"slippage":0.05}',
   '2024-11-19', '2025-11-17', 23, '10:30, VIX1D, shorts 1.2× the expected move to the close'),
  ('d0_em_stop1', '0DTE condor: expected move, stop at 1× credit', 'spy_0dte_methods',
   '{"intraday":true,"structure":"iron_condor","entry":"10:30","vol_source":"vix1d","strikes":"expected_move","em_mult":1.2,"wing":5,"stop_mult":1.0,"commission":0.65,"slippage":0.05}',
   '2024-11-19', '2025-11-17', 24, 'As above, closed when the loss reaches the credit'),
  ('d0_em_stop2', '0DTE condor: expected move, stop at 2× credit', 'spy_0dte_methods',
   '{"intraday":true,"structure":"iron_condor","entry":"10:30","vol_source":"vix1d","strikes":"expected_move","em_mult":1.2,"wing":5,"stop_mult":2.0,"commission":0.65,"slippage":0.05}',
   '2024-11-19', '2025-11-17', 25, 'As above, closed when the loss reaches twice the credit'),
  ('d0_fly', '0DTE iron fly: 10:30, VIX1D', 'spy_0dte_methods',
   '{"intraday":true,"structure":"iron_fly","entry":"10:30","vol_source":"vix1d","wing":5,"commission":0.65,"slippage":0.05}',
   '2024-11-19', '2025-11-17', 26, 'Shorts at the 10:30 price, $5 wings'),
  ('d0_fly_stop1', '0DTE iron fly: 10:30, VIX1D, stop at 1× credit', 'spy_0dte_methods',
   '{"intraday":true,"structure":"iron_fly","entry":"10:30","vol_source":"vix1d","wing":5,"stop_mult":1.0,"commission":0.65,"slippage":0.05}',
   '2024-11-19', '2025-11-17', 27, 'As above, closed when the loss reaches the credit');
