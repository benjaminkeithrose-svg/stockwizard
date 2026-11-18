"""The data program on Ben's PC: candles from Interactive Brokers into the archive and Supabase.

    python -m stockwizard.run_data --port 7497           # catch up, then keep up: after each US close
    python -m stockwizard.run_data --port 7497 --once    # catch up and stop

Decided by Ben, 18 Nov 2026 (SPEC.md): IBKR replaces Yahoo; everything is kept
in the archive on the PC; Supabase keeps only the recent window the app shows.

Each catch-up, for every symbol in data/universe.csv and each timeframe:
1. Fetch from IBKR, from a few days before the archive's last candle (a late
   correction is picked up), or the full depth if the archive has none.
2. Save to the archive.
3. Copy the candles inside Supabase's window to Supabase (source "ibkr").
Then delete IBKR candles older than the window from Supabase. Candles from
other sources (the long Yahoo history the backtests use) are left alone.

During the US session it streams prices for live bars (data/live.py): today's
1-minute bars into Supabase every few seconds, and IBKR's finished 5-minute bars
into the candles every 5 minutes. After each US close it catches up, runs the
scans and backs the archive up to OneDrive. If TWS goes away it exits, so
start-data.bat starts it again.
"""

from __future__ import annotations

import argparse
import sys
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import pandas as pd

from stockwizard.data.archive import Archive
from stockwizard.load import read_symbols

NY = ZoneInfo("America/New_York")
UNIVERSE = Path(__file__).resolve().parents[1] / "data" / "universe.csv"
TIMEFRAMES = ["1d", "1h", "5m"]
DEPTH = {"1d": timedelta(days=365 * 20), "1h": timedelta(days=365 * 2), "5m": timedelta(days=60)}   # first fetch, into the archive
WINDOW = {"1d": timedelta(days=365 * 5), "1h": timedelta(days=365 * 2), "5m": timedelta(days=60)}   # kept in Supabase
OVERLAP = timedelta(days=5)
AFTER_CLOSE = (16, 20)   # New York time the day's candles are fetched


class DataRunner:
    def __init__(self, source, archive: Archive, store, symbols: list[dict], clock=lambda: pd.Timestamp.now(tz="UTC"), log=print):
        self.source, self.archive, self.store, self.symbols = source, archive, store, symbols
        self.clock, self.log = clock, log

    def start(self, symbol: str, timeframe: str) -> date:
        today = self.clock().tz_convert(NY).date()
        last = self.archive.last_ts(symbol, timeframe, self.source.name)
        if last is None:
            return today - DEPTH[timeframe]
        return max(last.tz_convert(NY).date() - OVERLAP, today - DEPTH[timeframe])

    def catch_up(self) -> int:
        """Fetch, archive and copy every symbol and timeframe; then trim Supabase. Returns how many failed."""
        self.store.upsert_symbols(self.symbols)
        now, failed = self.clock(), 0
        for s in self.symbols:
            sym = s["symbol"]
            for tf in TIMEFRAMES:
                try:
                    df = self.source.fetch(sym, tf, self.start(sym, tf), None)
                    self.archive.upsert_candles(sym, tf, self.source.name, df)
                    recent = df[df.index >= now - WINDOW[tf]]
                    if len(recent):
                        self.store.upsert_candles(sym, tf, self.source.name, recent)
                    self.log(f"{sym} {tf}: {len(df)} candles, {len(recent)} to Supabase")
                except Exception as e:  # noqa: BLE001 - one symbol failing doesn't stop the rest
                    failed += 1
                    self.log(f"{sym} {tf}: FAILED - {e}")
        self.trim()
        return failed

    def trim(self) -> None:
        now = self.clock()
        for tf in TIMEFRAMES:
            cutoff = (now - WINDOW[tf]).floor("D")
            self.store.delete("candles", {"source": f"eq.{self.source.name}", "timeframe": f"eq.{tf}", "ts": f"lt.{cutoff.isoformat()}"})

    def after_close_due(self, done: date | None) -> date | None:
        """Today's New York date, if it's a trading day past the after-close time and not done yet."""
        from stockwizard.zerodte import calendar  # noqa: PLC0415
        ny = self.clock().tz_convert(NY)
        if not calendar.is_trading_day(ny.date()) or (ny.hour, ny.minute) < AFTER_CLOSE or done == ny.date():
            return None
        return ny.date()

    def after_close(self) -> None:
        failed = self.catch_up()
        from stockwizard.scan import Scanner  # noqa: PLC0415
        for line in Scanner(self.store).run():
            self.log(f"scan {line}")
        where = self.archive.backup()
        self.log(f"Archive: {self.archive.count():,} candles" + (f", backed up to {where}" if where else ", no backup folder (OneDrive not found)")
                 + (f"; {failed} failed" if failed else ""))


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--port", type=int, default=7497, help="TWS paper 7497 or IB Gateway paper 4002")
    p.add_argument("--once", action="store_true", help="catch up once and stop")
    p.add_argument("--symbols", type=Path, default=UNIVERSE)
    a = p.parse_args(argv)
    from stockwizard.data.ibkr import IBKRSource  # noqa: PLC0415 - needs ib_async, only on the PC
    from stockwizard.data.store import SupabaseStore  # noqa: PLC0415
    store = SupabaseStore()
    if not store.is_service:
        raise SystemExit("The data program writes the market data everyone shares, so it runs only on Ben's PC, "
                         "with SUPABASE_SECRET_KEY in stockwizard.env. People's own PCs run only the bot.")
    source = IBKRSource(port=a.port)
    print(f"Connected to Interactive Brokers for data (read-only, client {source.ib.client.clientId}).")
    archive = Archive()
    print(f"Archive: {archive.path} ({archive.count():,} candles)")
    runner = DataRunner(source, archive, store, read_symbols(a.symbols))
    done = None if a.once else runner.after_close_due(None)
    if done:   # started after today's close: catch up, scan and back up in one go
        runner.after_close()
    else:
        failed = runner.catch_up()
        print(f"Caught up{f'; {failed} failed' if failed else ''}.")
        if a.once:
            archive.backup()
            return 1 if failed else 0
    from stockwizard.data.live import LiveFeed, streaming  # noqa: PLC0415
    live = LiveFeed(source, runner.store, archive, [s["symbol"] for s in runner.symbols])
    while True:
        if streaming(runner.clock()):
            live.tick()
            source.ib.sleep(1)   # ib_async's own wait: prices keep arriving while it waits
        else:
            live.stop()
            due = runner.after_close_due(done)
            if due:
                runner.after_close()
                done = due
            source.ib.sleep(60)
        if not source.ib.isConnected():
            print("Interactive Brokers disconnected (TWS or IB Gateway closed or restarted). Restarting to reconnect.")
            return 1


if __name__ == "__main__":
    sys.exit(main())
