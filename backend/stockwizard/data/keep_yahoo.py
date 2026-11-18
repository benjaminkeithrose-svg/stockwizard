"""Copy the free Yahoo candles from Supabase into the archive, before they're deleted there (Ben, 18 Nov 2026).

    python -m stockwizard.data.keep_yahoo           # copy, then check the archive holds every one

The archive keeps everything; the backtests use Yahoo's only for the years IBKR doesn't
reach (data/archive_store.py). Copied as they are, timestamps and all, under the source
"yahoo-unofficial". Needs the secret key (Ben's PC).
"""

from __future__ import annotations

import sys

import pandas as pd

from stockwizard.data.archive import Archive
from stockwizard.data.store import SupabaseStore

SOURCE = "yahoo-unofficial"


def copy(store, archive: Archive, log=print) -> dict[tuple[str, str], int]:
    pairs = sorted({(r["symbol"], r["timeframe"]) for r in store.select("candles", {"select": "symbol,timeframe", "source": f"eq.{SOURCE}",
                                                                                  "order": "symbol,timeframe", "limit": "1000000"})})
    copied = {}
    for sym, tf in pairs:
        rows = store.select("candles", {"select": "ts,open,high,low,close,volume", "symbol": f"eq.{sym}", "timeframe": f"eq.{tf}",
                                        "source": f"eq.{SOURCE}", "order": "ts.asc"})
        df = pd.DataFrame(rows)
        df.index = pd.to_datetime(df.pop("ts"), utc=True)
        copied[(sym, tf)] = archive.upsert_candles(sym, tf, SOURCE, df[["open", "high", "low", "close", "volume"]].astype(float))
        log(f"{sym} {tf}: {copied[(sym, tf)]:,} candles kept")
    return copied


def check(archive: Archive, copied: dict[tuple[str, str], int]) -> list[str]:
    """Every copied set is in the archive in full; returns what's short."""
    short = []
    for (sym, tf), n in copied.items():
        have = len(archive.read(sym, tf, SOURCE))
        if have < n:
            short.append(f"{sym} {tf}: {have:,} of {n:,}")
    return short


def main() -> int:
    store, archive = SupabaseStore(), Archive()
    if not store.is_service:
        print("This needs the secret key: run it on Ben's PC.")
        return 1
    copied = copy(store, archive)
    short = check(archive, copied)
    print(f"Kept {sum(copied.values()):,} Yahoo candles in {archive.path}." + (" SHORT: " + "; ".join(short) if short else " All there."))
    return 1 if short else 0


if __name__ == "__main__":
    sys.exit(main())
