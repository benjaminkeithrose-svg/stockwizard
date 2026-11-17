"""What the brief's entry framework reads at the moment of entry, from bars up to and including the last finished one.

Opening range: the high and low of the first 30 minutes. VWAP: the typical
price weighted by volume since the open. Direction at entry (Hypothesis B):
bullish when the price is above a rising VWAP and has broken above the opening
range; bearish the mirror image; otherwise neutral. Nothing here looks past
the entry time.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import time

import pandas as pd

OR_MINUTES = 30


@dataclass(frozen=True)
class Signals:
    or_high: float | None
    or_low: float | None
    vwap: float | None
    vwap_rising: bool | None
    price: float
    vwap_crossings: int
    inside_range: bool | None
    realised_vol: float | None       # annualised, from the bars so far today
    day_open: float | None = None
    range_distinct: bool = True      # False when the opening range is the only finished bar (hourly candles at 10:30)

    @property
    def direction(self) -> str:
        if self.vwap is None or self.or_high is None:
            return "neutral"
        if not self.range_distinct:
            # Hourly candles at 10:30: the opening range is the only finished candle, so a breakout can't be seen.
            # Stand-in: above VWAP and above the day's open is bullish; below both is bearish.
            if self.price > self.vwap and self.day_open is not None and self.price > self.day_open:
                return "bullish"
            if self.price < self.vwap and self.day_open is not None and self.price < self.day_open:
                return "bearish"
            return "neutral"
        if self.price > self.vwap and self.vwap_rising is not False and self.price > self.or_high:
            return "bullish"
        if self.price < self.vwap and self.vwap_rising is not True and self.price < self.or_low:
            return "bearish"
        return "neutral"


def at_entry(day: pd.DataFrame, entry: time, bar_minutes: int) -> Signals | None:
    """`day`: one session's bars (New York times, bar open times). Uses bars that finished by `entry`."""
    done = day[[(t + pd.Timedelta(minutes=bar_minutes)).time() <= entry for t in day.index]]
    if done.empty:
        return None
    price = float(done["close"].iloc[-1])
    or_bars = done[[(t - day.index[0]) < pd.Timedelta(minutes=OR_MINUTES) for t in done.index]]
    or_ready = (done.index[-1] - day.index[0]) >= pd.Timedelta(minutes=OR_MINUTES - bar_minutes)
    or_high = float(or_bars["high"].max()) if or_ready else None
    or_low = float(or_bars["low"].min()) if or_ready else None
    typical = (done["high"] + done["low"] + done["close"]) / 3
    vol = done["volume"].clip(lower=0)
    cum = (typical * vol).cumsum() / vol.cumsum().where(vol.cumsum() > 0)
    vwap = float(cum.iloc[-1]) if pd.notna(cum.iloc[-1]) else None
    rising = bool(cum.iloc[-1] > cum.iloc[-2]) if len(cum) >= 2 and pd.notna(cum.iloc[-2]) else None
    side = (done["close"] > cum).astype(int)
    crossings = int((side.diff().abs() == 1).sum())
    inside = (or_low <= price <= or_high) if or_ready else None
    rets = done["close"].pct_change().dropna()
    rv = float(rets.std() * (252 * 6.5 * 60 / bar_minutes) ** 0.5) if len(rets) >= 2 else None
    distinct = len(done) > len(or_bars)
    if not distinct:
        inside = None    # the price can't be outside a range it is part of
    return Signals(or_high, or_low, vwap, rising, price, crossings, inside, rv, float(day["open"].iloc[0]), distinct)


def session_type(day: pd.DataFrame, atr: float | None) -> str:
    """After the close (for grouping results only, never for entry): trending when the day moved most of its range one way."""
    rng = float(day["high"].max() - day["low"].min())
    move = abs(float(day["close"].iloc[-1] - day["open"].iloc[0]))
    if rng <= 0:
        return "range"
    if atr and rng > 1.5 * atr:
        return "high_volatility" if move / rng < 0.6 else "trending"
    return "trending" if move / rng >= 0.6 else "range"
