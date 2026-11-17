"""The 0DTE research framework (stage 2 of Ben's brief, docs/research/0DTE-RESEARCH.md).

Same-day defined-risk option strategies tested bar by bar, with fills at the
bid and ask, fees per instrument, and the exit rules from the brief. Option
prices come from a QuoteSource: a model for now (quotes.ModelQuotes), real
quotes once they exist (quotes.RecordedQuotes, or a bought history). Nothing
here is evidence of profit until it runs on real quotes.

    instruments.py  SPY, XSP, SPX, QQQ: strike steps, sizes, fees
    quotes.py       option chains: the model, and recorded IBKR quotes
    signals.py      opening range, VWAP, direction, session type
    calendar.py     expiration Fridays, Fed days and other tagged days
    strategy.py     a strategy's settings, and choosing strikes by delta
    engine.py       one trade a day, bar by bar: entry, exits, settlement
    stats.py        the statistics from the brief, by period and by regime
    matrix.py       the experiment grid, the false-discovery check and the periods
"""
