"""Option chains for the engine: a bid and ask, implied volatility and delta for each strike.

QuoteSource is the one thing the engine asks for prices. ModelQuotes builds a
chain from the underlying's price and a volatility (Black-Scholes, time in
trading hours), with put skew and a bid-ask spread from the instrument's
estimates, so the engine can be built and checked before real data exists.
RecordedQuotes reads real quotes (the bot's option_quotes table, or a bought
history in the same shape) and is used whenever it has them.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime
from typing import Protocol

from stockwizard.pricing import RATE, norm_cdf

from .instruments import Instrument

TRADING_YEAR = 252 * 6.5 * 3600


@dataclass(frozen=True)
class OptionQuote:
    right: str
    strike: float
    bid: float
    ask: float
    iv: float
    delta: float

    @property
    def mid(self) -> float:
        return (self.bid + self.ask) / 2


def bs(right: str, s: float, k: float, t: float, vol: float) -> tuple[float, float]:
    """(price, delta) per share."""
    if t <= 0 or vol <= 0:
        itm = s > k if right == "C" else s < k
        return max(0.0, s - k if right == "C" else k - s), (1.0 if right == "C" else -1.0) if itm else 0.0
    sq = vol * math.sqrt(t)
    d1 = (math.log(s / k) + (RATE + vol * vol / 2) * t) / sq
    d2 = d1 - sq
    if right == "C":
        return s * norm_cdf(d1) - k * math.exp(-RATE * t) * norm_cdf(d2), norm_cdf(d1)
    return k * math.exp(-RATE * t) * norm_cdf(-d2) - s * norm_cdf(-d1), norm_cdf(d1) - 1


class QuoteSource(Protocol):
    def chain(self, inst: Instrument, at: datetime, spot: float, seconds_left: float, vol: float,
              only: list[tuple[str, float]] | None = None) -> dict[tuple[str, float], OptionQuote]:
        """Every strike near the money for the same-day expiry at time `at` (or just the `only` ones)."""


class ModelQuotes:
    """Black-Scholes quotes with put skew and an estimated bid-ask spread. A model: never evidence."""

    def __init__(self, skew: float = 1.5, width: float = 0.04):
        self.skew = skew      # volatility points added per 1% a strike sits below the price (puts dearer, as in real markets)
        self.width = width    # how far either side of the price to list strikes, as a share of the price

    def _quote(self, inst, r, k, spot, t, vol) -> OptionQuote:
        below = max(0.0, (spot - k) / spot * 100)             # how many % the strike sits below the price
        iv = max(0.02, vol + self.skew / 100 * below)
        price, delta = bs(r, spot, k, t, iv)
        half = max(inst.min_half_spread, inst.spread_pct * price)
        bid = max(0.0, math.floor((price - half) / inst.tick + 1e-9) * inst.tick)
        ask = math.ceil((price + half) / inst.tick - 1e-9) * inst.tick
        return OptionQuote(r, round(k, 2), round(bid, 4), round(max(ask, inst.tick), 4), iv, delta)

    def chain(self, inst, at, spot, seconds_left, vol, only=None):
        t = max(seconds_left, 0) / TRADING_YEAR
        if only is not None:
            return {(r, round(k, 2)): self._quote(inst, r, k, spot, t, vol) for r, k in only}
        lo = math.floor(spot * (1 - self.width) / inst.step) * inst.step
        hi = math.ceil(spot * (1 + self.width) / inst.step) * inst.step
        out = {}
        k = lo
        while k <= hi + 1e-9:
            for r in ("C", "P"):
                out[(r, round(k, 2))] = self._quote(inst, r, k, spot, t, vol)
            k = round(k + inst.step, 6)
        return out


class RecordedQuotes:
    """Real quotes: rows shaped like option_quotes (taken_at, strike, right, bid, ask, iv), nearest snapshot at or before `at`."""

    def __init__(self, rows: list[dict], max_age_seconds: int = 1800):
        self.by_time: dict[datetime, list[dict]] = {}
        for r in rows:
            self.by_time.setdefault(r["taken_at"], []).append(r)
        self.times = sorted(self.by_time)
        self.max_age = max_age_seconds

    def chain(self, inst, at, spot, seconds_left, vol, only=None):
        import bisect  # noqa: PLC0415
        i = bisect.bisect_right(self.times, at) - 1
        if i < 0 or (at - self.times[i]).total_seconds() > self.max_age:
            return {}
        t = max(seconds_left, 0) / TRADING_YEAR
        out = {}
        for r in self.by_time[self.times[i]]:
            if r.get("bid") is None or r.get("ask") is None:
                continue
            iv = r.get("iv") or vol
            _, delta = bs(r["right"], spot, float(r["strike"]), t, iv)
            out[(r["right"], round(float(r["strike"]), 2))] = OptionQuote(r["right"], float(r["strike"]), float(r["bid"]), float(r["ask"]), iv, delta)
        if only is not None:
            out = {k: q for k, q in out.items() if k in {(r, round(x, 2)) for r, x in only}}
        return out
