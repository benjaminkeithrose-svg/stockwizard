"""The backtest engine (SPEC.md, Backtesting engine).

Bar by bar, in time order:

1. A signal is judged when its candle closes, from that candle and earlier
   ones only. Signals come from the scan rules (stockwizard/scans.py), which
   the truncation test proves never look ahead.
2. An entry fills at the NEXT candle's open, never on the signal's candle.
3. Every open position is checked on every candle against its exits:
   target, stop, time limit.
4. If the stop and the target are both reachable inside one candle, the stop
   is assumed hit first.
5. Costs are charged on every fill.
6. Every trade is kept with its timestamps, so a run reads as a timeline.
7. One position at a time: a signal while a trade is open is noted and
   skipped.

History is split at `split`: trades entered before it are the build period,
the rest the held-back period. Metrics are given for both, side by side, and
for 3-year windows across the whole run (walk-forward).

This module is pure: candles in, trades and metrics out, no database.
"""

from __future__ import annotations

import hashlib
import json
import math
from dataclasses import dataclass, field

import pandas as pd

from stockwizard.candles import validate
from stockwizard.scans import evaluate


@dataclass(frozen=True)
class Strategy:
    id: str
    signal_symbol: str
    signal_rule: str
    signal_params: dict
    trade_symbol: str
    target_pct: float | None = None     # exit when price rises this % above entry
    target_level: float | None = None   # or when it reaches this price
    stop_pct: float | None = None       # exit when price falls this % below entry
    max_bars: int = 20                  # time limit, in candles held (entry candle counts as 1)
    cost_pct: float = 0.0               # charged on each fill, entry and exit
    study: bool = False                 # the traded series can't actually be traded (e.g. the VIX index)

    @classmethod
    def from_config(cls, id: str, cfg: dict) -> "Strategy":
        return cls(id=id, **cfg)

    def config(self) -> dict:
        d = dict(self.__dict__)
        d.pop("id")
        return d


@dataclass
class Trade:
    signal_ts: pd.Timestamp
    entry_ts: pd.Timestamp
    entry_price: float
    exit_ts: pd.Timestamp | None = None
    exit_price: float | None = None
    exit_reason: str | None = None      # target, stop, time, end
    bars: int = 0
    return_pct: float | None = None
    best_pct: float = 0.0               # furthest it went in our favour, high to entry
    signal_vals: dict = field(default_factory=dict)

    def row(self) -> dict:
        r = lambda v: None if v is None else float(f"{v:.10g}")  # noqa: E731
        return {
            "signal_ts": self.signal_ts.isoformat(),
            "entry_ts": self.entry_ts.isoformat(),
            "entry_price": r(self.entry_price),
            "exit_ts": self.exit_ts.isoformat() if self.exit_ts is not None else None,
            "exit_price": r(self.exit_price),
            "exit_reason": self.exit_reason,
            "bars": self.bars,
            "return_pct": r(self.return_pct),
            "best_pct": r(self.best_pct),
            "signal_vals": {k: r(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else v for k, v in self.signal_vals.items()},
        }


@dataclass
class Result:
    trades: list[Trade]
    skipped: dict[str, int]
    bars_in_market: pd.Series   # True on each candle (of the traded series) with a position open


def _ret(entry: float, exit: float, cost_pct: float) -> float:
    c = cost_pct / 100
    return (exit * (1 - c)) / (entry * (1 + c)) * 100 - 100


def run(strategy: Strategy, signal_candles: pd.DataFrame, trade_candles: pd.DataFrame, start: pd.Timestamp,
        signals: pd.DataFrame | None = None) -> Result:
    """Replay history and trade the strategy. Entries only from `start` on; earlier candles warm up the signal.

    `signals` replaces the strategy's scan rule with signals made elsewhere (the pattern lab's patterns,
    built from measures that are themselves truncation-tested).
    """
    s = strategy
    sig = signals if signals is not None else evaluate(s.signal_rule, signal_candles, **s.signal_params)
    tc = validate(trade_candles)
    fired = sig[sig["hit"].fillna(False).to_numpy(dtype=bool)]
    fired = fired[fired.index >= start]
    signal_queue = list(fired.iterrows())  # in time order

    trades: list[Trade] = []
    skipped = {"already_in_trade": 0, "already_past_target": 0, "no_next_candle": 0}
    pos: Trade | None = None
    in_market = pd.Series(False, index=tc.index)
    pending: tuple[pd.Timestamp, pd.Series] | None = None
    qi = 0
    times = tc.index

    for j, ts in enumerate(times):
        o, h, l, c = (float(tc[k].iloc[j]) for k in ("open", "high", "low", "close"))

        # Enter at this candle's open if a signal closed before it.
        if pending is not None and pos is None:
            sig_ts, vals = pending
            pending = None
            target = s.target_level if s.target_level is not None else None
            if target is not None and o >= target:
                skipped["already_past_target"] += 1
            else:
                pos = Trade(sig_ts, ts, o, signal_vals={k: v for k, v in vals.items() if k not in ("hit", "direction")})

        # Manage the open position on this candle.
        if pos is not None:
            in_market.iloc[j] = True
            pos.bars += 1
            stop = pos.entry_price * (1 - s.stop_pct / 100) if s.stop_pct is not None else None
            if s.target_level is not None:
                target = s.target_level
            elif s.target_pct is not None:
                target = pos.entry_price * (1 + s.target_pct / 100)
            else:
                target = None
            pos.best_pct = max(pos.best_pct, (h / pos.entry_price - 1) * 100)
            exit_price = reason = None
            stop_hit = stop is not None and l <= stop
            target_hit = target is not None and h >= target
            if stop_hit:  # checked first: if both are inside this candle, the stop is assumed hit first
                # Opening through the stop fills at the open, the worse price.
                exit_price, reason = (o if o <= stop else stop), "stop"
            elif target_hit:
                exit_price, reason = (o if o >= target else target), "target"
            elif pos.bars >= s.max_bars:
                exit_price, reason = c, "time"
            if reason:
                pos.exit_ts, pos.exit_price, pos.exit_reason = ts, exit_price, reason
                pos.return_pct = _ret(pos.entry_price, exit_price, s.cost_pct)
                trades.append(pos)
                pos = None

        # Signals that closed on or before this candle: the next one is entered at the next candle's open.
        while qi < len(signal_queue) and signal_queue[qi][0] <= ts:
            sig_ts, vals = signal_queue[qi]
            qi += 1
            if pos is not None or pending is not None:
                skipped["already_in_trade"] += 1
            elif j + 1 >= len(times):
                skipped["no_next_candle"] += 1
            else:
                pending = (sig_ts, vals)

    if pos is not None:  # still open at the end of the data: kept, but not counted in the results
        pos.exit_reason = "open"
        trades.append(pos)
    return Result(trades, skipped, in_market)


# --- metrics -----------------------------------------------------------------


def _beta_binomial_range(wins: int, losses: int, n: int = 100, lo: float = 0.05, hi: float = 0.95) -> tuple[int, int]:
    """Likely range of wins in the next `n` trades, from the record so far (uniform prior). 90% range."""
    a, b = wins + 1, losses + 1
    logp = []
    for k in range(n + 1):
        logp.append(
            math.lgamma(n + 1) - math.lgamma(k + 1) - math.lgamma(n - k + 1)
            + math.lgamma(k + a) + math.lgamma(n - k + b) - math.lgamma(n + a + b)
            - (math.lgamma(a) + math.lgamma(b) - math.lgamma(a + b))
        )
    p = [math.exp(x) for x in logp]
    total, cum, low, high = sum(p), 0.0, None, None
    for k, pk in enumerate(p):
        cum += pk / total
        if low is None and cum >= lo:
            low = k
        if high is None and cum >= hi:
            high = k
    return low, high


def metrics(trades: list[Trade], bars: int, bars_in_market: int) -> dict:
    done = [t for t in trades if t.exit_reason != "open"]
    rets = [t.return_pct for t in done]
    wins = [r for r in rets if r > 0]
    losses = [r for r in rets if r <= 0]
    equity, peak, max_dd = 1.0, 1.0, 0.0
    streak = longest = 0
    for r in rets:
        equity *= 1 + r / 100
        peak = max(peak, equity)
        max_dd = min(max_dd, (equity / peak - 1) * 100)
        streak = streak + 1 if r <= 0 else 0
        longest = max(longest, streak)
    n = len(rets)
    low, high = _beta_binomial_range(len(wins), len(losses)) if n else (None, None)
    hits = sum(t.exit_reason == "target" for t in done)
    hit_low, hit_high = _beta_binomial_range(hits, n - hits) if n else (None, None)
    m = {
        "trades": n,
        # Target reached: the study's own test of "working" (Ben, 17 Nov 2026), e.g. VIX +40% before -15%.
        "targets_hit": hits,
        "target_rate": hits / n * 100 if n else None,
        "next_100_targets_low": hit_low,
        "next_100_targets_high": hit_high,
        # Closed up, by any exit.
        "wins": len(wins),
        "win_rate": len(wins) / n * 100 if n else None,
        "next_100_wins_low": low,
        "next_100_wins_high": high,
        "avg_win_pct": sum(wins) / len(wins) if wins else None,
        "avg_loss_pct": sum(losses) / len(losses) if losses else None,
        "profit_factor": (sum(wins) / -sum(losses)) if losses and sum(losses) < 0 else None,
        "expectancy_pct": sum(rets) / n if n else None,
        "return_pct": (equity - 1) * 100 if n else None,
        "max_drawdown_pct": max_dd if n else None,
        "longest_losing_streak": longest,
        "time_in_market_pct": bars_in_market / bars * 100 if bars else None,
        "avg_bars_held": sum(t.bars for t in done) / n if n else None,
        "exits": {k: sum(t.exit_reason == k for t in done) for k in ("target", "stop", "time")},
    }
    return {k: (float(f"{v:.6g}") if isinstance(v, float) else v) for k, v in m.items()}


def report(result: Result, start: pd.Timestamp, split: pd.Timestamp, window_years: int = 3) -> dict:
    """Metrics for the build period, the held-back period, and 3-year windows across the run."""
    im = result.bars_in_market[result.bars_in_market.index >= start]

    def part(lo, hi):
        ts = [t for t in result.trades if lo <= t.entry_ts < hi]
        span = im[(im.index >= lo) & (im.index < hi)]
        return metrics(ts, len(span), int(span.sum()))

    end = im.index[-1] + pd.Timedelta(days=1) if len(im) else split
    out = {"build": part(start, split), "held_back": part(split, end), "windows": []}
    lo = start
    while lo < end:
        hi = min(lo + pd.DateOffset(years=window_years), end)
        label = "build" if hi <= split else "held_back" if lo >= split else "both"
        out["windows"].append({"from": lo.date().isoformat(), "to": (hi - pd.Timedelta(days=1)).date().isoformat(), "period": label, **part(lo, hi)})
        lo = hi
    out["warnings"] = warnings(out)
    return out


def warnings(rep: dict) -> list[str]:
    w = []
    b, h = rep["build"], rep["held_back"]
    if b["trades"] < 30 or h["trades"] < 30:
        w.append("Few trades: the win-rate ranges are wide, so treat the win rates as rough.")
    for key, what in (("target_rate", "target rate"), ("win_rate", "win rate")):
        if b[key] is not None and h[key] is not None and h["trades"] >= 5 and h[key] > b[key] + 15:
            w.append(f"The held-back {what} is far better than the build period's. The spec treats that as something to investigate, not a win.")
    return w


def fingerprint(obj) -> str:
    return hashlib.sha256(json.dumps(obj, sort_keys=True, separators=(",", ":"), default=str).encode()).hexdigest()
