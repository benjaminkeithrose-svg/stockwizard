"""Theoretical option prices for the bot, until Interactive Brokers supplies real quotes.

The same Black-Scholes as the app's analysis screen (web/src/data/pricing.ts):
European exercise, no dividends, a fixed 4% rate, time in calendar days to
16:00 New York on the expiry date. Volatility: the VIX for SPY, otherwise the
last 20 sessions' moves, otherwise 20%. Every price made here is labelled
theoretical wherever it is shown.
"""

from __future__ import annotations

import math
from datetime import date, datetime, time, timezone
from zoneinfo import ZoneInfo

from stockwizard.rails import Leg

RATE = 0.04
NY = ZoneInfo("America/New_York")
YEAR = 365 * 86400


def norm_cdf(x: float) -> float:
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def black_scholes(right: str, s: float, k: float, t: float, vol: float, r: float = RATE) -> float:
    """One option's price per share; `t` in years."""
    if t <= 0 or vol <= 0:
        return max(0.0, s - k) if right == "C" else max(0.0, k - s)
    sq = vol * math.sqrt(t)
    d1 = (math.log(s / k) + (r + vol * vol / 2) * t) / sq
    d2 = d1 - sq
    if right == "C":
        return s * norm_cdf(d1) - k * math.exp(-r * t) * norm_cdf(d2)
    return k * math.exp(-r * t) * norm_cdf(-d2) - s * norm_cdf(-d1)


def years_left(expiry: date, now: datetime) -> float:
    close = datetime.combine(expiry, time(16, 0), NY)
    return max(0.0, (close - now.astimezone(timezone.utc)).total_seconds() / YEAR)


def net_value(legs: tuple[Leg, ...], s: float, t: float, vol: float) -> float:
    """The legs' value per share of the structure: long legs plus, short legs minus."""
    return sum((1 if l.side == "buy" else -1) * l.qty * black_scholes(l.right, s, l.strike, t, vol) for l in legs)


def limit_price(legs: tuple[Leg, ...], s: float, t: float, vol: float, tick: float = 0.05) -> tuple[float, str]:
    """A limit price for opening the structure: (price per share, "credit" or "debit"), on the tick.

    A credit is rounded down and a debit up, so the theoretical limit never
    asks for more than the model says it is worth.
    """
    v = net_value(legs, s, t, vol)
    if v < 0:
        return max(tick, math.floor(-v / tick) * tick), "credit"
    return max(tick, math.ceil(v / tick) * tick), "debit"


def historical_vol(closes: list[float], days: int = 20) -> float | None:
    """Annualised volatility of the last `days` daily log returns."""
    if len(closes) < days + 1:
        return None
    window = closes[-days - 1 :]
    rets = [math.log(b / a) for a, b in zip(window, window[1:])]
    mean = sum(rets) / len(rets)
    var = sum((x - mean) ** 2 for x in rets) / (len(rets) - 1)
    return math.sqrt(var * 252)
