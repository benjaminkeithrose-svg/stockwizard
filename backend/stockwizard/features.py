"""Measures of market conditions for the pattern lab, one row per SPY trading day.

Every value is known at that day's close, from that day and earlier ones
only, so a pattern built from them can be traded the next morning.
tests/test_features.py proves it with the truncation test.

Cross-symbol inputs (the VIX, the 3-month VIX) are matched to SPY by date;
each is that symbol's own close on the same day, also known at the close.

Since 19 Nov 2026 (Ben: traditional patterns and linked symbols) the measures also include
SPY's candlestick and chart patterns (stockwizard/patterns.py), and for each linked symbol
(QQQ, IWM, NVIDIA, Apple, Tesla) its own moves, RSI and trend, a few of its patterns, and how
it moves with SPY: the 20-day correlation of daily moves, its 5-day move against SPY's
(relative strength), and today's move (whether it leads SPY's next days). A symbol with no
candles for a day simply has no reading that day.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from stockwizard.candles import session_dates, validate
from stockwizard.indicators import core
from stockwizard.patterns import PATTERNS, detect
from stockwizard.scans import rsi_divergence

#: Symbols whose behaviour may say something about SPY's, and how they read.
LINKED: dict[str, str] = {"QQQ": "QQQ", "IWM": "IWM", "NVDA": "NVIDIA", "AAPL": "Apple", "TSLA": "Tesla"}
#: The patterns looked for on each linked symbol (all of them on SPY).
LINKED_PATTERNS = ("bull_flag", "bear_flag", "breakout_20", "breakdown_20", "bull_engulf", "bear_engulf")


@dataclass(frozen=True)
class Feature:
    name: str
    kind: str          # "number" or "flag"
    low: str           # how a low reading reads, with {v} for the value
    high: str          # how a high reading reads
    unit: str = ""


FEATURES: dict[str, Feature] = {
    f.name: f
    for f in [
        Feature("spy_ret_5", "number", "SPY down {v}% or more over 5 days", "SPY up {v}% or more over 5 days", "%"),
        Feature("spy_ret_10", "number", "SPY down {v}% or more over 10 days", "SPY up {v}% or more over 10 days", "%"),
        Feature("spy_vs_sma50", "number", "SPY {v}% or more below its 50-day average", "SPY {v}% or more above its 50-day average", "%"),
        Feature("spy_vs_sma200", "number", "SPY {v}% or more below its 200-day average", "SPY {v}% or more above its 200-day average", "%"),
        Feature("spy_dd_20", "number", "SPY {v}% or more below its 20-day high", "SPY within {v}% of its 20-day high", "%"),
        Feature("spy_dd_60", "number", "SPY {v}% or more below its 60-day high", "SPY within {v}% of its 60-day high", "%"),
        Feature("spy_rsi", "number", "SPY RSI(14) at or below {v}", "SPY RSI(14) at or above {v}"),
        Feature("spy_pctb", "number", "SPY at or below {v} on its Bollinger %B", "SPY at or above {v} on its Bollinger %B"),
        Feature("spy_bandwidth", "number", "SPY Bollinger width at or below {v}%", "SPY Bollinger width at or above {v}%", "%"),
        Feature("spy_atr_pct", "number", "SPY daily range (ATR) at or below {v}% of price", "SPY daily range (ATR) at or above {v}% of price", "%"),
        Feature("spy_down_days", "number", "SPY down {v} days in a row or fewer", "SPY down {v} days in a row or more"),
        Feature("spy_momentum", "number", "SPY squeeze momentum at or below {v}% of price", "SPY squeeze momentum at or above {v}% of price", "%"),
        Feature("spy_volume_ratio", "number", "SPY volume at or below {v}× its 20-day average", "SPY volume at or above {v}× its 20-day average", "×"),
        Feature("spy_squeeze_on", "flag", "", "SPY squeeze on"),
        Feature("spy_squeeze_fired", "flag", "", "SPY squeeze just fired"),
        Feature("spy_rsi_divergence", "flag", "", "SPY new high on weaker RSI"),
        Feature("vix_level", "number", "VIX at or below {v}", "VIX at or above {v}"),
        Feature("vix_ret_5", "number", "VIX down {v}% or more over 5 days", "VIX up {v}% or more over 5 days", "%"),
        Feature("vix_vs_sma20", "number", "VIX {v}% or more below its 20-day average", "VIX {v}% or more above its 20-day average", "%"),
        Feature("vix_pctb", "number", "VIX at or below {v} on its Bollinger %B", "VIX at or above {v} on its Bollinger %B"),
        Feature("vix_term", "number", "VIX at or below {v}× the 3-month VIX (calm curve)", "VIX at or above {v}× the 3-month VIX (stressed curve)", "×"),
        *[Feature(f"spy_{k}", "flag", "", f"SPY {label}") for k, label in PATTERNS.items()],
        *[f for sym, name in LINKED.items() for f in (
            Feature(f"{sym.lower()}_ret_1", "number", f"{name} down {{v}}% or more today", f"{name} up {{v}}% or more today", "%"),
            Feature(f"{sym.lower()}_ret_5", "number", f"{name} down {{v}}% or more over 5 days", f"{name} up {{v}}% or more over 5 days", "%"),
            Feature(f"{sym.lower()}_rel_5", "number", f"{name} behind SPY by {{v}} points or more over 5 days",
                    f"{name} ahead of SPY by {{v}} points or more over 5 days", " points"),
            Feature(f"{sym.lower()}_corr_20", "number", f"{name} and SPY moving together at or below {{v}} (20-day correlation)",
                    f"{name} and SPY moving together at or above {{v}} (20-day correlation)"),
            Feature(f"{sym.lower()}_rsi", "number", f"{name} RSI(14) at or below {{v}}", f"{name} RSI(14) at or above {{v}}"),
            Feature(f"{sym.lower()}_vs_sma50", "number", f"{name} {{v}}% or more below its 50-day average",
                    f"{name} {{v}}% or more above its 50-day average", "%"),
            *[Feature(f"{sym.lower()}_{k}", "flag", "", f"{name} {PATTERNS[k]}") for k in LINKED_PATTERNS],
        )],
    ]
}


def _on(series: pd.Series, index: pd.DatetimeIndex) -> pd.Series:
    """Another symbol's daily values on SPY's dates: matched by US trading date, never carried from another day.

    Daily candles from the source are stamped at midnight in each exchange's own time zone (SPY New York,
    the VIX Chicago), an hour apart, so matching on the exact time would find nothing.
    """
    by_date = pd.Series(series.to_numpy(), index=session_dates(series.index))
    by_date = by_date[~by_date.index.duplicated(keep="last")]
    return pd.Series(by_date.reindex(session_dates(index)).to_numpy(), index=index)


def build(spy: pd.DataFrame, vix: pd.DataFrame, vix3m: pd.DataFrame | None = None,
          linked: dict[str, pd.DataFrame] | None = None) -> pd.DataFrame:
    spy, vix = validate(spy), validate(vix)
    c = spy["close"]
    out = pd.DataFrame(index=spy.index)
    out["spy_ret_5"] = (c / c.shift(5) - 1) * 100
    out["spy_ret_10"] = (c / c.shift(10) - 1) * 100
    out["spy_vs_sma50"] = (c / core.sma(spy, 50)["sma"] - 1) * 100
    out["spy_vs_sma200"] = (c / core.sma(spy, 200)["sma"] - 1) * 100
    out["spy_dd_20"] = (c / c.rolling(20, min_periods=20).max() - 1) * 100
    out["spy_dd_60"] = (c / c.rolling(60, min_periods=60).max() - 1) * 100
    out["spy_rsi"] = core.rsi(spy, 14)["rsi"]
    bb = core.bollinger(spy, 20, 2.0)
    out["spy_pctb"] = bb["percent_b"]
    out["spy_bandwidth"] = bb["bandwidth"] * 100
    out["spy_atr_pct"] = core.atr(spy, 14)["atr"] / c * 100
    down = (c < c.shift(1)).astype(int)
    out["spy_down_days"] = down.groupby((down != down.shift()).cumsum()).cumsum().where(down.astype(bool), 0).astype(float)
    out.loc[out.index[0], "spy_down_days"] = np.nan
    sq = core.squeeze(spy, 20, 2.0, 1.5)
    out["spy_momentum"] = sq["momentum"] / c * 100
    out["spy_volume_ratio"] = (spy["volume"] / spy["volume"].shift(1).rolling(20, min_periods=20).mean()).replace([np.inf, -np.inf], np.nan)
    out["spy_squeeze_on"] = sq["squeeze_on"].astype("Float64").astype(float)
    out["spy_squeeze_fired"] = sq["squeeze_fired"].astype("Float64").astype(float)
    out["spy_rsi_divergence"] = rsi_divergence(spy)["hit"].astype("Float64").astype(float)

    v = vix["close"]
    out["vix_level"] = _on(v, spy.index)
    out["vix_ret_5"] = _on((v / v.shift(5) - 1) * 100, spy.index)
    out["vix_vs_sma20"] = _on((v / core.sma(vix, 20)["sma"] - 1) * 100, spy.index)
    out["vix_pctb"] = _on(core.bollinger(vix, 20, 2.0)["percent_b"], spy.index)
    if vix3m is not None and len(vix3m):
        out["vix_term"] = _on(v, spy.index) / _on(validate(vix3m)["close"], spy.index)
    else:
        out["vix_term"] = np.nan

    pats = detect(spy)
    for k in PATTERNS:
        out[f"spy_{k}"] = pats[k].astype(float)

    spy_ret1 = c.pct_change()
    spy_ret5 = (c / c.shift(5) - 1) * 100
    for sym in LINKED:
        key = sym.lower()
        df = (linked or {}).get(sym)
        if df is None or not len(df):
            for col in ("ret_1", "ret_5", "rel_5", "corr_20", "rsi", "vs_sma50", *LINKED_PATTERNS):
                out[f"{key}_{col}"] = np.nan
            continue
        df = validate(df)
        lc = df["close"]
        out[f"{key}_ret_1"] = _on((lc / lc.shift(1) - 1) * 100, spy.index)
        ret5 = _on((lc / lc.shift(5) - 1) * 100, spy.index)
        out[f"{key}_ret_5"] = ret5
        out[f"{key}_rel_5"] = ret5 - spy_ret5
        # The 20-day correlation of daily moves, on the days both traded (matched to SPY's dates first).
        lr1 = _on(lc.pct_change(), spy.index)
        out[f"{key}_corr_20"] = spy_ret1.rolling(20, min_periods=20).corr(lr1)
        out[f"{key}_rsi"] = _on(core.rsi(df, 14)["rsi"], spy.index)
        out[f"{key}_vs_sma50"] = _on((lc / core.sma(df, 50)["sma"] - 1) * 100, spy.index)
        lp = detect(df)
        for k in LINKED_PATTERNS:
            out[f"{key}_{k}"] = _on(lp[k].astype(float), spy.index)
    return out.astype(float)


def spy_outcome(spy: pd.DataFrame, rise_pct: float, days: int, up: bool = True) -> pd.Series:
    """DISCOVERY ONLY: 1 if SPY's high (low) over the next `days` trading days reaches `rise_pct`% above (below) today's close.

    Looks ahead by design, like `outcome`; only for searching the discovery years.
    """
    s = validate(spy)
    if up:
        fut = s["high"][::-1].rolling(days, min_periods=days).max()[::-1].shift(-1)
        hit = (fut >= s["close"] * (1 + rise_pct / 100))
    else:
        fut = s["low"][::-1].rolling(days, min_periods=days).min()[::-1].shift(-1)
        hit = (fut <= s["close"] * (1 - rise_pct / 100))
    return hit.astype(float).where(fut.notna())


def outcome(vix: pd.DataFrame, index: pd.DatetimeIndex, rise_pct: float, days: int) -> pd.Series:
    """DISCOVERY ONLY: 1 if the VIX's high over the next `days` trading days reaches `rise_pct`% above today's close.

    This looks ahead by design (the question is about what comes next). It is
    used only to search the discovery years; the sealed years are judged by
    the blind backtester instead (stockwizard.lab).
    """
    v = validate(vix)
    fut_high = v["high"][::-1].rolling(days, min_periods=days).max()[::-1].shift(-1)
    hit = (fut_high >= v["close"] * (1 + rise_pct / 100)).astype(float).where(fut_high.notna())
    return _on(hit, index)
