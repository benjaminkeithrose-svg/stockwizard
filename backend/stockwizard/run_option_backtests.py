"""Run the saved option-structure strategies and save each run.

    python -m stockwizard.run_option_backtests                 # every enabled one
    python -m stockwizard.run_option_backtests --strategy ic_9d_take50
    python -m stockwizard.run_option_backtests --rerun 3      # repeat run 3, say whether it matches

Same record as the other backtests: settings, as_of, start and split, code
version, source, fingerprints of the candles and the results. A later run of
a strategy with different settings marks its held-back years burned, as the
stock backtests do.
"""

from __future__ import annotations

import argparse
import sys

import pandas as pd

from stockwizard import __version__
from stockwizard.backtest import fingerprint
from stockwizard.data.store import SupabaseStore
from stockwizard import intraday_options
from stockwizard.option_backtest import OptionStrategy, report, run
from stockwizard.data.archive_store import BACKTEST_SOURCES, backtest_store
from stockwizard.run_backtests import WARM_UP, read_range
from stockwizard.scan import candles_fingerprint

CODE = f"{__version__}+options3"   # trading-time pricing, mid-price stops


def read_tf(store, symbol: str, timeframe: str, after: pd.Timestamp, before: pd.Timestamp, source: str | None = None) -> pd.DataFrame:
    """One symbol's candles in a range, from the first of BACKTEST_SOURCES that has them (or the given source)."""
    rows = []
    for src in [source] if source else BACKTEST_SOURCES:
        rows = store.select("candles", {
            "select": "ts,open,high,low,close,volume", "symbol": f"eq.{symbol}", "timeframe": f"eq.{timeframe}", "source": f"eq.{src}",
            "and": f"(ts.gte.{after.isoformat()},ts.lt.{before.isoformat()})", "order": "ts.asc",
        })
        if rows:
            break
    if not rows:
        raise RuntimeError(f"No {timeframe} candles for {symbol}")
    df = pd.DataFrame(rows)
    df.index = pd.to_datetime(df.pop("ts"), utc=True)
    return df[["open", "high", "low", "close", "volume"]].astype(float)


class OptionBacktester:
    def __init__(self, store):
        self.store = store

    def compute(self, cfg: dict, start, split, as_of: pd.Timestamp, source: str | None = None) -> dict:
        if cfg.get("intraday"):
            return self.compute_intraday(cfg, start, split, as_of, source)
        s = OptionStrategy.from_config(cfg)
        start_ts = pd.Timestamp(start, tz="UTC")
        spy, src = read_range(self.store, "SPY", start_ts - WARM_UP, as_of, source)
        vix, _ = read_range(self.store, "^VIX", start_ts - WARM_UP, as_of, source)
        res = run(s, spy, vix, pd.Timestamp(start).date())
        rep = report(res, pd.Timestamp(split).date(), s)
        trades = [t.row() for t in res["trades"]]
        return {
            "source": src,
            "data_hash": candles_fingerprint({"SPY": spy, "^VIX": vix}),
            "result_hash": fingerprint({"trades": trades, "report": rep}),
            "report": rep,
            "trades": trades,
        }

    def compute_intraday(self, cfg: dict, start, split, as_of: pd.Timestamp, source: str | None = None) -> dict:
        """Same-day trades on SPY's hourly candles (stockwizard.intraday_options)."""
        s = intraday_options.IntradayStrategy.from_config(cfg)
        src = source or next((s for s in BACKTEST_SOURCES if self.store.select("candles", {"select": "ts", "symbol": "eq.SPY", "timeframe": "eq.1h", "source": f"eq.{s}", "limit": "1"})), BACKTEST_SOURCES[-1])
        start_ts = pd.Timestamp(start, tz="UTC")
        spy_1h = read_tf(self.store, "SPY", "1h", start_ts - pd.Timedelta(days=5), as_of, src)
        spy_1d = read_tf(self.store, "SPY", "1d", start_ts - pd.Timedelta(days=60), as_of, src)
        vix_1d = read_tf(self.store, "^VIX", "1d", start_ts - pd.Timedelta(days=10), as_of, src)
        vix1d = read_tf(self.store, "^VIX1D", "1h", start_ts - pd.Timedelta(days=5), as_of, src) if s.vol_source == "vix1d" else None
        res = intraday_options.run(s, spy_1h, spy_1d, vix_1d, vix1d, pd.Timestamp(start).date())
        rep = report(res, pd.Timestamp(split).date())
        rep["warnings"].append("Same-day results from hourly candles: stops are checked at each hour's high and low, priced at the hour's end; volatility is held at its entry value.")
        rep["warnings"].append("Only about 2 years of free hourly candles: the held-back period is the last year, so ranges are wide.")
        trades = [t.row() for t in res["trades"]]
        frames = {"SPY_1h": spy_1h, "SPY_1d": spy_1d, "VIX_1d": vix_1d, **({"VIX1D_1h": vix1d} if vix1d is not None else {})}
        return {
            "source": src, "data_hash": candles_fingerprint(frames),
            "result_hash": fingerprint({"trades": trades, "report": rep}), "report": rep, "trades": trades,
        }

    def burned(self, strat: dict, config_hash: str) -> bool:
        earlier = self.store.select("option_runs", {"select": "config_hash", "strategy_id": f"eq.{strat['id']}", "trigger": "neq.rerun"})
        return any(r["config_hash"] != config_hash for r in earlier)

    def save(self, strat: dict, cfg: dict, as_of, out: dict, trigger: str, burned: bool, notes: str | None = None) -> int:
        row = self.store.insert("option_runs", [{
            "strategy_id": strat["id"], "strategy_version": strat["version"], "config": cfg, "config_hash": fingerprint(cfg),
            "as_of": as_of.isoformat(), "start_date": strat["start_date"], "split_date": strat["split_date"], "code_version": CODE,
            "source": out["source"], "data_hash": out["data_hash"], "result_hash": out["result_hash"], "report": out["report"],
            "trades": out["trades"], "held_back_burned": burned, "trigger": trigger, "notes": notes,
        }], returning=True)
        return row[0]["id"]

    def run(self, ids: list[str] | None = None, as_of: pd.Timestamp | None = None) -> list[str]:
        as_of = as_of or pd.Timestamp.now(tz="UTC").floor("s")
        lines = []
        for st in self.store.select("option_strategies", {"select": "*", "enabled": "eq.true", "order": "position"}):
            if ids and st["id"] not in ids:
                continue
            out = self.compute(st["config"], st["start_date"], st["split_date"], as_of)
            burned = self.burned(st, fingerprint(st["config"]))
            rid = self.save(st, st["config"], as_of, out, "manual", burned)
            b, h = out["report"]["build"], out["report"]["held_back"]
            fmt = lambda m: f"{m['trades']} trades, {m['win_rate']:.0f}% won, ${m['expectancy']:+.2f} a trade" if m["trades"] else "no trades"  # noqa: E731
            lines.append(f"{st['id']}: run {rid}. Build {fmt(b)}; held back {fmt(h)}" + (" [held-back burned]" if burned else ""))
        return lines

    def rerun(self, run_id: int) -> str:
        old = self.store.select("option_runs", {"select": "*", "id": f"eq.{run_id}"})
        if not old:
            raise SystemExit(f"No option run {run_id}")
        old = old[0]
        if old["code_version"] != CODE:
            return f"Run {run_id} was made with {old['code_version']}; this is {CODE}. Not comparable."
        st = self.store.select("option_strategies", {"select": "*", "id": f"eq.{old['strategy_id']}"})[0]
        out = self.compute(old["config"], old["start_date"], old["split_date"], pd.Timestamp(old["as_of"]), source=old["source"])
        if out["data_hash"] != old["data_hash"]:
            verdict = f"the candles have changed since run {run_id}, so the results can't be compared"
        elif out["result_hash"] == old["result_hash"]:
            verdict = f"identical to run {run_id}"
        else:
            verdict = f"DIFFERENT from run {run_id} on the same candles: a bug to investigate"
        st = {**st, "version": old["strategy_version"], "start_date": old["start_date"], "split_date": old["split_date"]}
        new_id = self.save(st, old["config"], pd.Timestamp(old["as_of"]), out, "rerun", old["held_back_burned"], notes=f"Re-run of {run_id}: {verdict}")
        return f"Re-run {new_id} of run {run_id}: {verdict}."


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--strategy", action="append")
    p.add_argument("--rerun", type=int)
    a = p.parse_args(argv)
    bt = OptionBacktester(backtest_store())
    if a.rerun:
        v = bt.rerun(a.rerun)
        print(v)
        return 1 if "DIFFERENT" in v else 0
    for line in bt.run(a.strategy):
        print(line)
    return 0


if __name__ == "__main__":
    sys.exit(main())
