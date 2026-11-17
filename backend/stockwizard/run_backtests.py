"""Run the saved strategies and save each run, its trades and its metrics.

    python -m stockwizard.run_backtests                    # every enabled strategy, data up to now
    python -m stockwizard.run_backtests --strategy vix_drawdown_pct
    python -m stockwizard.run_backtests --rerun 12         # repeat run 12 exactly, say whether it matches

A run records everything needed to repeat it (SPEC.md, Saved runs): the
strategy's settings and version, as_of, the start and split dates, the code
version, the data source, and fingerprints of the candles used and of the
results. Repeating it with the same candles must give the same result_hash.

The held-back period is single-use (SPEC.md, Pattern lab): once a strategy has
been run, a later run with different settings is marked held_back_burned,
because its held-back result is no longer a fair test.
"""

from __future__ import annotations

import argparse
import sys

import pandas as pd

from stockwizard import __version__
from stockwizard.backtest import Strategy, fingerprint, report, run
from stockwizard.data.store import SupabaseStore
from stockwizard.scan import SOURCES, candles_fingerprint

WARM_UP = pd.Timedelta(days=500)  # candles before the start, so the signal's averages are ready on day one


def read_range(store: SupabaseStore, symbol: str, after: pd.Timestamp, before: pd.Timestamp, source: str | None = None):
    for src in [source] if source else SOURCES:
        rows = store.select(
            "candles",
            {
                "select": "ts,open,high,low,close,volume",
                "symbol": f"eq.{symbol}",
                "timeframe": "eq.1d",
                "source": f"eq.{src}",
                "and": f"(ts.gte.{after.isoformat()},ts.lt.{before.isoformat()})",
                "order": "ts.asc",
            },
        )
        if rows:
            df = pd.DataFrame(rows)
            df.index = pd.to_datetime(df.pop("ts"), utc=True)
            return df[["open", "high", "low", "close", "volume"]].astype(float), src
    raise RuntimeError(f"No daily candles for {symbol}")


class Backtester:
    def __init__(self, store: SupabaseStore):
        self.store = store

    def compute(self, strategy_id: str, cfg: dict, start, split, as_of: pd.Timestamp, source: str | None = None):
        s = Strategy.from_config(strategy_id, cfg)
        start, split = pd.Timestamp(start, tz="UTC"), pd.Timestamp(split, tz="UTC")
        sig, src1 = read_range(self.store, s.signal_symbol, start - WARM_UP, as_of, source)
        trd, src2 = read_range(self.store, s.trade_symbol, start - WARM_UP, as_of, source)
        flt = None
        if s.filter_symbol:
            flt, _ = read_range(self.store, s.filter_symbol, start - WARM_UP, as_of, source)
        res = run(s, sig, trd, start, filter_candles=flt)
        rep = report(res, start, split)
        rows = [{**t.row(), "n": i, "period": "build" if t.entry_ts < split else "held_back"} for i, t in enumerate(res.trades)]
        return {
            "source": ",".join(sorted({src1, src2})),
            "data_hash": candles_fingerprint({s.signal_symbol: sig, s.trade_symbol: trd, **({s.filter_symbol: flt} if flt is not None else {})}),
            "result_hash": fingerprint({"trades": rows, "report": rep, "skipped": res.skipped}),
            "trades": rows,
            "report": rep,
            "skipped": res.skipped,
        }

    def save(self, strat: dict, cfg: dict, as_of, out: dict, trigger: str, burned: bool, notes: str | None = None) -> int:
        run_row = self.store.insert(
            "backtest_runs",
            [{
                "strategy_id": strat["id"],
                "strategy_version": strat["version"],
                "config": cfg,
                "config_hash": fingerprint(cfg),
                "as_of": as_of.isoformat(),
                "start_date": strat["start_date"],
                "split_date": strat["split_date"],
                "code_version": __version__,
                "source": out["source"],
                "data_hash": out["data_hash"],
                "result_hash": out["result_hash"],
                "skipped": out["skipped"],
                "warnings": out["report"]["warnings"],
                "held_back_burned": burned,
                "trigger": trigger,
                "notes": notes,
            }],
            returning=True,
        )[0]
        rid = run_row["id"]
        for i in range(0, len(out["trades"]), 500):
            self.store.insert("backtest_trades", [{**t, "run_id": rid} for t in out["trades"][i : i + 500]])
        rep = out["report"]
        mrows = [
            {"run_id": rid, "period": "build", "kind": "build", "metrics": rep["build"], "position": 0},
            {"run_id": rid, "period": "held_back", "kind": "held_back", "metrics": rep["held_back"], "position": 1},
        ] + [
            {"run_id": rid, "period": f"{w['from']}..{w['to']}", "kind": "window",
             "metrics": {k: v for k, v in w.items() if k not in ("from", "to")}, "position": 2 + i}
            for i, w in enumerate(rep["windows"])
        ]
        self.store.insert("backtest_metrics", mrows)
        return rid

    def burned(self, strat_id: str, config_hash: str) -> bool:
        earlier = self.store.select("backtest_runs", {"select": "config_hash", "strategy_id": f"eq.{strat_id}", "trigger": "neq.rerun"})
        return any(r["config_hash"] != config_hash for r in earlier)

    def run(self, ids: list[str] | None = None, as_of: pd.Timestamp | None = None) -> list[str]:
        as_of = as_of or pd.Timestamp.now(tz="UTC").floor("s")
        strats = self.store.select("strategies", {"select": "*", "enabled": "eq.true", "order": "position"})
        lines = []
        for st in strats:
            if ids and st["id"] not in ids:
                continue
            cfg = st["config"]
            out = self.compute(st["id"], cfg, st["start_date"], st["split_date"], as_of)
            burned = self.burned(st["id"], fingerprint(cfg))
            rid = self.save(st, cfg, as_of, out, "manual", burned)
            b, h = out["report"]["build"], out["report"]["held_back"]
            fmt = lambda m: f"{m['trades']} trades, {m['win_rate']:.0f}% won" if m["trades"] else "no trades"  # noqa: E731
            lines.append(f"{st['id']}: run {rid}. Build {fmt(b)}; held back {fmt(h)}" + (" [held-back burned]" if burned else ""))
        return lines

    def rerun(self, run_id: int) -> str:
        old = self.store.select("backtest_runs", {"select": "*", "id": f"eq.{run_id}"})
        if not old:
            raise SystemExit(f"No backtest run {run_id}")
        old = old[0]
        if old["code_version"] != __version__:
            return f"Run {run_id} was made with Stock Wizard {old['code_version']}; this is {__version__}. Not comparable."
        st = self.store.select("strategies", {"select": "*", "id": f"eq.{old['strategy_id']}"})[0]
        out = self.compute(old["strategy_id"], old["config"], old["start_date"], old["split_date"],
                           pd.Timestamp(old["as_of"]), source=old["source"].split(",")[0])
        if out["data_hash"] != old["data_hash"]:
            verdict = f"the candles have changed since run {run_id} (the source revised them), so the results can't be compared"
        elif out["result_hash"] == old["result_hash"]:
            verdict = f"identical to run {run_id}"
        else:
            verdict = f"DIFFERENT from run {run_id} on the same candles: a bug to investigate"
        st = {**st, "version": old["strategy_version"], "start_date": old["start_date"], "split_date": old["split_date"]}
        new_id = self.save(st, old["config"], pd.Timestamp(old["as_of"]), out, "rerun", old["held_back_burned"],
                           notes=f"Re-run of {run_id}: {verdict}")
        return f"Re-run {new_id} of run {run_id}: {verdict}."


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--strategy", action="append")
    p.add_argument("--rerun", type=int)
    a = p.parse_args(argv)
    bt = Backtester(SupabaseStore())
    if a.rerun:
        v = bt.rerun(a.rerun)
        print(v)
        return 1 if "DIFFERENT" in v else 0
    for line in bt.run(a.strategy):
        print(line)
    return 0


if __name__ == "__main__":
    sys.exit(main())
