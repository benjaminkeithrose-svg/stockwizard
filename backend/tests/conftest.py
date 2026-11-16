"""Made-up candles for the tests. No real market data is used or needed."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest


def make_candles(index: pd.DatetimeIndex, seed: int = 7, start: float = 100.0) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    n = len(index)
    # A random walk with quiet and busy stretches, so squeezes form and fire.
    vol = 0.002 + 0.006 * (np.sin(np.arange(n) / 37.0) ** 2)
    close = start * np.exp(np.cumsum(rng.normal(0, vol)))
    open_ = np.concatenate([[start], close[:-1]]) * np.exp(rng.normal(0, vol / 4))
    wick = np.abs(rng.normal(0, vol, (2, n))) * close
    high = np.maximum(open_, close) + wick[0]
    low = np.minimum(open_, close) - wick[1]
    volume = rng.integers(1_000, 50_000, n).astype(float)
    return pd.DataFrame({"open": open_, "high": high, "low": low, "close": close, "volume": volume}, index=index)


def intraday_index(days: int, bar_minutes: int = 5, first: str = "2025-03-03") -> pd.DatetimeIndex:
    """US regular-session candle open times (09:30 to 16:00 New York), weekdays only, in UTC."""
    stamps = []
    for d in pd.bdate_range(first, periods=days):
        opens = pd.date_range(
            pd.Timestamp(f"{d.date()} 09:30", tz="America/New_York"),
            pd.Timestamp(f"{d.date()} 16:00", tz="America/New_York"),
            freq=f"{bar_minutes}min",
            inclusive="left",
        )
        stamps.extend(opens)
    return pd.DatetimeIndex(stamps).tz_convert("UTC")


def daily_index(days: int, first: str = "2020-01-02") -> pd.DatetimeIndex:
    """Daily candles stamped at midnight New York on each session date, in UTC."""
    return pd.DatetimeIndex(
        [pd.Timestamp(d.date(), tz="America/New_York") for d in pd.bdate_range(first, periods=days)]
    ).tz_convert("UTC")


@pytest.fixture(scope="session")
def intraday() -> pd.DataFrame:
    return make_candles(intraday_index(days=12))


@pytest.fixture(scope="session")
def daily() -> pd.DataFrame:
    return make_candles(daily_index(days=400), seed=11)
