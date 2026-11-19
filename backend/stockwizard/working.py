"""Working an order's price (Ben, 19 Nov 2026): orders placed while he isn't watching should still fill
at a fair price.

An opening order starts at the midpoint of the bid and ask. Each cycle (about every 30 seconds) its
limit price is moved towards a worst price: the starting midpoint moved against us by 10% of the
structure's width (for a single call or put, 10% of its midpoint). It gets there after 30 minutes and
holds. At 55 minutes (9:35 to 10:30 New York for an order waiting for the open) an unfilled order is
cancelled and Ben is told the best price offered. When the market moves in our favour the price
follows the new midpoint; when it moves against us it never goes past the worst price.

Pure: no broker, no database. The bot applies it (bot.Bot.work) and checks every rail at each price.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime, timedelta

from stockwizard.rails import Leg

GIVE = 0.10                      # how far from the midpoint it may go: 10% of the width
TO_WORST = timedelta(minutes=30) # reaches the worst price after this long, then holds
WINDOW = timedelta(minutes=55)   # gives up after this long (9:35 → 10:30 New York)
TICK = 0.05


@dataclass(frozen=True)
class Plan:
    start: float          # the midpoint it started at, per share
    worst: float          # never past this
    began: datetime
    until: datetime


def width(legs: tuple[Leg, ...]) -> float:
    """The widest gap between strikes of one kind (puts or calls): a spread's or a condor's wing width. 0 for a single option."""
    out = 0.0
    for right in ("P", "C"):
        strikes = [l.strike for l in legs if l.right == right]
        if len(strikes) > 1:
            out = max(out, max(strikes) - min(strikes))
    return out


def worst_price(mid: float, kind: str, legs: tuple[Leg, ...]) -> float:
    """The least credit (or the most debit) the rule allows from this midpoint, on a 5c tick."""
    w = width(legs)
    give = GIVE * (w if w > 0 else mid)
    if kind == "credit":
        return round(max(TICK, math.ceil(round((mid - give) / TICK, 6)) * TICK), 2)
    return round(math.floor(round((mid + give) / TICK, 6)) * TICK, 2)


def plan(mid: float, kind: str, legs: tuple[Leg, ...], now: datetime) -> Plan:
    return Plan(start=mid, worst=worst_price(mid, kind, legs), began=now, until=now + WINDOW)


def price_now(p: Plan, kind: str, now: datetime, mid_now: float | None = None) -> float:
    """Where the limit should be now: from the midpoint (today's, if known) towards the worst price, on a 5c tick, never past it."""
    frac = min(1.0, max(0.0, (now - p.began) / TO_WORST))
    mid = p.start if mid_now is None else mid_now
    give = abs(p.start - p.worst)
    if kind == "credit":
        raw = mid - frac * give
        return round(max(p.worst, math.ceil(round(raw / TICK, 6)) * TICK), 2)
    raw = mid + frac * give
    return round(min(p.worst, math.floor(round(raw / TICK, 6)) * TICK), 2)


def expired(p: Plan, now: datetime) -> bool:
    return now >= p.until
