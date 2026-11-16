"""Run the scans and save what they find.

    python -m stockwizard.scan                  # every enabled scan, as of now
    python -m stockwizard.scan --scan breakout_1d --as-of 2026-11-14T00:00:00Z
    python -m stockwizard.scan --rerun 42       # repeat run 42 exactly and say whether it matches

Each run reads the last CANDLES candles that opened before `as_of` for every
symbol, applies the scan's rule, and keeps the symbols whose latest candle
fires. The run records everything needed to repeat it: as_of, the rule and
code versions, the settings, the symbols, the data source, a fingerprint of
the candles used (data_hash) and of the results (result_hash). A re-run with
the same candles must give the same result_hash (SPEC.md, phase 2).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from dataclasses import dataclass, field

import pandas as pd

from stockwizard import __version__
from stockwizard.candles import TIMEFRAMES, session_dates
from stockwizard.data.store import SupabaseStore
from stockwizard.scans import RULES, evaluate

CANDLES = 300  # history read per symbol: enough to warm up every rule's indicators
SOURCES = ["ibkr", "yahoo-unofficial"]  # the broker's data once it exists; the free source until then
# A symbol whose latest candle is older than this is left out rather than reported on old data.
STALE_AFTER = {"5m": pd.Timedelta(days=4), "15m": pd.Timedelta(days=4), "30m": pd.Timedelta(days=4),
               "1h": pd.Timedelta(days=5), "1d": pd.Timedelta(days=6)}


@dataclass
class Outcome:
    results: list[dict]
    data_hash: str
    result_hash: str
    source: str
    skipped: list[str] = field(default_factory=list)


def _num(v):
    if v is None or (isinstance(v, float) and math.isnan(v)) or v is pd.NA:
        return None
    if isinstance(v, (bool,)):
        return v
    return float(f"{float(v):.10g}")


def _fingerprint(obj) -> str:
    return hashlib.sha256(json.dumps(obj, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def candles_fingerprint(frames: dict[str, pd.DataFrame]) -> str:
    return _fingerprint(
        {
            sym: [[int(ts.timestamp()), *[_num(x) for x in row]] for ts, row in zip(df.index, df.itertuples(index=False))]
            for sym, df in sorted(frames.items())
        }
    )


def apply_scan(
    rule: str,
    timeframe: str,
    params: dict,
    frames: dict[str, pd.DataFrame],
    as_of: pd.Timestamp,
    context: dict[str, pd.DataFrame] | None = None,
) -> tuple[list[dict], list[str]]:
    """The symbols whose latest candle fires, and those skipped for missing or old data. No database."""
    results, skipped = [], []
    for sym, df in sorted(frames.items()):
        if df.empty or as_of - df.index[-1] > STALE_AFTER[timeframe]:
            skipped.append(sym)
            continue
        out = evaluate(rule, df, **params)
        row = out.iloc[-1]
        if not (row["hit"] is True or (row["hit"] is not pd.NA and bool(row["hit"]))):
            continue
        ts = df.index[-1]
        ctx = {}
        for csym, cdf in (context or {}).items():
            # Same trading day or earlier, by date: the VIX's daily candle is stamped an hour after SPY's.
            at = cdf[session_dates(cdf.index) <= session_dates(pd.DatetimeIndex([ts]))[0]]
            if not at.empty:
                ctx[csym] = _num(at["close"].iloc[-1])
        results.append(
            {
                "symbol": sym,
                "candle_ts": ts.isoformat(),
                "direction": None if row["direction"] is pd.NA else row["direction"],
                "vals": {k: _num(v) for k, v in row.items() if k not in ("hit", "direction")},
                "context": ctx,
            }
        )
    return results, skipped


def results_fingerprint(results: list[dict]) -> str:
    return _fingerprint(sorted(results, key=lambda r: r["symbol"]))


class Scanner:
    def __init__(self, store: SupabaseStore):
        self.store = store

    def universe(self) -> list[str]:
        """The watchlist marked as the scanner universe; if there isn't one, every tradable symbol."""
        lists = self.store.select("watchlists", {"select": "id,watchlist_symbols(symbol)", "is_universe": "eq.true"})
        syms = sorted({s["symbol"] for w in lists for s in w.get("watchlist_symbols", [])})
        if syms:
            return syms
        return [r["symbol"] for r in self.store.select("symbols", {"select": "symbol", "tradable": "eq.true", "order": "symbol"})]

    def read(self, symbols: list[str], timeframe: str, as_of: pd.Timestamp, source: str | None = None):
        """Candles for each symbol from the first source that has them (or the given one)."""
        frames, used = {}, set()
        for sym in symbols:
            for src in [source] if source else SOURCES:
                df = self.store.read_candles(sym, timeframe, src, as_of, CANDLES)
                if not df.empty:
                    frames[sym] = df
                    used.add(src)
                    break
            else:
                frames[sym] = pd.DataFrame(columns=["open", "high", "low", "close", "volume"], index=pd.DatetimeIndex([], tz="UTC"))
        return frames, ",".join(sorted(used)) or "none"

    def compute(self, scan: dict, as_of: pd.Timestamp, symbols: list[str], params: dict, source: str | None = None) -> Outcome:
        frames, src = self.read(symbols, scan["timeframe"], as_of, source)
        context, _ = self.read(scan.get("context") or [], scan["timeframe"], as_of, source)
        results, skipped = apply_scan(scan["rule"], scan["timeframe"], params, frames, as_of, context)
        return Outcome(results, candles_fingerprint(frames), results_fingerprint(results), src, skipped)

    def save(self, scan: dict, as_of, symbols, params, out: Outcome, trigger: str, notes: str | None = None) -> int:
        run = self.store.insert(
            "scan_runs",
            [
                {
                    "scan_id": scan["id"],
                    "as_of": as_of.isoformat(),
                    "rule_version": RULES[scan["rule"]].code_version,
                    "code_version": __version__,
                    "params": params,
                    "symbols": symbols,
                    "source": out.source,
                    "data_hash": out.data_hash,
                    "result_hash": out.result_hash,
                    "matches": len(out.results),
                    "trigger": trigger,
                    "notes": notes or (f"Left out for missing or old candles: {', '.join(out.skipped)}" if out.skipped else None),
                }
            ],
            returning=True,
        )[0]
        if out.results:
            self.store.insert("scan_results", [{**r, "run_id": run["id"]} for r in out.results])
        return run["id"]

    def run(self, as_of: pd.Timestamp | None = None, scan_ids: list[str] | None = None, trigger: str = "schedule") -> list[str]:
        as_of = as_of or pd.Timestamp.now(tz="UTC").floor("s")
        query = {"select": "*", "enabled": "eq.true", "order": "tab,position"}
        scans = [s for s in self.store.select("scans", query) if not scan_ids or s["id"] in scan_ids]
        universe = None
        report = []
        for scan in scans:
            if scan["rule"] not in RULES or scan["timeframe"] not in TIMEFRAMES:
                report.append(f"{scan['id']}: SKIPPED, unknown rule or timeframe")
                continue
            if scan.get("symbols"):
                symbols = scan["symbols"]
            else:
                universe = universe if universe is not None else self.universe()
                symbols = universe
            params = {**RULES[scan["rule"]].defaults, **(scan.get("params") or {})}
            out = self.compute(scan, as_of, symbols, params)
            run_id = self.save(scan, as_of, symbols, params, out, trigger)
            found = ", ".join(f"{r['symbol']}{' ' + r['direction'] if r['direction'] else ''}" for r in out.results) or "none"
            report.append(f"{scan['id']}: run {run_id}, {len(out.results)} of {len(symbols)} symbols ({found})")
        return report

    def rerun(self, run_id: int) -> str:
        """Repeat a saved run with exactly what it used, save the repeat, and say whether it matches."""
        rows = self.store.select("scan_runs", {"select": "*", "id": f"eq.{run_id}"})
        if not rows:
            raise SystemExit(f"No scan run {run_id}")
        old = rows[0]
        scan = self.store.select("scans", {"select": "*", "id": f"eq.{old['scan_id']}"})[0]
        if old["rule_version"] != RULES[scan["rule"]].code_version:
            return f"Run {run_id} used {old['rule_version']}; the rule is now {RULES[scan['rule']].code_version}. Not comparable."
        if old["code_version"] != __version__:
            return f"Run {run_id} was made with Stock Wizard {old['code_version']}; this is {__version__}. Not comparable."
        as_of = pd.Timestamp(old["as_of"])
        out = self.compute(scan, as_of, old["symbols"], old["params"], source=old["source"].split(",")[0] if old["source"] != "none" else None)
        if out.data_hash != old["data_hash"]:
            verdict = f"the candles have changed since run {run_id} (the source revised them), so the results can't be compared"
        elif out.result_hash == old["result_hash"]:
            verdict = f"identical to run {run_id}"
        else:
            verdict = f"DIFFERENT from run {run_id} on the same candles: a bug to investigate"
        new_id = self.save(scan, as_of, old["symbols"], old["params"], out, "rerun", notes=f"Re-run of {run_id}: {verdict}")
        return f"Re-run {new_id} of run {run_id}: {verdict}."


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--scan", action="append", help="Only this scan id (repeatable)")
    p.add_argument("--as-of", type=pd.Timestamp, help="Use only candles that opened before this time (UTC)")
    p.add_argument("--rerun", type=int, help="Repeat a saved run and check it matches")
    a = p.parse_args(argv)
    scanner = Scanner(SupabaseStore())
    if a.rerun:
        verdict = scanner.rerun(a.rerun)
        print(verdict)
        return 1 if "DIFFERENT" in verdict else 0
    as_of = a.as_of.tz_localize("UTC") if a.as_of is not None and a.as_of.tz is None else a.as_of
    for line in scanner.run(as_of, a.scan, trigger="manual" if (a.scan or a.as_of) else "schedule"):
        print(line)
    return 0


if __name__ == "__main__":
    sys.exit(main())
