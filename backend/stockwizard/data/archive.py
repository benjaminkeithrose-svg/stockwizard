"""The candle archive on Ben's PC (Ben, 18 Nov 2026): every candle fetched, kept, never trimmed.

One SQLite file (Python's own; no extra library), by default
archive.sqlite in %LOCALAPPDATA%/StockWizard (beside the installed program's settings), never committed. Supabase keeps only the recent window
the app shows; the archive keeps everything for backtests on the PC.

A backup copy goes to OneDrive (made with SQLite's own backup, safe while the
archive is open), so a failed disk loses at most a day. Most of it can be
fetched from IBKR again; the recorded option quotes can't, which is why the
backup matters.

Guarded since 19 Nov 2026 (Ben's archive was found damaged, "database disk image is
malformed", and the nightly backup had copied the damage over the good backup):
- On opening, SQLite's own check runs. A damaged archive is moved aside
  (archive.damaged-<date>.sqlite, never deleted) and the OneDrive backup is put in its
  place if that one checks out; otherwise it starts empty and the data program fetches
  the history from IBKR again.
- A backup is made only from an archive that checks out, and checked again before it
  replaces the last one; the one before is kept as archive.previous.sqlite.
"""

from __future__ import annotations

import os
import shutil
import sqlite3
from pathlib import Path

import pandas as pd

from stockwizard.candles import COLUMNS

# Beside the installed program's settings (stage 3); the supervisor also sets ARCHIVE_PATH to this.
DEFAULT_PATH = Path(os.environ.get("LOCALAPPDATA") or Path.home()) / "StockWizard" / "archive.sqlite"

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


def healthy(path: Path) -> bool:
    """SQLite's own quick check: True when the file is a sound database (a missing file counts as sound)."""
    if not path.exists():
        return True
    try:
        con = sqlite3.connect(str(path), timeout=30)
        try:
            return con.execute("pragma quick_check").fetchone()[0] == "ok"
        finally:
            con.close()
    except sqlite3.DatabaseError:
        return False


def set_aside(path: Path, log=print) -> Path:
    """Move a damaged archive (and its -wal/-shm files) aside, dated, never deleted."""
    stamp = pd.Timestamp.now(tz="UTC").strftime("%Y-%m-%d-%H%M")
    dest = path.with_name(f"archive.damaged-{stamp}.sqlite")
    os.replace(path, dest)
    for x in ("-wal", "-shm"):
        side = Path(str(path) + x)
        if side.exists():
            os.replace(side, Path(str(dest) + x))
    log(f"The archive was damaged: moved aside to {dest.name}.")
    return dest


class Archive:
    def __init__(self, path: Path | str | None = None, backup_dir: Path | None = None, log=print):
        self.path = Path(path or os.environ.get("ARCHIVE_PATH") or DEFAULT_PATH)
        if str(self.path) != ":memory:":
            self.path.parent.mkdir(parents=True, exist_ok=True)
            if not healthy(self.path):
                set_aside(self.path, log)
                spare = (backup_dir or default_backup_dir() or Path("/nonexistent")) / "archive.sqlite"
                if spare.exists() and healthy(spare):
                    shutil.copyfile(spare, self.path)
                    log(f"Put the backup from {spare.parent} in its place; anything newer is fetched from IBKR again.")
                else:
                    log("No sound backup: starting an empty archive; the history is fetched from IBKR again.")
        self.db = sqlite3.connect(str(self.path), timeout=30)   # the data program and a backtest can share it
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

    def first_ts(self, symbol: str, timeframe: str, source: str) -> pd.Timestamp | None:
        (v,) = self.db.execute("select min(ts) from candles where symbol=? and timeframe=? and source=?",
                               (symbol, timeframe, source)).fetchone()
        return None if v is None else pd.Timestamp(v, unit="s", tz="UTC")

    def count(self) -> int:
        return self.db.execute("select count(*) from candles").fetchone()[0]

    def backup(self, folder: Path | None = None) -> Path | None:
        """Copy the archive to `folder` (OneDrive by default) as archive.sqlite, replacing yesterday's copy."""
        folder = folder or default_backup_dir()
        if folder is None:
            return None
        if self.db.execute("pragma quick_check").fetchone()[0] != "ok":
            raise RuntimeError("The archive fails SQLite's check: not backed up, so the last good backup is kept")
        folder.mkdir(parents=True, exist_ok=True)
        dest = folder / "archive.sqlite"
        tmp = folder / "archive.sqlite.part"
        out = sqlite3.connect(str(tmp))
        try:
            self.db.backup(out)
        finally:
            out.close()
        if not healthy(tmp):
            tmp.unlink(missing_ok=True)
            raise RuntimeError("The new backup failed SQLite's check: the last good backup is kept")
        if dest.exists():
            os.replace(dest, folder / "archive.previous.sqlite")
        os.replace(tmp, dest)
        return dest

    def close(self) -> None:
        self.db.close()
