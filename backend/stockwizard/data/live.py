"""Live bars in US hours (Ben, 18 Nov 2026): prices streamed from Interactive Brokers into today's 1-minute bars.

The data program samples each symbol's last price once a second, builds
1-minute bars from it and writes the changed ones to Supabase's `live_bars`
every few seconds, for the open chart to move its last candle. Every five
minutes it also fetches IBKR's own finished 5-minute bars into the candles, so
the 5-minute chart and the scans stay current through the day.

It asks for market data type 3: IBKR sends real-time prices where the account
is subscribed and delayed ones (about 15 minutes behind) where it isn't. A
delayed price is stamped 15 minutes earlier, so its bar sits at the time it
really traded, and the bar is marked delayed.
"""

from __future__ import annotations

import math
from datetime import time

import pandas as pd

NY = "America/New_York"
OPEN, CLOSE = time(9, 30), time(16, 0)
DELAY = pd.Timedelta(minutes=15)
STREAM_UNTIL = time(16, 20)   # delayed prices for the last 15 minutes still arrive after the close
WRITE_EVERY = pd.Timedelta(seconds=5)
FIVE = pd.Timedelta(minutes=5)


def in_session(at: pd.Timestamp) -> bool:
    """Whether a price stamped `at` belongs to the US regular session (9:30 to 16:00 New York)."""
    ny = at.tz_convert(NY)
    return ny.weekday() < 5 and OPEN <= ny.time() < CLOSE


def streaming(now: pd.Timestamp) -> bool:
    """Whether to stream now: a trading day, from the open until delayed prices have caught up."""
    from stockwizard.zerodte import calendar  # noqa: PLC0415
    ny = now.tz_convert(NY)
    return calendar.is_trading_day(ny.date()) and OPEN <= ny.time() < STREAM_UNTIL


def _num(v) -> float | None:
    return None if v is None or (isinstance(v, float) and math.isnan(v)) or v <= 0 else float(v)


class MinuteBars:
    """Today's 1-minute bars per symbol, built from sampled prices and the day's running volume."""

    def __init__(self):
        self.bars: dict[tuple[str, pd.Timestamp], dict] = {}
        self.dirty: set[tuple[str, pd.Timestamp]] = set()
        self.last_volume: dict[str, float] = {}

    def update(self, symbol: str, at: pd.Timestamp, price, day_volume=None, delayed: bool = False) -> bool:
        """Add one sample. `at` is when the price traded (UTC). Returns whether it was used."""
        price = _num(price)
        if price is None or not in_session(at):
            return False
        minute = at.floor("min")
        key = (symbol, minute)
        b = self.bars.get(key)
        if b is None:
            b = self.bars[key] = {"open": price, "high": price, "low": price, "close": price, "volume": 0.0, "delayed": delayed}
        else:
            b["high"], b["low"], b["close"] = max(b["high"], price), min(b["low"], price), price
            b["delayed"] = b["delayed"] or delayed
        vol = _num(day_volume)
        if vol is not None:
            before = self.last_volume.get(symbol)
            if before is not None and vol > before:
                b["volume"] += vol - before   # the day's running total grew: this minute traded the difference
            self.last_volume[symbol] = max(vol, before or 0.0)
        self.dirty.add(key)
        return True

    def take_dirty(self) -> list[dict]:
        """The bars changed since last asked, as live_bars rows."""
        rows = [{"symbol": s, "ts": ts.isoformat(), **{k: self.bars[(s, ts)][k] for k in ("open", "high", "low", "close", "volume", "delayed")}}
                for s, ts in sorted(self.dirty, key=lambda k: (k[0], k[1]))]
        self.dirty.clear()
        return rows


class LiveFeed:
    """Streams every symbol from IBKR while the session is on; writes bars and fetches finished 5-minute candles."""

    def __init__(self, source, store, archive, symbols: list[str], clock=lambda: pd.Timestamp.now(tz="UTC"), log=print):
        self.source, self.store, self.archive, self.symbols = source, store, archive, symbols
        self.clock, self.log = clock, log
        self.tickers: dict[str, object] = {}
        self.bars = MinuteBars()
        self.last_write: pd.Timestamp | None = None
        self.last_five: pd.Timestamp | None = None
        self.day = None

    def start(self) -> None:
        if self.tickers:
            return
        today = self.clock().tz_convert(NY).date()
        if self.day != today:   # a new day: start empty and clear yesterday's bars from Supabase
            self.bars, self.day = MinuteBars(), today
            midnight = pd.Timestamp(today).tz_localize(NY).tz_convert("UTC")
            self.store.delete("live_bars", {"ts": f"lt.{midnight.isoformat()}"})
        self.source.ib.reqMarketDataType(3)   # real-time where subscribed, delayed where not
        for sym in self.symbols:
            try:
                self.tickers[sym] = self.source.ib.reqMktData(self.source.contract(sym), "", False, False)
            except Exception as e:  # noqa: BLE001 - one symbol not streaming doesn't stop the rest
                self.log(f"live {sym}: couldn't stream - {e}")
        self.log(f"Streaming {len(self.tickers)} symbols for live bars.")

    def stop(self) -> None:
        if not self.tickers:
            return
        for sym in self.tickers:
            try:
                self.source.ib.cancelMktData(self.source.contract(sym))
            except Exception:  # noqa: BLE001
                pass
        self.tickers = {}
        self.flush(force=True)
        self.log("Stopped streaming: the session's over.")

    def sample(self) -> int:
        """Read every ticker once; returns how many gave a price."""
        now, used = self.clock(), 0
        for sym, t in self.tickers.items():
            delayed = getattr(t, "marketDataType", 1) in (3, 4)
            price = t.last if _num(getattr(t, "last", None)) is not None else t.marketPrice()
            used += self.bars.update(sym, now - DELAY if delayed else now, price, getattr(t, "volume", None), delayed)
        return used

    def flush(self, force: bool = False) -> int:
        now = self.clock()
        if not force and self.last_write is not None and now - self.last_write < WRITE_EVERY:
            return 0
        self.last_write = now
        rows = self.bars.take_dirty()
        if rows:
            self.store.upsert("live_bars", "symbol,ts", rows)
        return len(rows)

    def five_minute_candles(self) -> int:
        """Shortly after each 5-minute mark, IBKR's finished 5-minute bars into the candles (and the archive)."""
        now = self.clock()
        mark = now.floor("5min")
        if now - mark < pd.Timedelta(seconds=15) or self.last_five == mark:
            return 0
        self.last_five = mark
        today, n = now.tz_convert(NY).date(), 0
        for sym in self.symbols:
            try:
                df = self.source.fetch(sym, "5m", today, None)
                if len(df):
                    self.archive.upsert_candles(sym, "5m", self.source.name, df)
                    n += self.store.upsert_candles(sym, "5m", self.source.name, df)
            except Exception as e:  # noqa: BLE001
                self.log(f"live {sym} 5m: FAILED - {e}")
        return n

    def tick(self) -> None:
        """One step while streaming: sample, write what changed, and the 5-minute candles when due."""
        self.start()
        self.sample()
        self.flush()
        self.five_minute_candles()
