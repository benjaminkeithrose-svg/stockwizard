"""One same-day trade a session, bar by bar (the brief's sections 5, 6 and 8).

Fills are never at the mid: opening sells at the bid and buys at the ask;
closing buys back at the ask and sells at the bid; plus any extra slippage per
leg; plus commission and exchange fees per contract per leg, each way. Exit
rules trigger on the mid (as a broker's would) and fill at the worse side.
Stops and breaches are checked against each bar's high and low (priced at
the bar's end, so a little pessimistic); profit targets only at bar closes.
At 16:00 a position settles at its intrinsic value (cash-settled; for SPY and
QQQ, early assignment isn't modelled). Everything at entry uses only bars
that had finished by then.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import date, datetime, time

import pandas as pd

from . import calendar, signals
from .instruments import INSTRUMENTS
from .quotes import QuoteSource
from .strategy import Config, legs_for, resolve

NY = "America/New_York"
CLOSE = time(16, 0)


@dataclass
class Trade:
    day: date
    structure: str
    entry_time: str
    exit_time: str
    exit_reason: str          # expiry, profit_target, stop, breach, delta, time
    spot_in: float
    spot_out: float
    legs: list
    credit: float             # per share at entry fills (negative for a debit)
    exit_cost: float          # per share to close (negative = received)
    fees: float               # dollars, both ways
    pnl: float                # dollars after everything
    max_loss: float           # dollars, the most it could lose at entry
    direction: str
    vix: float | None
    tags: list = field(default_factory=list)
    session: str = ""

    def row(self) -> dict:
        d = asdict(self)
        d["day"] = self.day.isoformat()
        return d


def _sign(side: str) -> int:
    return 1 if side == "buy" else -1


def _open_price(legs, chain, slip) -> float | None:
    """Per share paid to open (negative = credit received), at the natural side plus slippage."""
    total = 0.0
    for l in legs:
        q = chain.get((l.right, round(l.strike, 2)))
        if q is None:
            return None
        total += (q.ask + slip) if l.side == "buy" else -(q.bid - slip)
    return total


def _close_price(legs, chain, slip) -> float | None:
    """Per share paid to close (negative = received)."""
    total = 0.0
    for l in legs:
        q = chain.get((l.right, round(l.strike, 2)))
        if q is None:
            return None
        total += (q.ask + slip) if l.side == "sell" else -(q.bid - slip)
    return total


def _mid_value(legs, chain) -> float | None:
    """The position's mid value per share (long legs plus)."""
    total = 0.0
    for l in legs:
        q = chain.get((l.right, round(l.strike, 2)))
        if q is None:
            return None
        total += _sign(l.side) * q.mid
    return total


def _intrinsic(legs, s) -> float:
    return sum(_sign(l.side) * max(0.0, (s - l.strike) if l.right == "C" else (l.strike - s)) for l in legs)


def run(cfg: Config, bars: pd.DataFrame, bar_minutes: int, quotes: QuoteSource, vol_at, vix_prev, atr_prev,
        start: date, end: date | None = None) -> dict:
    """`bars`: the underlying's intraday bars (UTC index). `vol_at(ts)`: the volatility for pricing at a time.
    `vix_prev(day)` and `atr_prev(day)`: values known before the day opened."""
    inst = INSTRUMENTS[cfg.instrument]
    ny = bars.index.tz_convert(NY)
    frame = bars.copy()
    frame.index = ny
    trades: list[Trade] = []
    skipped: dict[str, int] = {}
    skip = lambda why: skipped.__setitem__(why, skipped.get(why, 0) + 1)  # noqa: E731
    entry_t, exit_at = cfg.entry_time(), cfg.exit_at()
    for d, day in frame.groupby(frame.index.date):
        if d < start or (end and d > end):
            continue
        last = day.index[-1]
        if day.index[0].time() != time(9, 30) or not (last.time() < CLOSE <= (last + pd.Timedelta(minutes=bar_minutes)).time()):
            skip("short_day")
            continue
        tg = calendar.tags(d)
        if any(t in cfg.skip_tags for t in tg):
            skip("skipped_day")
            continue
        vix = vix_prev(d)
        if vix is None:
            skip("no_vix")
            continue
        if (cfg.vix_min is not None and vix < cfg.vix_min) or (cfg.vix_max is not None and vix > cfg.vix_max):
            skip("vix_filter")
            continue
        sig = signals.at_entry(day, entry_t, bar_minutes)
        if sig is None:
            skip("entry_outside_bars")
            continue
        if cfg.require_inside_range and sig.inside_range is False:
            skip("outside_opening_range")
            continue
        structure = resolve(cfg, sig.direction)
        if structure is None:
            skip("no_setup")
            continue
        at = pd.Timestamp(datetime.combine(d, entry_t), tz=NY)
        spot = sig.price * inst.scale
        close_ts = pd.Timestamp(datetime.combine(d, CLOSE), tz=NY)
        vol = vol_at(at)
        if vol is None:
            skip("no_vol")
            continue
        chain = quotes.chain(inst, at.to_pydatetime(), spot, (close_ts - at).total_seconds(), vol)
        legs = legs_for(cfg, structure, chain, spot, inst.step) if chain else None
        if legs is None:
            skip("no_quotes")
            continue
        paid = _open_price(legs, chain, cfg.slippage)
        mid_open = _mid_value(legs, chain)
        n = len(legs)
        credit = -paid
        is_credit = credit > 0
        if is_credit and credit < cfg.min_credit:
            skip("credit_too_small")
            continue
        if not is_credit and structure not in ("bull_call_debit", "bear_put_debit"):
            skip("no_credit")
            continue
        if n == 4:
            widths = [abs(legs[1].strike - legs[0].strike), abs(legs[3].strike - legs[2].strike)]
        else:
            widths = [abs(legs[0].strike - legs[1].strike)]
        fees_open = inst.per_leg_cost * n
        only = [(l.right, l.strike) for l in legs]
        max_loss = ((max(widths) - credit) if is_credit else -credit) * 100 + 2 * fees_open
        reason, exit_cost, exit_ts, spot_out = "expiry", None, close_ts, None
        later = day[day.index >= at]
        for ts, bar in later.iterrows():
            end_ts = min(ts + pd.Timedelta(minutes=bar_minutes), close_ts)   # the last hourly candle is half an hour
            left = (close_ts - end_ts).total_seconds()
            if left <= 0:
                break
            v = vol_at(end_ts) or vol
            checks = []
            for px in (float(bar["high"]), float(bar["low"]), float(bar["close"])):
                s = px * inst.scale
                ch = quotes.chain(inst, end_ts.to_pydatetime(), s, left, v, only=only)
                mid = _mid_value(legs, ch) if ch else None
                if mid is None:
                    continue
                loss = mid_open - mid   # per share: how far the position's value has fallen since entry (positive = losing)
                shorts = [l for l in legs if l.side == "sell"]
                worst_delta = max((abs(ch[(l.right, round(l.strike, 2))].delta) for l in shorts), default=0.0)
                breached = any((s >= l.strike) if l.right == "C" else (s <= l.strike) for l in shorts)
                if is_credit and cfg.stop_mult is not None and loss >= cfg.stop_mult * credit:
                    checks.append(("stop", s, ch))
                elif cfg.stop_breach and breached:
                    checks.append(("breach", s, ch))
                elif cfg.stop_delta is not None and worst_delta >= cfg.stop_delta:
                    checks.append(("delta", s, ch))
                elif px == float(bar["close"]) and cfg.profit_target is not None and is_credit:
                    cost = _close_price(legs, ch, cfg.slippage)
                    if cost is not None and credit - cost >= cfg.profit_target * credit:
                        checks.append(("profit_target", s, ch))
            if checks:
                reason, s, ch = checks[0]
                exit_cost, exit_ts, spot_out = _close_price(legs, ch, cfg.slippage), end_ts, s
                break
            if exit_at is not None and end_ts.time() >= exit_at:
                ch = quotes.chain(inst, end_ts.to_pydatetime(), float(bar["close"]) * inst.scale, left, v, only=only)
                exit_cost = _close_price(legs, ch, cfg.slippage) if ch else None
                if exit_cost is not None:
                    reason, exit_ts, spot_out = "time", end_ts, float(bar["close"]) * inst.scale
                    break
        if exit_cost is None:
            spot_out = float(day["close"].iloc[-1]) * inst.scale
            exit_cost = -_intrinsic(legs, spot_out)
            fees = fees_open                       # nothing to pay at expiry
        else:
            fees = 2 * fees_open
        pnl = round((-paid - exit_cost) * 100 - fees, 2)   # what came in, less what it cost to close, less fees
        trades.append(Trade(d, structure, entry_t.strftime("%H:%M"), exit_ts.strftime("%H:%M"), reason, round(spot, 4), round(spot_out, 4),
                            [asdict(l) for l in legs], round(credit, 4), round(exit_cost, 4), round(fees, 2), pnl, round(max_loss, 2),
                            sig.direction, vix, tg, signals.session_type(day, atr_prev(d))))
    return {"trades": trades, "skipped": skipped}
