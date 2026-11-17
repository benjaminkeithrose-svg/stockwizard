"""Run the 0DTE experiment matrix (stage 2 of Ben's brief) and write a report.

    python -m stockwizard.run_0dte_research                  # the initial grid, development and validation only
    python -m stockwizard.run_0dte_research --final          # also the untouched final period (use once)

Until real option quotes are bought or recorded, prices come from the model
(zerodte.quotes.ModelQuotes) on SPY's and QQQ's free hourly candles, so entries
are limited to the half hours (10:30, 11:30, 13:30, 14:30) and nothing here is
evidence of profit. The report says so at the top. XSP and SPX are modelled
from SPY's price (XSP ≈ SPY, SPX ≈ 10 × SPY); QQQ is priced with 1.2 × the VIX.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import date
from pathlib import Path

import pandas as pd

from stockwizard.data.store import SupabaseStore
from stockwizard.option_backtest import atr14
from stockwizard.run_option_backtests import read_tf
from stockwizard.zerodte import matrix
from stockwizard.zerodte.quotes import ModelQuotes
from stockwizard.zerodte.strategy import Config

OUT = Path(__file__).resolve().parents[2] / "docs" / "research" / "results"
PERIODS = matrix.Periods(date(2024, 11, 19), date(2025, 8, 29), date(2026, 3, 31), date(2026, 11, 16))


def initial_grid() -> list[Config]:
    """The brief's strategies A, B and C, the baselines, and debit spreads for comparison (section 7)."""
    out: list[Config] = []
    for inst, widths in (("XSP", (1, 2, 5)), ("SPY", (1, 2, 5)), ("SPX", (5, 10)), ("QQQ", (1, 2))):
        for w in widths:
            for d in (0.15, 0.20):
                # A: directional premium selling, after the open settles (10:30 on hourly candles), 50% target, 2× stop, out by 15:00.
                out.append(Config(inst, "directional", "10:30", d, w, neutral_trade="none", profit_target=0.5, stop_mult=2.0, exit_time="15:00"))
                # B: neutral condor, only while still inside the opening range; symmetric and a wider call side.
                for cw in (None, w * 2):
                    out.append(Config(inst, "iron_condor", "10:30", d, w, call_width=cw, require_inside_range=True, profit_target=0.5, exit_time="15:00"))
            for d in (0.10, 0.15, 0.20):
                # C: afternoon selling, directional or a condor on neutral days, out by 15:30.
                out.append(Config(inst, "directional", "13:30", d, w, neutral_trade="iron_condor", exit_time="15:30"))
            # Baselines: sell every day, no filters, held to expiry.
            for d in (0.10, 0.15, 0.20, 0.25):
                out.append(Config(inst, "iron_condor", "10:30", d, w))
            out.append(Config(inst, "iron_fly", "10:30", 0.5, w))
            # Exits on the plain condor at 15 delta.
            for kw in (dict(profit_target=0.25), dict(profit_target=0.75), dict(stop_mult=1.5), dict(stop_mult=3.0),
                       dict(stop_breach=True), dict(stop_delta=0.35), dict(stop_delta=0.50), dict(exit_time="14:30")):
                out.append(Config(inst, "iron_condor", "10:30", 0.15, w, **kw))
            # Volatility regimes.
            for lo, hi in ((None, 15), (15, 20), (20, 30), (30, None)):
                out.append(Config(inst, "iron_condor", "10:30", 0.15, w, vix_min=lo, vix_max=hi))
            # Debit spreads in the signal's direction, for comparison.
            out.append(Config(inst, "directional_debit", "10:30", 0.5, w, exit_time="15:00"))
    return out


def load(store) -> dict:
    lo, hi = pd.Timestamp(PERIODS.start, tz="UTC") - pd.Timedelta(days=60), pd.Timestamp(PERIODS.end, tz="UTC") + pd.Timedelta(days=1)
    spy1h, qqq1h = read_tf(store, "SPY", "1h", lo, hi), read_tf(store, "QQQ", "1h", lo, hi)
    spy1d = read_tf(store, "SPY", "1d", lo - pd.Timedelta(days=60), hi)
    vix1d_daily = read_tf(store, "^VIX", "1d", lo, hi)
    v1 = read_tf(store, "^VIX1D", "1h", lo, hi)
    ny = lambda df: df.index.tz_convert("America/New_York").date  # noqa: E731
    vix_by_day = pd.Series(vix1d_daily["close"].values, index=ny(vix1d_daily))
    vix_by_day = vix_by_day[~vix_by_day.index.duplicated(keep="last")]
    daily = spy1d.copy()
    daily.index = ny(spy1d)
    daily = daily[~daily.index.duplicated(keep="last")]
    atr = atr14(daily)
    # VIX1D as known through the day: each hour's open at its start, its close at its end.
    known = pd.concat([pd.Series(v1["open"].values, index=v1.index), pd.Series(v1["close"].values, index=v1.index + pd.Timedelta(hours=1))]).sort_index()
    known = known[~known.index.duplicated(keep="last")] / 100

    def prev(series, d):
        earlier = series[series.index < d]
        return float(earlier.iloc[-1]) if len(earlier) else None

    def vol_spy(ts):
        k = known[known.index <= ts.tz_convert("UTC")]
        if len(k) and (ts.tz_convert("UTC") - k.index[-1]) <= pd.Timedelta(hours=2):
            return float(k.iloc[-1])
        v = prev(vix_by_day, ts.date())
        return v / 100 if v else None

    def vol_qqq(ts):
        v = prev(vix_by_day, ts.date())
        return v / 100 * 1.2 if v else None

    common = dict(bar_minutes=60, quotes=ModelQuotes(), vix_prev=lambda d: prev(vix_by_day, d), atr_prev=lambda d: prev(atr, d))
    return {
        "XSP": dict(bars=spy1h, vol_at=vol_spy, **common), "SPY": dict(bars=spy1h, vol_at=vol_spy, **common),
        "SPX": dict(bars=spy1h, vol_at=vol_spy, **common), "QQQ": dict(bars=qqq1h, vol_at=vol_qqq, **common),
    }


NOTES = [
    "**Modelled option prices, not evidence.** Black-Scholes with put skew and an estimated bid-ask spread; real quotes are needed before any of this means anything (docs/research/0DTE-RESEARCH.md).",
    "Free hourly candles: entries only on the half hour (10:30 stands in for the brief's 10:00), and stops checked at each hour's high and low.",
    "XSP and SPX are modelled from SPY's price; QQQ is priced with 1.2 × the VIX. Fees and spreads per instrument are estimates.",
    "Inflation and jobs-report days aren't tagged yet (their dates need checking); Fed days and expiration Fridays are.",
]


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--final", action="store_true", help="also run the untouched final period (only once)")
    ap.add_argument("--q", type=float, default=0.10)
    a = ap.parse_args(argv)
    data = load(SupabaseStore())
    grid = initial_grid()
    print(f"{len(grid)} strategies...")
    out = matrix.run(grid, data, PERIODS, q=a.q, final=a.final, progress=lambda i, n: i % 25 == 0 and print(f"  {i}/{n}"))
    OUT.mkdir(parents=True, exist_ok=True)
    stamp = date.today().isoformat()
    (OUT / f"{stamp}-0dte-model.md").write_text(matrix.report_markdown(out, f"0DTE experiment matrix, modelled prices ({stamp})", NOTES))
    keep = lambda r: {"strategy": matrix.describe(r["config"]), "config": r["config"].__dict__, "development": r["dev"], **({k: r[k] for k in ("validation", "walk_forward", "by_regime", "final") if k in r})}  # noqa: E731
    (OUT / f"{stamp}-0dte-model.json").write_text(json.dumps({
        "notes": NOTES, "periods": out["periods"], "tried": out["tried"], "q": out["q"], "final_used": out["final_used"],
        "survivors": [keep(r) for r in out["survivors"]], "best_in_development": [keep(r) for r in out["best_in_development"]],
        "all_development": [{"strategy": matrix.describe(r["config"]), **r["dev"]} for r in out["rows"]],
    }, indent=1, default=str))
    print(f"Tried {out['tried']}; {len(out['survivors'])} survived. Report: docs/research/results/{stamp}-0dte-model.md")
    return 0


if __name__ == "__main__":
    sys.exit(main())
