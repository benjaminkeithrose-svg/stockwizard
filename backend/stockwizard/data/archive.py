"""The candle archive on Ben's PC (Ben, 18 Nov 2026): every candle fetched, kept, never trimmed.

One SQLite file (Python's own; no extra library), by default
pc/data/archive.sqlite, never committed. Supabase keeps only the recent window
the app shows; the archive keeps everything for backtests on the PC.

A backup copy goes to OneDrive (made with SQLite's own backup, safe while the
archive is open), so a failed disk loses at most a day. Most of it can be
fetched from IBKR again; the recorded option quotes can't, which is why the
backup matters.
"""

from __future__ import annotations

import os
import sqlite3
from pathlib import Path

import pandas as pd

from stockwizard.candles import COLUMNS

DEFAULT_PATH = Path(__file__).resolve().parents[3] / "pc" / "data" / "archive.sqlite"

SCHEMA = """
create table if not exists candles (
  symbol    text not null,
  timeframe text not null,
  source    text not null,
  ts        integer not null,      -- candle open time, UTC, seconds since 1970
  open real not null, high real not null, low real not null, close real not null, volume real not null,
  fetched_at integer not null,
  primary key (symbol, timeframe, source, ts)
) without rowid;
"""


def default_backup_dir() -> Path | None:
    """OneDrive\\StockWizard when OneDrive is set up on this PC; ARCHIVE_BACKUP_DIR overrides it."""
    if os.environ.get("ARCHIVE_BACKUP_DIR"):
        return Path(os.environ["ARCHIVE_BACKUP_DIR"])
    od = os.environ.get("OneDrive")
    return Path(od) / "StockWizard" if od else None


class Archive:
    def __init__(self, path: Path | str | None = None):
        self.path = Path(path or os.environ.get("ARCHIVE_PATH") or DEFAULT_PATH)
        if str(self.path) != ":memory:":
            self.path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(str(self.path))
        self.db.execute("pragma journal_mode=wal")
        self.db.executescript(SCHEMA)

    def upsert_candles(self, symbol: str, timeframe: str, source: str, candles: pd.DataFrame) -> int:
        now = int(pd.Timestamp.now(tz="UTC").timestamp())
        rows = [(symbol, timeframe, source, int(ts.timestamp()), float(r.open), float(r.high), float(r.low), float(r.close),
                 float(r.volume), now) for ts, r in candles[COLUMNS].iterrows()]
        with self.db:
            self.db.executemany("insert or replace into candles values (?,?,?,?,?,?,?,?,?,?)", rows)
        return len(rows)

    def read(self, symbol: str, timeframe: str, source: str, start: pd.Timestamp | None = None,
             end: pd.Timestamp | None = None) -> pd.DataFrame:
        """Candles that opened from `start` up to (not including) `end`, oldest first, as a candle frame."""
        q = "select ts, open, high, low, close, volume from candles where symbol=? and timeframe=? and source=?"
        args: list = [symbol, timeframe, source]
        if start is not None:
            q += " and ts >= ?"
            args.append(int(start.timestamp()))
        if end is not None:
            q += " and ts < ?"
            args.append(int(end.timestamp()))
        rows = self.db.execute(q + " order by ts", args).fetchall()
        df = pd.DataFrame(rows, columns=["ts", *COLUMNS])
        df.index = pd.to_datetime(df.pop("ts"), unit="s", utc=True)
        return df.astype(float)

    def last_ts(self, symbol: str, timeframe: str, source: str) -> pd.Timestamp | None:
        (v,) = self.db.execute("select max(ts) from candles where symbol=? and timeframe=? and source=?",
                               (symbol, timeframe, source)).fetchone()
        return None if v is None else pd.Timestamp(v, unit="s", tz="UTC")

    def count(self) -> int:
        return self.db.execute("select count(*) from candles").fetchone()[0]

    def backup(self, folder: Path | None = None) -> Path | None:
        """Copy the archive to `folder` (OneDrive by default) as archive.sqlite, replacing yesterday's copy."""
        folder = folder or default_backup_dir()
        if folder is None:
            return None
        folder.mkdir(parents=True, exist_ok=True)
        dest = folder / "archive.sqlite"
        tmp = folder / "archive.sqlite.part"
        out = sqlite3.connect(str(tmp))
        try:
            self.db.backup(out)
        finally:
            out.close()
        os.replace(tmp, dest)
        return dest

    def close(self) -> None:
        self.db.close()
