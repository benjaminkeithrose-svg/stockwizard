"""The pattern lab (SPEC.md, Pattern lab, phase 3b).

Discovery is allowed to see the future; proof is not.

1. Split first: discovery years, then sealed years the search never reads.
2. Every condition is a threshold on one measure (stockwizard/features.py),
   set at a percentile of the DISCOVERY years only (10th, 20th, 30th, 70th,
   80th, 90th), or a flag. Patterns are one condition, or two together.
3. For each pattern: its episodes (the first day of each run of days it
   holds), how often the target followed (looking ahead, discovery only), the
   lift over the base rate, and a one-sided binomial p-value.
4. Every pattern tried is counted. Survival needs: enough episodes; the
   Benjamini-Hochberg false-discovery check across ALL patterns tried; and
   stability (the same pattern with the next percentile on each side still
   shows at least half the lift).
5. The best survivors go once to the sealed years through the bar-by-bar
   backtester: entry at the next open, target from the entry price, the same
   time limit. Discovery and sealed results are kept and labelled apart.
"""

from __future__ import annotations

import itertools
import math
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from stockwizard.backtest import Strategy, run
from stockwizard.features import FEATURES, build, outcome

PERCENTILES = (10, 20, 30, 70, 80, 90)
NEIGHBOURS = {10: (20,), 20: (10, 30), 30: (20,), 70: (80,), 80: (70, 90), 90: (80,)}


@dataclass(frozen=True)
class Condition:
    feature: str
    op: str          # "<=", ">=" or "flag"
    value: float
    pctl: int | None = None

    def mask(self, f: pd.DataFrame) -> np.ndarray:
        x = f[self.feature].to_numpy()
        with np.errstate(invalid="ignore"):
            if self.op == "flag":
                return x == 1
            return x <= self.value if self.op == "<=" else x >= self.value

    def text(self) -> str:
        meta = FEATURES[self.feature]
        if self.op == "flag":
            return meta.high
        if self.feature == "spy_down_days" and self.op == "<=" and self.value < 1:
            return "SPY closed up today"
        template = meta.low if self.op == "<=" else meta.high
        # "down 3%", "below its average by 3%", "within 1% of its high" read as positive numbers.
        v = abs(self.value) if any(w in template for w in ("down", "below", "within")) else self.value
        return template.format(v=round(v, 2) if abs(v) < 10 else round(v, 1))

    def key(self) -> dict:
        return {"feature": self.feature, "op": self.op, "value": float(f"{self.value:.6g}"), "pctl": self.pctl}


@dataclass
class Settings:
    rise_pct: float = 30.0
    days: int = 10
    min_episodes: int = 20
    fdr_q: float = 0.05
    survivors: int = 8

    def as_dict(self) -> dict:
        return dict(self.__dict__)


def conditions(f: pd.DataFrame) -> list[Condition]:
    """All single conditions, thresholds from the discovery years' own percentiles."""
    out = []
    for name, meta in FEATURES.items():
        col = f[name].dropna()
        if col.empty:
            continue
        if meta.kind == "flag":
            out.append(Condition(name, "flag", 1.0))
            continue
        seen = set()
        for p in PERCENTILES:
            v = float(np.percentile(col, p))
            op = "<=" if p < 50 else ">="
            if (op, v) in seen:  # two percentiles on the same value are one condition, counted once
                continue
            seen.add((op, v))
            out.append(Condition(name, op, v, p))
    return out


def episodes(mask: np.ndarray) -> np.ndarray:
    """First day of each run of days the pattern holds, so one long stretch counts once."""
    prev = np.concatenate([[False], mask[:-1]])
    return mask & ~prev


def binom_tail(k: int, n: int, p: float) -> float:
    """P(X >= k) for X ~ Binomial(n, p)."""
    if k <= 0:
        return 1.0
    if p <= 0:
        return 0.0 if k > 0 else 1.0
    if p >= 1:
        return 1.0
    total = 0.0
    for i in range(k, n + 1):
        total += math.exp(math.lgamma(n + 1) - math.lgamma(i + 1) - math.lgamma(n - i + 1) + i * math.log(p) + (n - i) * math.log1p(-p))
    return min(1.0, total)


def bh_qvalues(p: list[float]) -> list[float]:
    """Benjamini-Hochberg adjusted p-values (q-values), same order as given."""
    m = len(p)
    order = sorted(range(m), key=lambda i: p[i])
    q = [0.0] * m
    running = 1.0
    for rank in range(m, 0, -1):
        i = order[rank - 1]
        running = min(running, p[i] * m / rank)
        q[i] = running
    return q


@dataclass
class Candidate:
    conds: tuple[Condition, ...]
    episodes: int
    hits: int
    rate: float
    lift: float
    p: float
    q: float = 1.0
    stable: bool = False
    status: str = "tried"
    sealed: dict = field(default_factory=dict)

    def text(self) -> str:
        return " and ".join(c.text() for c in self.conds)

    def row(self) -> dict:
        r = lambda v: None if v is None or (isinstance(v, float) and math.isnan(v)) else float(f"{v:.6g}")  # noqa: E731
        return {
            "rule": [c.key() for c in self.conds],
            "label": self.text(),
            "status": self.status,
            "discovery": {"episodes": self.episodes, "hits": self.hits, "rate": r(self.rate), "lift": r(self.lift),
                          "p": r(self.p), "q": r(self.q), "stable": self.stable},
            "sealed": self.sealed,
        }


def score(conds, f, y, base) -> Candidate:
    m = np.ones(len(f), dtype=bool)
    for c in conds:
        m &= c.mask(f)
    ep = episodes(m) & ~np.isnan(y)
    n = int(ep.sum())
    k = int(np.nansum(y[ep]))
    rate = k / n if n else float("nan")
    return Candidate(tuple(conds), n, k, rate, rate / base if n and base else float("nan"), binom_tail(k, n, base) if n else 1.0)


def neighbour(c: Condition, f: pd.DataFrame, p: int) -> Condition:
    return Condition(c.feature, c.op, float(np.percentile(f[c.feature].dropna(), p)), p)


def discover(f: pd.DataFrame, y: np.ndarray, s: Settings) -> tuple[list[Candidate], dict]:
    """Search the discovery years. Returns every candidate scored, and the counts."""
    base = float(np.nanmean(y))
    singles = conditions(f)
    tried: list[Candidate] = []
    for c in singles:
        tried.append(score((c,), f, y, base))
    for a, b in itertools.combinations(singles, 2):
        if a.feature == b.feature:
            continue
        tried.append(score((a, b), f, y, base))
    for c in tried:
        if c.episodes < s.min_episodes:
            c.p = 1.0  # too rare to judge: still counted as tried
    for c, q in zip(tried, bh_qvalues([c.p for c in tried])):
        c.q = q
    passed = [c for c in tried if c.episodes >= s.min_episodes and c.q <= s.fdr_q and c.lift > 1]
    for c in passed:
        c.stable = True
        for i, cond in enumerate(c.conds):
            if cond.op == "flag":
                continue
            for p in NEIGHBOURS[cond.pctl]:
                if neighbour(cond, f, p).value == cond.value:
                    continue  # the next percentile is the same threshold: nothing to compare
                alt = list(c.conds)
                alt[i] = neighbour(cond, f, p)
                other = score(tuple(alt), f, y, base)
                if not (other.episodes >= s.min_episodes // 2 and other.lift >= 1 + (c.lift - 1) / 2):
                    c.stable = False
        c.status = "stable" if c.stable else "unstable"
    for c in tried:
        if c.status == "tried":
            c.status = "too_rare" if c.episodes < s.min_episodes else "not_significant"
    # Survivors: stable, best lift first; a pair only if it beats both its single conditions.
    single_lift = {c.conds[0]: c.lift for c in tried if len(c.conds) == 1}
    stable = [c for c in passed if c.stable and (len(c.conds) == 1 or c.lift > max(single_lift.get(x, 0) for x in c.conds))]
    stable.sort(key=lambda c: (-c.lift, c.p))
    survivors = stable[: s.survivors]
    for c in survivors:
        c.status = "survivor"
    counts = {
        "tried": len(tried),
        "enough_episodes": sum(c.episodes >= s.min_episodes for c in tried),
        "passed_fdr": len(passed),
        "stable": sum(c.stable for c in passed),
        "survivors": len(survivors),
        "base_rate": base,
    }
    return tried, counts


def sealed_test(c: Candidate, f_all: pd.DataFrame, spy: pd.DataFrame, vix: pd.DataFrame, split: pd.Timestamp, s: Settings,
                y_sealed_base: float) -> dict:
    """Run a survivor once through the blind backtester on the sealed years only."""
    m = np.ones(len(f_all), dtype=bool)
    for cond in c.conds:
        m &= cond.mask(f_all)
    signals = pd.DataFrame({"hit": pd.array(m, dtype="boolean"), "direction": pd.NA}, index=f_all.index)
    strat = Strategy("lab", "SPY", "pattern", {}, "^VIX", target_pct=s.rise_pct, max_bars=s.days, cost_pct=0.0, study=True)
    res = run(strat, spy, vix, split, signals=signals)
    done = [t for t in res.trades if t.exit_reason != "open"]
    n, k = len(done), sum(t.exit_reason == "target" for t in done)
    rate = k / n if n else None
    return {
        "trades": n,
        "hits": k,
        "rate": rate,
        "base_rate": y_sealed_base,
        "lift": (rate / y_sealed_base) if rate is not None and y_sealed_base else None,
        "p": binom_tail(k, n, y_sealed_base) if n and y_sealed_base else None,
    }


def study(spy, vix, vix3m, start: pd.Timestamp, split: pd.Timestamp, s: Settings) -> dict:
    """The whole lab run: build measures, search the discovery years, test survivors on the sealed years."""
    f_all = build(spy, vix, vix3m)
    disc = (f_all.index >= start) & (f_all.index < split)
    f = f_all[disc]
    # The look-ahead target, cut so no discovery day's window reaches into the sealed years.
    y_all = outcome(vix, f_all.index, s.rise_pct, s.days)
    sealed_from = f_all.index.searchsorted(split)
    last_ok = f_all.index[max(0, sealed_from - s.days - 1)]
    y = y_all[disc].where(f_all.index[disc] <= last_ok).to_numpy()
    tried, counts = discover(f, y, s)
    sealed_base = float(np.nanmean(y_all[f_all.index >= split]))
    counts["sealed_base_rate"] = sealed_base
    for c in tried:
        if c.status == "survivor":
            c.sealed = sealed_test(c, f_all, spy, vix, split, s, sealed_base)
    return {"counts": counts, "tried": tried}
