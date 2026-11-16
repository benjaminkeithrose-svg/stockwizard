"""The indicator library and its registry.

The registry is the one list of indicators the app, the scanner and the
backtester may use. Each entry has a version: bump it whenever the maths
changes, so saved runs record exactly which code produced their numbers
(`indicator_defs.code_version` in the database).
"""

from __future__ import annotations

import inspect
from dataclasses import dataclass, field
from typing import Callable

import pandas as pd

from stockwizard.candles import check_timeframe, validate
from stockwizard.indicators import core


@dataclass(frozen=True)
class Indicator:
    name: str
    func: Callable[..., pd.DataFrame]
    group: str
    version: int
    defaults: dict = field(default_factory=dict)
    intraday_only: bool = False

    @property
    def code_version(self) -> str:
        return f"{self.name}@{self.version}"


REGISTRY: dict[str, Indicator] = {
    i.name: i
    for i in [
        Indicator("sma", core.sma, "trend", 1, {"length": 200}),
        Indicator("ema", core.ema, "trend", 1, {"length": 21}),
        Indicator("macd", core.macd, "trend", 1, {"fast": 12, "slow": 26, "signal": 9}),
        Indicator("atr", core.atr, "volatility", 1, {"length": 14}),
        Indicator("bollinger", core.bollinger, "volatility", 1, {"length": 20, "mult": 2.0}),
        Indicator("keltner", core.keltner, "volatility", 1, {"length": 20, "atr_length": 10, "mult": 2.0}),
        Indicator("squeeze", core.squeeze, "volatility", 1, {"length": 20, "bb_mult": 2.0, "kc_mult": 1.5}),
        Indicator("rsi", core.rsi, "momentum", 1, {"length": 14}),
        Indicator("vwap", core.vwap, "volume", 1, {}, intraday_only=True),
        Indicator("anchored_vwap", core.anchored_vwap, "volume", 1, {"anchor": None}),
        Indicator("opening_range", core.opening_range, "levels", 1, {"minutes": 30}, intraday_only=True),
        Indicator("prior_day", core.prior_day, "levels", 1, {}),
    ]
}


def compute(name: str, candles: pd.DataFrame, timeframe: str, **params) -> pd.DataFrame:
    """Run one registered indicator on validated candles."""
    try:
        ind = REGISTRY[name]
    except KeyError:
        raise KeyError(f"No indicator called {name!r}") from None
    check_timeframe(timeframe)
    args = {**ind.defaults, **params}
    if any(v is None for v in args.values()):
        missing = [k for k, v in args.items() if v is None]
        raise TypeError(f"{name} needs {', '.join(missing)}")
    if "timeframe" in inspect.signature(ind.func).parameters:
        args["timeframe"] = timeframe
    return ind.func(validate(candles), **args)
