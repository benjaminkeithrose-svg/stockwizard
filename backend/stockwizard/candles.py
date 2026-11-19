"""The candle frame every part of Stock Wizard works on.

A candle frame is a pandas DataFrame with columns open, high, low, close and
volume, indexed by each candle's OPEN time in UTC, strictly increasing. A
candle is only known once it has closed, at open time + its timeframe.
"""

from __future__ import annotations

import pandas as pd

COLUMNS = ["open", "high", "low", "close", "volume"]

# Timeframes the app supports (5 minutes and above, per SPEC.md).
TIMEFRAMES: dict[str, pd.Timedelta] = {
    "1m": pd.Timedelta(minutes=1),
    "5m": pd.Timedelta(minutes=5),
    "15m": pd.Timedelta(minutes=15),
    "30m": pd.Timedelta(minutes=30),
    "1h": pd.Timedelta(hours=1),
    "1d": pd.Timedelta(days=1),
}

# US regular session, used for intraday levels (VWAP, opening range, prior day).
US_TZ = "America/New_York"


class CandleError(ValueError):
    """Candles that break the rules in this module."""


def check_timeframe(timeframe: str) -> pd.Timedelta:
    try:
        return TIMEFRAMES[timeframe]
    except KeyError:
        raise CandleError(
            f"Unknown timeframe {timeframe!r}; use one of {', '.join(TIMEFRAMES)}"
        ) from None


def is_intraday(timeframe: str) -> bool:
    return check_timeframe(timeframe) < pd.Timedelta(days=1)


def validate(df: pd.DataFrame) -> pd.DataFrame:
    """Check a candle frame and return it with float columns.

    Raises CandleError rather than repairing anything: bad data should be seen,
    not quietly fixed.
    """
    missing = [c for c in COLUMNS if c not in df.columns]
    if missing:
        raise CandleError(f"Missing columns: {', '.join(missing)}")
    if not isinstance(df.index, pd.DatetimeIndex):
        raise CandleError("Index must be a DatetimeIndex of candle open times")
    if df.index.tz is None or str(df.index.tz) != "UTC":
        raise CandleError("Index must be in UTC")
    if not df.index.is_monotonic_increasing or df.index.has_duplicates:
        raise CandleError("Candles must be in strictly increasing time order")

    out = df[COLUMNS].astype(float)
    prices = out[["open", "high", "low", "close"]]
    if prices.isna().any().any():
        raise CandleError("Prices contain gaps (NaN)")
    if (prices <= 0).any().any():
        raise CandleError("Prices must be positive")
    if (out["high"] < prices.max(axis=1)).any() or (out["low"] > prices.min(axis=1)).any():
        raise CandleError("High must be the highest price and low the lowest in each candle")
    if (out["volume"] < 0).any():
        raise CandleError("Volume cannot be negative")
    return out


def session_dates(index: pd.DatetimeIndex) -> pd.Index:
    """The US trading date each candle belongs to."""
    return pd.Index(index.tz_convert(US_TZ).date, name="session")
