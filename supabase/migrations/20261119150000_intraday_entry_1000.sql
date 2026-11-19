-- Same-day strategies on IBKR's hourly candles (Ben, 19 Nov 2026, option 2): IBKR's candles run
-- 09:30-10:00, then on the hour, so the second entry moves from 10:30 to 10:00. The settings change,
-- so the next run marks these strategies' held-back years as already seen (burned).
update option_strategies
set config = jsonb_set(config, '{entry}', '"10:00"'),
    label = replace(label, '10:30', '10:00')
where config->>'intraday' = 'true' and config->>'entry' = '10:30';
