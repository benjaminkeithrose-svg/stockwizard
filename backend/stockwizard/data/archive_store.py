"""Backtests on the PC (Ben, 18 Nov 2026): candles from the archive, everything else through Supabase.

`ArchiveStore` wraps the Supabase store. A query for candles is answered from the
archive on this PC (20+ years, everything ever fetched); any other table (the
strategies, saving runs and trades) goes to Supabase as before. The backtests,
the option backtests, the pattern lab and the 0DTE research all read candles
through `store.select("candles", ...)`, so none of them changes.

The source "ibkr+yahoo-unofficial" is IBKR's candles, with the free Yahoo history
kept in the archive used only for the years IBKR doesn't reach (the VIX before
October 2005, VIX3M before August 2009). Runs on it say so, and the app keeps its
"free data, not validated" warning on them (SPEC.md: nothing on the free source is
reported as validated). Yahoo's daily candles are re-stamped to midnight New York,
as IBKR's are, so the two join without a day counted twice.
"""

from __future__ import annotations

import re

import pandas as pd

from stockwizard.data.archive import Archive

STITCHED = "ibkr+yahoo-unofficial"
#: Which candles a backtest reads, in order of preference, when it isn't told: the archive's joined
#: history, then IBKR's alone (Supabase's window), then the free source (older runs being repeated).
BACKTEST_SOURCES = [STITCHED, "ibkr", "yahoo-unofficial"]
NY = "America/New_York"


def _eq(q: dict, key: str) -> str | None:
    v = q.get(key)
    return v[3:] if isinstance(v, str) and v.startswith("eq.") else None


def _range(q: dict) -> tuple[pd.Timestamp | None, pd.Timestamp | None]:
    lo = hi = None
    m = re.match(r"^\(ts\.gte\.([^,]+),ts\.lt\.([^)]+)\)$", q.get("and", ""))
    if m:
        lo, hi = pd.Timestamp(m.group(1)), pd.Timestamp(m.group(2))
    if isinstance(q.get("ts"), str):
        op, _, val = q["ts"].partition(".")
        if op == "gte":
            lo = pd.Timestamp(val)
        elif op == "lt":
            hi = pd.Timestamp(val)
    utc = lambda t: None if t is None else (t.tz_localize("UTC") if t.tzinfo is None else t.tz_convert("UTC"))  # noqa: E731
    return utc(lo), utc(hi)


def to_ny_midnight(index: pd.DatetimeIndex) -> pd.DatetimeIndex:
    """Daily candles stamped near midnight anywhere (Yahoo stamps the VIX at midnight Chicago) to midnight New York."""
    dates = (index + pd.Timedelta(hours=12)).tz_convert("UTC").normalize().tz_localize(None)
    return pd.DatetimeIndex(dates).tz_localize(NY).tz_convert("UTC")


def joined(archive: Archive, symbol: str, timeframe: str, start: pd.Timestamp | None, end: pd.Timestamp | None) -> pd.DataFrame:
    """IBKR's candles, with the archive's Yahoo candles only before IBKR's first one."""
    ib = archive.read(symbol, timeframe, "ibkr", start, end)
    first = archive.first_ts(symbol, timeframe, "ibkr")
    older = archive.read(symbol, timeframe, "yahoo-unofficial", start, end)
    if len(older) and timeframe == "1d":
        older.index = to_ny_midnight(older.index)
        older = older[~older.index.duplicated(keep="last")]
    if first is not None:
        older = older[older.index < first]
    out = pd.concat([older, ib]).sort_index()
    out = out[~out.index.duplicated(keep="last")]
    if start is not None:
        out = out[out.index >= start]
    if end is not None:
        out = out[out.index < end]
    return out


class ArchiveStore:
    """Supabase for everything but candles, which come from the archive on this PC."""

    def __init__(self, inner, archive: Archive):
        self.inner, self.archive = inner, archive

    def __getattr__(self, name):
        return getattr(self.inner, name)

    def select(self, table: str, query: dict[str, str]) -> list[dict]:
        if table != "candles":
            return self.inner.select(table, query)
        symbol, timeframe, source = _eq(query, "symbol"), _eq(query, "timeframe"), _eq(query, "source")
        if not symbol or not timeframe:
            raise ValueError("Candles from the archive need a symbol and a timeframe")
        start, end = _range(query)
        if source == STITCHED:
            df = joined(self.archive, symbol, timeframe, start, end)
        else:
            df = self.archive.read(symbol, timeframe, source or "ibkr", start, end)
        if query.get("order", "ts.asc").endswith(".desc"):
            df = df.iloc[::-1]
        if "limit" in query:
            df = df.iloc[: int(query["limit"])]
        return [{"ts": ts.isoformat(), "open": r.open, "high": r.high, "low": r.low, "close": r.close, "volume": r.volume}
                for ts, r in df.iterrows()]


def backtest_store():
    """The store a backtest runs on: the archive's candles when this PC has the archive, else Supabase's."""
    from stockwizard.data.store import SupabaseStore  # noqa: PLC0415
    inner = SupabaseStore()
    archive = Archive()
    if archive.count() == 0:
        print("No archive on this PC: candles come from Supabase (IBKR's recent window only).")
        return inner
    print(f"Candles from the archive: {archive.path} ({archive.count():,} candles)")
    return ArchiveStore(inner, archive)
