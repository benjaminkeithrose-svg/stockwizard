"""Run the pattern lab on the candles in Supabase and save what it finds.

    python -m stockwizard.run_lab                  # the default question
    python -m stockwizard.run_lab --rise 30 --days 10
    python -m stockwizard.run_lab --rerun 3        # repeat run 3 exactly, say whether it matches

Saved per run: the question, settings, split, how many patterns were tried
and how many passed each check, and a fingerprint of the candles and of the
results. Saved patterns: every survivor (with its sealed-years result) and
the strongest of the rest, so the search can be seen, not just its winners.

The sealed years are single-use: a later run with different settings is
marked sealed_burned, because those years have already been seen.
"""

from __future__ import annotations

import argparse
import sys

import pandas as pd

from stockwizard import __version__
from stockwizard.backtest import fingerprint
from stockwizard.data.store import SupabaseStore
from stockwizard.lab import Settings, study
from stockwizard.data.archive_store import backtest_store
from stockwizard.run_backtests import WARM_UP, read_range
from stockwizard.scan import candles_fingerprint

START = "2006-01-02"
SPLIT = "2021-11-17"   # the last 5 years are sealed (Ben, 17 Nov 2026)
KEEP_OTHERS = 40       # strongest non-survivors kept for context
QUESTION = "What SPY conditions come before the VIX rising {rise}% or more within {days} trading days?"


def compute(store: SupabaseStore, s: Settings, as_of: pd.Timestamp, source: str | None = None) -> dict:
    start, split = pd.Timestamp(START, tz="UTC"), pd.Timestamp(SPLIT, tz="UTC")
    spy, src = read_range(store, "SPY", start - WARM_UP, as_of, source)
    vix, _ = read_range(store, "^VIX", start - WARM_UP, as_of, src)
    vix3m, _ = read_range(store, "^VIX3M", start - WARM_UP, as_of, src)
    out = study(spy, vix, vix3m, start, split, s)
    tried = out["tried"]
    survivors = [c for c in tried if c.status == "survivor"]
    rest = sorted((c for c in tried if c.status != "survivor" and c.episodes >= s.min_episodes), key=lambda c: (c.q, -c.lift))
    keep = survivors + rest[:KEEP_OTHERS]
    rows = [{**c.row(), "n": i} for i, c in enumerate(keep)]
    counts = {k: (float(f"{v:.6g}") if isinstance(v, float) else v) for k, v in out["counts"].items()}
    return {
        "source": src,
        "data_hash": candles_fingerprint({"SPY": spy, "^VIX": vix, "^VIX3M": vix3m}),
        "result_hash": fingerprint({"counts": counts, "rows": rows}),
        "counts": counts,
        "rows": rows,
    }


def save(store, s: Settings, as_of, out, trigger, burned, notes=None) -> int:
    run = store.insert(
        "pattern_runs",
        [{
            "question": QUESTION.format(rise=s.rise_pct, days=s.days),
            "feature_set": "spy_vix_daily",
            "settings": s.as_dict(),
            "settings_hash": fingerprint(s.as_dict()),
            "start_date": START,
            "split_date": SPLIT,
            "as_of": as_of.isoformat(),
            "code_version": __version__,
            "source": out["source"],
            "data_hash": out["data_hash"],
            "result_hash": out["result_hash"],
            "counts": out["counts"],
            "sealed_burned": burned,
            "trigger": trigger,
            "notes": notes,
        }],
        returning=True,
    )[0]
    if out["rows"]:
        store.insert("pattern_candidates", [{**r, "run_id": run["id"]} for r in out["rows"]])
    return run["id"]


def burned(store, settings_hash: str) -> bool:
    """The sealed years count as used once any earlier run with other settings actually tested a survivor on them."""
    earlier = store.select("pattern_runs", {"select": "settings_hash,counts", "trigger": "neq.rerun"})
    return any(r["settings_hash"] != settings_hash and (r["counts"] or {}).get("survivors", 0) > 0 for r in earlier)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--rise", type=float, default=30.0, help="VIX rise, percent")
    p.add_argument("--days", type=int, default=10, help="within this many trading days")
    p.add_argument("--min-episodes", type=int, default=20)
    p.add_argument("--rerun", type=int)
    a = p.parse_args(argv)
    store = backtest_store()
    if a.rerun:
        old = store.select("pattern_runs", {"select": "*", "id": f"eq.{a.rerun}"})
        if not old:
            raise SystemExit(f"No pattern run {a.rerun}")
        old = old[0]
        if old["code_version"] != __version__:
            print(f"Run {a.rerun} was made with Stock Wizard {old['code_version']}; this is {__version__}. Not comparable.")
            return 0
        s = Settings(**old["settings"])
        out = compute(store, s, pd.Timestamp(old["as_of"]), old["source"])
        if out["data_hash"] != old["data_hash"]:
            verdict = f"the candles have changed since run {a.rerun}, so the results can't be compared"
        elif out["result_hash"] == old["result_hash"]:
            verdict = f"identical to run {a.rerun}"
        else:
            verdict = f"DIFFERENT from run {a.rerun} on the same candles: a bug to investigate"
        rid = save(store, s, pd.Timestamp(old["as_of"]), out, "rerun", old["sealed_burned"], f"Re-run of {a.rerun}: {verdict}")
        print(f"Re-run {rid} of run {a.rerun}: {verdict}.")
        return 1 if "DIFFERENT" in verdict else 0
    s = Settings(rise_pct=a.rise, days=a.days, min_episodes=a.min_episodes)
    as_of = pd.Timestamp.now(tz="UTC").floor("s")
    out = compute(store, s, as_of)
    b = burned(store, fingerprint(s.as_dict()))
    rid = save(store, s, as_of, out, "manual", b)
    c = out["counts"]
    print(f"Run {rid}: {c['tried']} patterns tried, {c['enough_episodes']} with enough episodes, {c['passed_fdr']} passed the "
          f"false-discovery check, {c['stable']} stable, {c['survivors']} survivors." + (" [sealed years already used]" if b else ""))
    for r in out["rows"]:
        if r["status"] == "survivor":
            d, sd = r["discovery"], r["sealed"]
            print(f"  {r['label']}: discovery {d['hits']}/{d['episodes']} ({d['rate']:.0%}, lift {d['lift']:.1f}); "
                  f"sealed {sd.get('hits')}/{sd.get('trades')} vs base {sd.get('base_rate', 0):.0%}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
