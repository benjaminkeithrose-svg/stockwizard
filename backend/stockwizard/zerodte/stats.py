"""The statistics the brief asks for (section 9), by period and by market regime (section 10).

Returns are per trade on the risk taken (profit or loss ÷ the most it could
lose). Sharpe and Sortino treat each trading day as one period (a day with
no trade counts as zero), annualised over 252 days. A win rate alone never
ranks a strategy.
"""

from __future__ import annotations

import math
from collections import defaultdict

import numpy as np

from .engine import Trade


def _r(x, d=2):
    return None if x is None or (isinstance(x, float) and (math.isnan(x) or math.isinf(x))) else round(float(x), d)


def summary(trades: list[Trade], days_in_period: int | None = None) -> dict:
    pnl = np.array([t.pnl for t in trades], dtype=float)
    n = len(pnl)
    if n == 0:
        return {"trades": 0}
    wins, losses = pnl[pnl > 0], pnl[pnl <= 0]
    equity = np.cumsum(pnl)
    peak = np.maximum.accumulate(np.concatenate([[0.0], equity]))[1:]
    max_dd = float(np.min(equity - peak)) if n else 0.0
    streak = longest = 0
    for p in pnl:
        streak = streak + 1 if p <= 0 else 0
        longest = max(longest, streak)
    ror = np.array([t.pnl / t.max_loss for t in trades if t.max_loss > 0])
    days = max(days_in_period or n, n)
    daily = np.concatenate([ror, np.zeros(days - len(ror))]) if len(ror) else np.zeros(days)
    sd = daily.std(ddof=1) if len(daily) > 1 else 0.0
    down = daily[daily < 0]
    dsd = math.sqrt((down ** 2).sum() / len(daily)) if len(daily) else 0.0
    months = defaultdict(float)
    for t in trades:
        months[t.day.strftime("%Y-%m")] += t.pnl
    # A one-sided test that the average trade is above zero (for the false-discovery check across the matrix).
    t_stat = float(pnl.mean() / (pnl.std(ddof=1) / math.sqrt(n))) if n > 2 and pnl.std(ddof=1) > 0 else 0.0
    p_value = 0.5 * math.erfc(t_stat / math.sqrt(2))
    return {
        "trades": n,
        "win_rate": _r(len(wins) / n * 100, 1),
        "avg_win": _r(wins.mean()) if len(wins) else None,
        "avg_loss": _r(losses.mean()) if len(losses) else None,
        "expectancy": _r(pnl.mean()),
        "avg_return_on_risk_pct": _r(ror.mean() * 100) if len(ror) else None,
        "profit_factor": _r(wins.sum() / -losses.sum()) if len(losses) and losses.sum() < 0 else None,
        "total": _r(pnl.sum()),
        "max_drawdown": _r(max_dd),
        "largest_loss": _r(pnl.min()),
        "max_consecutive_losses": longest,
        "sharpe": _r(daily.mean() / sd * math.sqrt(252)) if sd > 0 else None,
        "sortino": _r(daily.mean() / dsd * math.sqrt(252)) if dsd > 0 else None,
        "recovery_factor": _r(pnl.sum() / -max_dd) if max_dd < 0 else None,
        "months": len(months),
        "months_positive_pct": _r(sum(1 for v in months.values() if v > 0) / len(months) * 100, 0),
        "avg_daily": _r(pnl.sum() / days),
        "t_stat": _r(t_stat),
        "p_value": _r(p_value, 4),
        "exits": {k: sum(1 for t in trades if t.exit_reason == k) for k in sorted({t.exit_reason for t in trades})},
        "worst_5_share_of_losses_pct": _r(np.sort(losses)[:5].sum() / losses.sum() * 100, 0) if len(losses) and losses.sum() < 0 else None,
    }


def vix_regime(v: float | None) -> str:
    if v is None:
        return "unknown"
    return "vix_under_15" if v < 15 else "vix_15_20" if v < 20 else "vix_20_30" if v < 30 else "vix_over_30"


def by_regime(trades: list[Trade]) -> dict:
    groups: dict[str, list[Trade]] = defaultdict(list)
    for t in trades:
        groups[vix_regime(t.vix)].append(t)
        groups[f"session_{t.session}"].append(t)
        for tag in t.tags:
            groups[tag].append(t)
        groups[f"direction_{t.direction}"].append(t)
    keep = ("trades", "win_rate", "expectancy", "total", "largest_loss")
    return {k: {m: summary(v)[m] for m in keep} for k, v in sorted(groups.items())}


def benjamini_hochberg(p_values: list[float], q: float = 0.10) -> list[bool]:
    """Which hypotheses survive a false-discovery rate of `q` across everything tried."""
    m = len(p_values)
    order = sorted(range(m), key=lambda i: p_values[i])
    passed = [False] * m
    last = -1
    for rank, i in enumerate(order, start=1):
        if p_values[i] <= q * rank / m:
            last = rank
    for rank, i in enumerate(order, start=1):
        if rank <= last:
            passed[i] = True
    return passed
