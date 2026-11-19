-- The pattern lab's measures since 19 Nov 2026 (Ben: traditional patterns and linked symbols).
-- pattern_runs.feature_set must name a row here.
insert into feature_sets (id, label, inputs, notes) values (
  'spy_vix_patterns_linked_v1',
  'SPY with the VIX, 3-month VIX, candlestick and chart patterns, and linked symbols, daily',
  '{"symbols": ["SPY", "^VIX", "^VIX3M", "QQQ", "IWM", "NVDA", "AAPL", "TSLA"],
    "measures": "backend/stockwizard/features.py, backend/stockwizard/patterns.py", "timeframe": "1d"}',
  'Patterns count only on their confirmation day. Cross-symbol values matched by date, never carried forward from a later day.'
) on conflict (id) do nothing;
