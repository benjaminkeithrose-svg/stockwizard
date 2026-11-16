"""Free, unofficial development source: Yahoo Finance through the yfinance library.

Decided 16 Nov 2026 (SPEC.md): used to build and test until IBKR or a paid
source is in place. It can break without notice, and nothing tested on it is
reported as validated.

Prices are split-adjusted but not dividend-adjusted, so levels match what was
traded. Yahoo's limits: 5, 15 and 30-minute candles reach back about 60 days,
hourly about 2 years, daily the full history.
"""

from __future__ import annotations

from datetime import date

import pandas as pd

from stockwizard.candles import check_timeframe, validate
from stockwizard.data.base import drop_unfinished

_INTERVALS = {"5m": "5m", "15m": "15m", "30m": "30m", "1h": "60m", "1d": "1d"}


class YahooSource:
    name = "yahoo-unofficial"
    validated = False

    def fetch(self, symbol: str, timeframe: str, start: date | None = None, end: date | None = None) -> pd.DataFrame:
        try:
            import yfinance as yf  # optional: pip install ".[yahoo]"
        except ImportError as e:
            raise RuntimeError('The Yahoo source needs yfinance: pip install ".[yahoo]"') from e
        check_timeframe(timeframe)
        raw = yf.Ticker(symbol).history(
            interval=_INTERVALS[timeframe],
            start=start,
            end=end,
            period=None if start else "max",
            auto_adjust=False,
            actions=False,
            prepost=False,
        )
        return to_candles(raw, timeframe, now=pd.Timestamp.now(tz="UTC"))


def to_candles(raw: pd.DataFrame, timeframe: str, now: pd.Timestamp) -> pd.DataFrame:
    """Turn a yfinance history frame into a validated candle frame."""
    bar = check_timeframe(timeframe)
    if raw.empty:
        raise ValueError("No candles returned")
    df = raw.rename(columns=str.lower)[["open", "high", "low", "close", "volume"]]
    idx = pd.DatetimeIndex(raw.index)
    if idx.tz is None:
        idx = idx.tz_localize("America/New_York")
    df.index = idx.tz_convert("UTC")
    df = df[~df.index.duplicated(keep="last")].sort_index()
    return validate(drop_unfinished(df, bar, now))
