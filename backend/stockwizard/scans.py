"""Scan rules.

Each rule turns a candle frame into a signal for EVERY candle, using only
that candle and earlier ones, so a rule can be judged by the same truncation
test as the indicators (tests/test_scans.py) and reused by the backtester. The
scanner reads the last row.

Every rule returns a DataFrame on the candles' index with:
    hit        True where the rule fires, False where it doesn't, NA while warming up
    direction  "up" / "down" where it fires
    ...        the numbers worth showing next to the result

The default settings are common charting starting points, not tested edges
(Ben, 16 Nov 2026). The backtester is what decides whether they hold.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable

import numpy as np
import pandas as pd

from stockwizard.candles import validate
from stockwizard.indicators import core


def _bool(series: pd.Series, ready: pd.Series) -> pd.Series:
    return series.astype("boolean").where(ready, pd.NA)


def _direction(hit: pd.Series, up: pd.Series) -> pd.Series:
    out = pd.Series(pd.NA, index=hit.index, dtype="object")
    fired = hit.fillna(False).astype(bool)
    out[fired & up] = "up"
    out[fired & ~up] = "down"
    return out


def squeeze_on(df: pd.DataFrame, length: int = 20, bb_mult: float = 2.0, kc_mult: float = 1.5) -> pd.DataFrame:
    """The squeeze is on as of this candle. Shows how many candles in a row it has been on."""
    sq = core.squeeze(df, length, bb_mult, kc_mult)
    on = sq["squeeze_on"]
    run = on.fillna(False).astype(int)
    streak = run.groupby((run != run.shift()).cumsum()).cumsum().where(run.astype(bool), 0)
    return pd.DataFrame(
        {
            "hit": on,
            "direction": _direction(on, sq["momentum"] >= 0),
            "candles_on": streak.astype(float).where(on.notna()),
            "momentum": sq["momentum"],
        }
    )


def squeeze_fired(df: pd.DataFrame, length: int = 20, bb_mult: float = 2.0, kc_mult: float = 1.5) -> pd.DataFrame:
    """The squeeze turned off on this candle. Direction from the momentum histogram."""
    sq = core.squeeze(df, length, bb_mult, kc_mult)
    fired = sq["squeeze_fired"]
    return pd.DataFrame(
        {"hit": fired, "direction": _direction(fired, sq["momentum"] >= 0), "momentum": sq["momentum"]}
    )


def breakout(df: pd.DataFrame, length: int = 20, volume_mult: float = 0.0) -> pd.DataFrame:
    """Close above the highest high of the previous `length` candles (up), or below their lowest low (down).

    volume_mult > 0 also needs volume at least that many times its previous `length`-candle average.
    """
    prior_high = df["high"].shift(1).rolling(length, min_periods=length).max()
    prior_low = df["low"].shift(1).rolling(length, min_periods=length).min()
    avg_vol = df["volume"].shift(1).rolling(length, min_periods=length).mean()
    vol_ratio = (df["volume"] / avg_vol).replace([np.inf, -np.inf], np.nan)
    up = df["close"] > prior_high
    down = df["close"] < prior_low
    ready = prior_high.notna()
    hit = up | down
    if volume_mult > 0:
        hit = hit & (vol_ratio >= volume_mult)
        ready = ready & vol_ratio.notna()
    return pd.DataFrame(
        {
            "hit": _bool(hit, ready),
            "direction": _direction(_bool(hit, ready), up),
            "level": prior_high.where(up, prior_low),
            "volume_ratio": vol_ratio,
        }
    )


def trend_break(df: pd.DataFrame, length: int = 50) -> pd.DataFrame:
    """Close below the `length`-candle simple average after closing at or above it the candle before."""
    avg = core.sma(df, length)["sma"]
    below = df["close"] < avg
    was_above = df["close"].shift(1) >= avg.shift(1)
    ready = avg.notna() & avg.shift(1).notna()
    hit = _bool(below & was_above, ready)
    return pd.DataFrame(
        {
            "hit": hit,
            "direction": _direction(hit, pd.Series(False, index=df.index)),
            "average": avg,
            "below_by_pct": (df["close"] / avg - 1) * 100,
        }
    )


def drawdown(df: pd.DataFrame, lookback: int = 60, pct: float = 5.0) -> pd.DataFrame:
    """Close `pct`% or more below the highest close of the last `lookback` candles (this one included).

    first_day is 1 on the first candle of a run, so a new fall can be told from an old one.
    """
    peak = df["close"].rolling(lookback, min_periods=lookback).max()
    dd = (df["close"] / peak - 1) * 100
    ready = peak.notna()
    cond = dd <= -pct
    hit = _bool(cond, ready)
    first = cond & ~cond.shift(1, fill_value=False)
    return pd.DataFrame(
        {
            "hit": hit,
            "direction": _direction(hit, pd.Series(False, index=df.index)),
            "drawdown_pct": dd,
            "first_day": first.astype(float).where(ready),
        }
    )


def rsi_divergence(
    df: pd.DataFrame, high_lookback: int = 20, rsi_length: int = 14, window: int = 60, gap: int = 5, min_drop: float = 2.0
) -> pd.DataFrame:
    """A new `high_lookback`-candle closing high while RSI is weaker than at an earlier one.

    The earlier high is the strongest-RSI new high in the previous `window` candles, at least `gap`
    candles back (so a run of consecutive highs isn't compared with itself). It fires when this
    candle's RSI is at least `min_drop` points below that one.
    """
    close = df["close"]
    rsi = core.rsi(df, rsi_length)["rsi"]
    new_high = close >= close.rolling(high_lookback, min_periods=high_lookback).max()
    rsi_at_highs = rsi.where(new_high)
    earlier = rsi_at_highs.shift(gap).rolling(window - gap, min_periods=1).max()
    ready = rsi.notna() & close.rolling(high_lookback, min_periods=high_lookback).max().notna()
    cond = new_high & earlier.notna() & (rsi <= earlier - min_drop)
    hit = _bool(cond, ready)
    return pd.DataFrame(
        {
            "hit": hit,
            "direction": _direction(hit, pd.Series(False, index=df.index)),
            "rsi": rsi,
            "earlier_rsi": earlier,
        }
    )


@dataclass(frozen=True)
class Rule:
    name: str
    func: Callable[..., pd.DataFrame]
    version: int
    defaults: dict = field(default_factory=dict)

    @property
    def code_version(self) -> str:
        return f"{self.name}@{self.version}"


RULES: dict[str, Rule] = {
    r.name: r
    for r in [
        Rule("squeeze_on", squeeze_on, 1, {"length": 20, "bb_mult": 2.0, "kc_mult": 1.5}),
        Rule("squeeze_fired", squeeze_fired, 1, {"length": 20, "bb_mult": 2.0, "kc_mult": 1.5}),
        Rule("breakout", breakout, 1, {"length": 20, "volume_mult": 0.0}),
        Rule("trend_break", trend_break, 1, {"length": 50}),
        Rule("drawdown", drawdown, 1, {"lookback": 60, "pct": 5.0}),
        Rule("rsi_divergence", rsi_divergence, 1, {"high_lookback": 20, "rsi_length": 14, "window": 60, "gap": 5, "min_drop": 2.0}),
    ]
}


def evaluate(rule: str, candles: pd.DataFrame, **params) -> pd.DataFrame:
    r = RULES[rule]
    return r.func(validate(candles), **{**r.defaults, **params})
