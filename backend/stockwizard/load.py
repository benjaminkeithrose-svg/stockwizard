"""Load candles for a symbol list into Supabase.

    python -m stockwizard.load --symbols data/test_symbols.csv --timeframe 1d --start 2006-01-01

The symbol list is a CSV with columns symbol, market, instrument_type,
tradable, name. Symbols are added or updated first, then each symbol's
candles. One failed symbol is reported and the rest carry on.
"""

from __future__ import annotations

import argparse
import csv
import sys
from datetime import date
from pathlib import Path

from stockwizard.candles import check_timeframe
from stockwizard.data.store import SupabaseStore
from stockwizard.data.yahoo import YahooSource


def read_symbols(path: Path) -> list[dict]:
    with open(path, newline="") as f:
        rows = list(csv.DictReader(f))
    out = []
    for r in rows:
        out.append(
            {
                "symbol": r["symbol"].strip(),
                "market": r["market"].strip(),
                "instrument_type": r["instrument_type"].strip(),
                "tradable": r["tradable"].strip().lower() in ("true", "yes", "1"),
                "name": (r.get("name") or "").strip() or None,
            }
        )
    return out


def run(symbols_csv: Path, timeframe: str, start: date | None, end: date | None, source=None, store=None) -> int:
    check_timeframe(timeframe)
    source = source or YahooSource()
    store = store or SupabaseStore()
    symbols = read_symbols(symbols_csv)
    store.upsert_symbols(symbols)
    failed = 0
    for s in symbols:
        try:
            candles = source.fetch(s["symbol"], timeframe, start, end)
            n = store.upsert_candles(s["symbol"], timeframe, source.name, candles)
            print(f"{s['symbol']}: {n} {timeframe} candles from {source.name}")
        except Exception as e:  # report and carry on with the next symbol
            failed += 1
            print(f"{s['symbol']}: FAILED - {e}", file=sys.stderr)
    return failed


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--symbols", type=Path, required=True)
    p.add_argument("--timeframe", default="1d")
    p.add_argument("--start", type=date.fromisoformat)
    p.add_argument("--end", type=date.fromisoformat)
    a = p.parse_args(argv)
    return 1 if run(a.symbols, a.timeframe, a.start, a.end) else 0


if __name__ == "__main__":
    sys.exit(main())
