"""Backtests of option structures (iron condors, iron flies) on SPY, priced by model.

There is no option-price history yet, so every price is modelled: Black-Scholes
(stockwizard.pricing) with the VIX's previous close as the volatility. Only
daily candles go back far enough (20 years), which sets the two styles
(Ben, 18 Nov 2026):

- Same day ("0DTE"): open at the day's open, settle at that day's close.
  Placement and price use only what is known at the open: the previous
  close's VIX and ATR(14) of daily ranges, centred on the open.
- Multi-day: a signal (or every day) is judged at a day's close; the
  structure opens at the next day's open and expires at the close N trading
  days into the trade (N=1 is the entry day's close). Managed either to
  expiry, or closed at the first daily close showing half the credit.

Monthly (Ben, 18 Nov 2026): dte 21 (about 30 calendar days), credit
spreads (bull put, bear call), debit spreads (bull call, bear put), iron
condors and call and put condors (four strikes of one type, bought: a
debit), every day with no direction rule, each managed one way: held to
expiry, take 50% of the most it can make, close at 21 calendar days left, or
stop at twice the credit (credit structures). Every management check is at a
daily close.

Costs (Ben, 18 Nov 2026): $0.65 commission a contract per leg on opening
and on closing early (nothing at expiry), and 5 cents a leg slippage off the
modelled price each way. One position at a time. Settlement at expiry is the
intrinsic value at the close.

Caveats the app shows with every result: modelled prices (the VIX is an
at-the-money measure; real wings usually cost more), and same-day SPY
options only listed every weekday from 2022, so earlier 0DTE years are
hypothetical.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import date

import numpy as np
import pandas as pd

from stockwizard.backtest import _beta_binomial_range
from stockwizard.candles import session_dates
from stockwizard.pricing import black_scholes, net_value
from stockwizard.rails import Leg
from stockwizard.scans import evaluate

TRADING_DAYS = 252.0   # time is counted in trading sessions (see pricing.years_left)


@dataclass(frozen=True)
class OptionStrategy:
    structure: str = "iron_condor"          # see STRUCTURES
    dte: int = 0                             # 0 = same day; N = expires at the close N trading days into the trade
    short_atr: float = 1.0                   # condor shorts this many daily ranges either side
    wing: float = 5.0                        # dollars beyond the shorts
    manage: str = "expiry"                   # expiry, take_50, close_21 (21 calendar days left) or stop_2x (loss of twice the credit)
    commission: float = 0.65                 # per contract per leg, on opening and on closing early
    slippage: float = 0.05                   # per leg, each way
    signal_rule: str | None = None           # a scan rule on SPY's daily candles; None = every day
    signal_params: dict = field(default_factory=dict)
    vix_max: float | None = None             # only when the VIX closed at or below this (the day before entry)
    vix_min: float | None = None
    max_loss_cap: float | None = None        # skip a trade that could lose more than this, as the bot's per-trade rail would

    @classmethod
    def from_config(cls, cfg: dict) -> "OptionStrategy":
        return cls(**{k: v for k, v in cfg.items() if k in cls.__dataclass_fields__})

    def config(self) -> dict:
        return asdict(self)


STRUCTURES = ("iron_condor", "iron_fly", "bull_put", "bear_call", "bull_call_debit", "bear_put_debit", "call_condor", "put_condor")


def legs_for(structure: str, centre: float, atr: float, wing: float, short_atr: float = 1.0) -> tuple[Leg, ...]:
    """Strikes on $1 steps, as the chart places them. Shorts (or a condor's inner strikes) `short_atr` daily ranges from the
    price; debit spreads buy at the money; wings `wing` dollars further out."""
    at = round(centre)
    w = max(1, round(wing))
    r = max(1, round(atr * short_atr))
    if structure == "iron_fly":
        return (Leg("P", "buy", at - w), Leg("P", "sell", at), Leg("C", "sell", at), Leg("C", "buy", at + w))
    if structure == "iron_condor":
        return (Leg("P", "buy", at - r - w), Leg("P", "sell", at - r), Leg("C", "sell", at + r), Leg("C", "buy", at + r + w))
    if structure == "bull_put":
        return (Leg("P", "buy", at - r - w), Leg("P", "sell", at - r))
    if structure == "bear_call":
        return (Leg("C", "sell", at + r), Leg("C", "buy", at + r + w))
    if structure == "bull_call_debit":
        return (Leg("C", "buy", at), Leg("C", "sell", at + w))
    if structure == "bear_put_debit":
        return (Leg("P", "sell", at - w), Leg("P", "buy", at))
    if structure in ("call_condor", "put_condor"):
        k = "C" if structure == "call_condor" else "P"
        return (Leg(k, "buy", at - r - w), Leg(k, "sell", at - r), Leg(k, "sell", at + r), Leg(k, "buy", at + r + w))
    raise ValueError(f"Unknown structure {structure}")


def payoff_range(legs: tuple[Leg, ...], credit: float) -> tuple[float, float]:
    """(most it can make, most it can lose) per share at expiry, with `credit` received at the start (negative = paid)."""
    ks = sorted({l.strike for l in legs})
    points = [ks[0] - 1000, *ks, ks[-1] + 1000]
    vals = [credit + intrinsic(legs, x) for x in points]
    return max(vals), -min(vals)


def intrinsic(legs: tuple[Leg, ...], s: float) -> float:
    """Per share, long legs plus."""
    return sum((1 if l.side == "buy" else -1) * l.qty * (max(0.0, s - l.strike) if l.right == "C" else max(0.0, l.strike - s)) for l in legs)


def atr14(daily: pd.DataFrame) -> pd.Series:
    """Wilder's ATR(14) of daily candles (each value uses that day and earlier)."""
    prev = daily["close"].shift(1)
    tr = pd.concat([daily["high"] - daily["low"], (daily["high"] - prev).abs(), (daily["low"] - prev).abs()], axis=1).max(axis=1)
    tr.iloc[0] = daily["high"].iloc[0] - daily["low"].iloc[0]
    out = pd.Series(np.nan, index=daily.index)
    if len(tr) >= 14:
        a = tr.iloc[:14].mean()
        out.iloc[13] = a
        for i in range(14, len(tr)):
            a = (a * 13 + tr.iloc[i]) / 14
            out.iloc[i] = a
    return out


@dataclass
class OptionTrade:
    signal_day: date
    entry_day: date
    expiry_day: date
    exit_day: date
    spot_in: float
    spot_out: float
    legs: list
    vol: float
    credit: float          # per share received (negative = a debit paid), after slippage
    exit_cost: float       # per share paid to close (negative = received), after slippage when closed early
    pnl: float             # dollars for one structure, after commission
    max_loss: float        # dollars, the most it could have lost at entry
    exit_reason: str       # expiry, take_profit, days_left or stop

    def row(self) -> dict:
        d = asdict(self)
        for k in ("signal_day", "entry_day", "expiry_day", "exit_day"):
            d[k] = d[k].isoformat()
        return d


def _frame(df: pd.DataFrame) -> pd.DataFrame:
    out = df[["open", "high", "low", "close"]].copy()
    out.index = session_dates(df.index)
    return out[~out.index.duplicated(keep="last")]


def run(s: OptionStrategy, spy: pd.DataFrame, vix: pd.DataFrame, start: date) -> dict:
    """Every trade from `start` on, one position at a time, and what was skipped."""
    d = _frame(spy)
    v = _frame(vix)["close"].reindex(d.index)          # matched by trading date (the VIX is stamped an hour later)
    atr = atr14(d)
    if s.signal_rule:
        hit = evaluate(s.signal_rule, spy, **s.signal_params)["hit"]
        hit.index = session_dates(spy.index)
        hit = hit[~hit.index.duplicated(keep="last")].reindex(d.index).fillna(False).astype(bool)
    else:
        hit = pd.Series(True, index=d.index)
    days = list(d.index)
    trades: list[OptionTrade] = []
    skipped = {"already_in_trade": 0, "no_vix": 0, "filtered_out": 0, "not_enough_days": 0, "over_risk_limit": 0}
    busy_until = -1
    for i in range(1, len(days)):
        sig = i - 1                                    # judged at the previous close; enter today
        if days[i] < start or not hit.iloc[sig]:
            continue
        if i <= busy_until:
            skipped["already_in_trade"] += 1
            continue
        vix_prev, a = v.iloc[sig], atr.iloc[sig]
        if pd.isna(vix_prev) or pd.isna(a):
            skipped["no_vix"] += 1
            continue
        if (s.vix_max is not None and vix_prev > s.vix_max) or (s.vix_min is not None and vix_prev < s.vix_min):
            skipped["filtered_out"] += 1
            continue
        last = i + max(0, s.dte - 1)                   # the expiry day's index
        if last >= len(days):
            skipped["not_enough_days"] += 1
            continue
        vol = float(vix_prev) / 100
        spot = float(d["open"].iloc[i])
        legs = legs_for(s.structure, spot, float(a), s.wing, s.short_atr)
        n_legs = len(legs)
        cal_days = (days[last] - days[i]).days
        t0 = (last - i + 1) / TRADING_DAYS            # today's whole session plus each session to expiry
        value = net_value(legs, spot, t0, vol)         # per share, long plus: a credit structure is negative
        credit = -value - s.slippage * n_legs
        best, worst = payoff_range(legs, credit)
        max_loss = worst * 100 + s.commission * n_legs
        if s.max_loss_cap is not None and max_loss > s.max_loss_cap:
            skipped["over_risk_limit"] += 1
            continue
        exit_day, exit_cost, reason, spot_out = last, None, "expiry", float(d["close"].iloc[last])
        if s.manage != "expiry" and s.dte > 1:
            for j in range(i, last):                   # each daily close before the expiry day
                sj = float(d["close"].iloc[j])
                vj = v.iloc[j]
                tj = (last - j) / TRADING_DAYS            # from this close to the expiry close
                cost = -net_value(legs, sj, tj, float(vj) / 100 if not pd.isna(vj) else vol) + s.slippage * n_legs
                made = credit - cost                   # per share, if closed now
                if s.manage == "take_50" and best > 0 and made >= 0.5 * best:
                    exit_day, exit_cost, reason, spot_out = j, cost, "take_profit", sj
                    break
                if s.manage == "close_21" and (days[last] - days[j]).days <= 21:
                    exit_day, exit_cost, reason, spot_out = j, cost, "days_left", sj
                    break
                if s.manage == "stop_2x" and credit > 0 and -made >= 2 * credit:
                    exit_day, exit_cost, reason, spot_out = j, cost, "stop", sj
                    break
        if exit_cost is None:
            exit_cost = -intrinsic(legs, spot_out)     # what settling at expiry costs (positive = paid)
            commission = s.commission * n_legs
        else:
            commission = 2 * s.commission * n_legs
        pnl = round((credit - exit_cost) * 100 - commission, 2)
        trades.append(OptionTrade(days[sig], days[i], days[last], days[exit_day], spot, spot_out, [asdict(l) for l in legs], round(vol, 4),
                                  round(credit, 4), round(exit_cost, 4), pnl, round(max_loss, 2), reason))
        busy_until = exit_day
    return {"trades": trades, "skipped": skipped}


def metrics(trades: list[OptionTrade]) -> dict:
    pnl = [t.pnl for t in trades]
    n = len(pnl)
    wins = [p for p in pnl if p > 0]
    losses = [p for p in pnl if p <= 0]
    equity, peak, max_dd, streak, longest = 0.0, 0.0, 0.0, 0, 0
    for p in pnl:
        equity += p
        peak = max(peak, equity)
        max_dd = min(max_dd, equity - peak)
        streak = streak + 1 if p <= 0 else 0
        longest = max(longest, streak)
    lo, hi = _beta_binomial_range(len(wins), len(losses)) if n else (None, None)
    r = lambda x: None if x is None else round(float(x), 2)  # noqa: E731
    return {
        "trades": n,
        "wins": len(wins),
        "win_rate": r(len(wins) / n * 100) if n else None,
        "next_100_wins_low": lo,
        "next_100_wins_high": hi,
        "avg_win": r(np.mean(wins)) if wins else None,
        "avg_loss": r(np.mean(losses)) if losses else None,
        "expectancy": r(np.mean(pnl)) if n else None,
        "total_pnl": r(sum(pnl)) if n else None,
        "max_drawdown": r(max_dd) if n else None,
        "worst_trade": r(min(pnl)) if n else None,
        "profit_factor": r(sum(wins) / -sum(losses)) if losses and sum(losses) < 0 else None,
        "avg_return_on_risk": r(np.mean([t.pnl / t.max_loss * 100 for t in trades if t.max_loss > 0])) if n else None,
        "longest_losing_streak": longest,
        "take_profit_exits": sum(1 for t in trades if t.exit_reason == "take_profit"),
        "days_left_exits": sum(1 for t in trades if t.exit_reason == "days_left"),
        "stop_exits": sum(1 for t in trades if t.exit_reason == "stop"),
    }


def report(result: dict, split: date, s: OptionStrategy | None = None) -> dict:
    tr = result["trades"]
    build = metrics([t for t in tr if t.entry_day < split])
    held = metrics([t for t in tr if t.entry_day >= split])
    warn = ["Modelled prices: Black-Scholes with the VIX as volatility. Real wings usually cost more; check against real fills before trusting it."]
    if s is not None and s.dte == 0:
        warn.append("Same-day SPY options were only listed every weekday from 2022, so the 0DTE results before then are hypothetical.")
    if build["trades"] < 30 or held["trades"] < 30:
        warn.append("Few trades: the win-rate ranges are wide.")
    if build["win_rate"] is not None and held["win_rate"] is not None and held["trades"] >= 5 and held["win_rate"] > build["win_rate"] + 15:
        warn.append("The held-back win rate is far better than the build period's. The spec treats that as something to investigate, not a win.")
    return {"build": build, "held_back": held, "warnings": warn, "skipped": result["skipped"]}


__all__ = ["OptionStrategy", "OptionTrade", "black_scholes", "legs_for", "metrics", "report", "run"]
