"""The phase 0 indicators.

Every function takes a validated candle frame (see stockwizard.candles) and
returns a DataFrame on the same index. Each value uses only that candle and
earlier ones, so it is known when that candle closes. Warm-up values, before an
indicator has enough history, are NaN. tests/test_truncation.py proves all of
this for every indicator in the registry.

Smoothing follows the common charting conventions so values can be compared
with other platforms: EMAs and Wilder averages are seeded with a simple
average of their first `length` values, and standard deviation is the
population form.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from stockwizard.candles import TIMEFRAMES, US_TZ, CandleError, check_timeframe, session_dates


# --- building blocks -------------------------------------------------------


def _seeded_ewm(values: pd.Series, alpha: float, length: int) -> pd.Series:
    """Exponential average seeded with the simple average of the first `length` values.

    Leading NaNs are skipped (e.g. the MACD line before it exists). A NaN after
    the seed is an error, because candles never have gaps once validated.
    """
    x = values.to_numpy(dtype=float)
    out = np.full(len(x), np.nan)
    valid = np.flatnonzero(~np.isnan(x))
    if len(valid) < length:
        return pd.Series(out, index=values.index)
    start = valid[0]
    if np.isnan(x[start:]).any():
        raise CandleError("Series has gaps after its first value")
    seed_at = start + length - 1
    prev = x[start : seed_at + 1].mean()
    out[seed_at] = prev
    for i in range(seed_at + 1, len(x)):
        prev = alpha * x[i] + (1 - alpha) * prev
        out[i] = prev
    return pd.Series(out, index=values.index)


def _ema(values: pd.Series, length: int) -> pd.Series:
    return _seeded_ewm(values, 2.0 / (length + 1), length)


def _rma(values: pd.Series, length: int) -> pd.Series:
    """Wilder's average, used by RSI and ATR."""
    return _seeded_ewm(values, 1.0 / length, length)


def _sma(values: pd.Series, length: int) -> pd.Series:
    return values.rolling(length, min_periods=length).mean()


def _stdev(values: pd.Series, length: int) -> pd.Series:
    return values.rolling(length, min_periods=length).std(ddof=0)


def _true_range(df: pd.DataFrame) -> pd.Series:
    prev_close = df["close"].shift(1)
    ranges = pd.concat(
        [df["high"] - df["low"], (df["high"] - prev_close).abs(), (df["low"] - prev_close).abs()],
        axis=1,
    )
    # The first candle has no previous close, so its true range is high - low.
    return ranges.max(axis=1, skipna=True)


def _linreg_end(values: pd.Series, length: int) -> pd.Series:
    """Least-squares line through the last `length` values, read at the newest one."""
    y = values.to_numpy(dtype=float)
    out = np.full(len(y), np.nan)
    if len(y) >= length:
        x = np.arange(length, dtype=float)
        xc = x - x.mean()
        weights = 1.0 / length + (length - 1 - x.mean()) * xc / (xc**2).sum()
        windows = np.lib.stride_tricks.sliding_window_view(y, length)
        out[length - 1 :] = windows @ weights
    return pd.Series(out, index=values.index)


def _clean(df: pd.DataFrame) -> pd.DataFrame:
    return df.replace([np.inf, -np.inf], np.nan)


# --- trend -----------------------------------------------------------------


def sma(df: pd.DataFrame, length: int = 200) -> pd.DataFrame:
    return pd.DataFrame({"sma": _sma(df["close"], length)})


def ema(df: pd.DataFrame, length: int = 21) -> pd.DataFrame:
    return pd.DataFrame({"ema": _ema(df["close"], length)})


def macd(df: pd.DataFrame, fast: int = 12, slow: int = 26, signal: int = 9) -> pd.DataFrame:
    line = _ema(df["close"], fast) - _ema(df["close"], slow)
    sig = _ema(line, signal)
    return pd.DataFrame({"macd": line, "signal": sig, "histogram": line - sig})


# --- volatility ------------------------------------------------------------


def atr(df: pd.DataFrame, length: int = 14) -> pd.DataFrame:
    return pd.DataFrame({"atr": _rma(_true_range(df), length)})


def bollinger(df: pd.DataFrame, length: int = 20, mult: float = 2.0) -> pd.DataFrame:
    mid = _sma(df["close"], length)
    dev = mult * _stdev(df["close"], length)
    upper, lower = mid + dev, mid - dev
    return _clean(
        pd.DataFrame(
            {
                "mid": mid,
                "upper": upper,
                "lower": lower,
                "percent_b": (df["close"] - lower) / (upper - lower),
                "bandwidth": (upper - lower) / mid,
            }
        )
    )


def keltner(df: pd.DataFrame, length: int = 20, atr_length: int = 10, mult: float = 2.0) -> pd.DataFrame:
    mid = _ema(df["close"], length)
    band = mult * _rma(_true_range(df), atr_length)
    return pd.DataFrame({"mid": mid, "upper": mid + band, "lower": mid - band})


def squeeze(
    df: pd.DataFrame,
    length: int = 20,
    bb_mult: float = 2.0,
    kc_mult: float = 1.5,
) -> pd.DataFrame:
    """Squeeze from the publicly described method.

    The squeeze is on while the Bollinger Bands sit inside the Keltner channel
    (both built on the simple average, the channel on the simple average of
    true range). Momentum is the linear-regression value of the close's
    distance from the midpoint of the recent range and its average.
    Not a copy of any vendor's proprietary indicator.
    """
    close = df["close"]
    basis = _sma(close, length)
    dev = bb_mult * _stdev(close, length)
    range_ma = _sma(_true_range(df), length)
    bb_upper, bb_lower = basis + dev, basis - dev
    kc_upper, kc_lower = basis + kc_mult * range_ma, basis - kc_mult * range_ma

    ready = bb_upper.notna() & kc_upper.notna()
    on = (bb_lower > kc_lower) & (bb_upper < kc_upper)
    prev_on = on.shift(1, fill_value=False) & ready.shift(1, fill_value=False)
    fired = ready & prev_on & ~on

    hh = df["high"].rolling(length, min_periods=length).max()
    ll = df["low"].rolling(length, min_periods=length).min()
    centre = ((hh + ll) / 2 + basis) / 2
    momentum = _linreg_end(close - centre, length)

    return pd.DataFrame(
        {
            "squeeze_on": on.astype("boolean").where(ready, pd.NA),
            "squeeze_fired": fired.astype("boolean").where(ready, pd.NA),
            "momentum": momentum,
            "momentum_rising": (momentum > momentum.shift(1))
            .astype("boolean")
            .where(momentum.notna() & momentum.shift(1).notna(), pd.NA),
        }
    )


# --- momentum --------------------------------------------------------------


def rsi(df: pd.DataFrame, length: int = 14) -> pd.DataFrame:
    change = df["close"].diff()
    gain = _rma(change.clip(lower=0), length)
    loss = _rma((-change).clip(lower=0), length)
    value = 100 - 100 / (1 + gain / loss)
    # No losses at all reads 100; no movement at all is undefined (NaN).
    value = value.where(loss != 0, 100.0).where(gain.notna() & ((gain != 0) | (loss != 0)))
    return pd.DataFrame({"rsi": value})


# --- volume and levels (intraday) -----------------------------------------


def _require_intraday(timeframe: str, name: str) -> pd.Timedelta:
    bar = check_timeframe(timeframe)
    if bar >= TIMEFRAMES["1d"]:
        raise CandleError(f"{name} needs intraday candles, not {timeframe}")
    return bar


def vwap(df: pd.DataFrame, timeframe: str) -> pd.DataFrame:
    """Volume-weighted average price, restarting each US session."""
    _require_intraday(timeframe, "VWAP")
    sess = session_dates(df.index)
    typical = (df["high"] + df["low"] + df["close"]) / 3
    pv = (typical * df["volume"]).groupby(sess.to_numpy()).cumsum()
    vol = df["volume"].groupby(sess.to_numpy()).cumsum()
    return _clean(pd.DataFrame({"vwap": pv / vol}))


def anchored_vwap(df: pd.DataFrame, anchor: str) -> pd.DataFrame:
    """VWAP from a chosen candle onwards. `anchor` is an ISO time in UTC."""
    start = pd.Timestamp(anchor)
    start = start.tz_localize("UTC") if start.tz is None else start.tz_convert("UTC")
    after = df.index >= start
    typical = (df["high"] + df["low"] + df["close"]) / 3
    pv = (typical * df["volume"]).where(after).cumsum()
    vol = df["volume"].where(after).cumsum()
    return _clean(pd.DataFrame({"anchored_vwap": (pv / vol).where(after)}))


def opening_range(df: pd.DataFrame, timeframe: str, minutes: int = 30) -> pd.DataFrame:
    """High and low of the first `minutes` of the US session (from 09:30 New York).

    Values appear on the candle that completes the range and hold for the rest
    of that session. A session missing any candle of the range gets no value.
    """
    bar = _require_intraday(timeframe, "Opening range")
    span = pd.Timedelta(minutes=minutes)
    if span % bar != pd.Timedelta(0) or span < bar:
        raise CandleError(f"Opening range of {minutes} minutes does not fit {timeframe} candles")
    expected = span // bar

    local = df.index.tz_convert(US_TZ)
    sess = session_dates(df.index).to_numpy()
    session_open = pd.DatetimeIndex(local.normalize() + pd.Timedelta(hours=9, minutes=30))
    in_range = (local >= session_open) & (local < session_open + span)
    complete_at = local + bar >= session_open + span

    high_in = df["high"].where(in_range)
    low_in = df["low"].where(in_range)
    or_high = high_in.groupby(sess).cummax().groupby(sess).ffill()
    or_low = low_in.groupby(sess).cummin().groupby(sess).ffill()
    count = pd.Series(in_range.astype(int), index=df.index).groupby(sess).cumsum()

    known = complete_at & (count.to_numpy() == expected)
    return pd.DataFrame({"or_high": or_high.where(known), "or_low": or_low.where(known)})


def prior_day(df: pd.DataFrame, timeframe: str) -> pd.DataFrame:
    """Previous session's high, low and close, and today's gap from that close."""
    check_timeframe(timeframe)
    sess = session_dates(df.index).to_numpy()
    by_day = df.groupby(sess).agg(
        high=("high", "max"), low=("low", "min"), close=("close", "last"), open=("open", "first")
    )
    prev = by_day[["high", "low", "close"]].shift(1)
    gap = by_day["open"] / prev["close"] - 1
    out = pd.DataFrame(
        {
            "prior_high": prev["high"].reindex(sess).to_numpy(),
            "prior_low": prev["low"].reindex(sess).to_numpy(),
            "prior_close": prev["close"].reindex(sess).to_numpy(),
            "gap": gap.reindex(sess).to_numpy(),
        },
        index=df.index,
    )
    return out
