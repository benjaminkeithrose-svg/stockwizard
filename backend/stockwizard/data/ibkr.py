"""Interactive Brokers as the candle source (Ben, 18 Nov 2026): history through TWS or IB Gateway on Ben's PC.

Replaces the free Yahoo source. Bars are regular-session only (like Yahoo's
without pre- and post-market), trades for stocks and ETFs, the index value for
indexes. Prices are split-adjusted, not dividend-adjusted.

Symbols keep the names the app already uses (^VIX, BRK.B) and are mapped to
IBKR contracts here. Daily candles are stamped at midnight New York, the
same as Yahoo's for US stocks, so a trading date reads the same either way.

Connects read-only with its own client id, so it can never place an order and
never disturbs the bot's connection.
"""

from __future__ import annotations

import math
from datetime import date, datetime, timedelta, timezone

import pandas as pd

from stockwizard.candles import check_timeframe, validate
from stockwizard.data.base import drop_unfinished

DATA_CLIENT_ID = 30          # the bot is 17; checks and tests use 18 to 29
LIVE_PORTS = {4001, 7496}    # read-only can't trade, but keep the paper-only habit
NY = "America/New_York"

# Index symbols the app uses, and where IBKR lists them.
INDEXES = {
    "^VIX": ("VIX", "CBOE"), "^VIX1D": ("VIX1D", "CBOE"), "^VIX9D": ("VIX9D", "CBOE"), "^VIX3M": ("VIX3M", "CBOE"),
    "^SPX": ("SPX", "CBOE"), "^NDX": ("NDX", "NASDAQ"), "^RUT": ("RUT", "RUSSELL"),
}
BAR_SIZE = {"5m": "5 mins", "15m": "15 mins", "30m": "30 mins", "1h": "1 hour", "1d": "1 day"}


def ibkr_symbol(symbol: str) -> str:
    """BRK.B is "BRK B" at IBKR."""
    return symbol.replace(".", " ")


def duration(start: date, end: date) -> str:
    """IBKR's duration string covering start to end: days up to a year, whole years beyond."""
    days = (end - start).days + 1
    return f"{max(days, 1)} D" if days <= 365 else f"{math.ceil(days / 365.25)} Y"   # .25: leap days don't add a year


def to_candles(bars, timeframe: str, now: pd.Timestamp) -> pd.DataFrame:
    """IBKR bars (date for daily, UTC datetime for intraday) to a validated candle frame, unfinished bar dropped."""
    bar = check_timeframe(timeframe)
    if not bars:
        raise ValueError("No candles returned")
    stamps = []
    for b in bars:
        d = b.date
        if isinstance(d, datetime):
            ts = pd.Timestamp(d)
            ts = ts.tz_localize("UTC") if ts.tzinfo is None else ts.tz_convert("UTC")
        else:   # a daily bar: its trading date, opened at midnight New York
            ts = pd.Timestamp(d).tz_localize(NY).tz_convert("UTC")
        stamps.append(ts)
    df = pd.DataFrame({"open": [b.open for b in bars], "high": [b.high for b in bars], "low": [b.low for b in bars],
                       "close": [b.close for b in bars], "volume": [max(float(b.volume or 0), 0.0) for b in bars]},
                      index=pd.DatetimeIndex(stamps))
    df = df[~df.index.duplicated(keep="last")].sort_index()
    df = df[(df[["open", "high", "low", "close"]] > 0).all(axis=1)]   # IBKR sends -1 where it has no value
    return validate(drop_unfinished(df, bar, now))


class IBKRSource:
    name = "ibkr"
    validated = True

    def __init__(self, host: str = "127.0.0.1", port: int = 7497, client_id: int = DATA_CLIENT_ID, ib=None, lib=None,
                 clock=lambda: pd.Timestamp.now(tz="UTC")):
        if port in LIVE_PORTS:
            raise ValueError(f"Port {port} is a live-trading port; the data connection uses the paper one")
        if lib is None:
            import ib_async as lib  # noqa: PLC0415 - only on the PC that runs TWS
        self.lib, self.clock = lib, clock
        self.ib = ib or lib.IB()
        if ib is None:
            self.ib.RequestTimeout = 120
            self.ib.connect(host, port, clientId=client_id, readonly=True)
        self._contracts: dict[str, object] = {}

    def contract(self, symbol: str):
        if symbol not in self._contracts:
            if symbol in INDEXES:
                sym, exch = INDEXES[symbol]
                c = self.lib.Index(sym, exch, "USD")
            else:
                c = self.lib.Stock(ibkr_symbol(symbol), "SMART", "USD")
            q = self.ib.qualifyContracts(c)
            if not q or not getattr(q[0], "conId", 0):
                raise ValueError(f"IBKR doesn't know {symbol}")
            self._contracts[symbol] = q[0]
        return self._contracts[symbol]

    def fetch(self, symbol: str, timeframe: str, start: date | None = None, end: date | None = None) -> pd.DataFrame:
        check_timeframe(timeframe)
        now = self.clock()
        today = now.tz_convert(NY).date()
        start = start or today - timedelta(days=365 * 5)
        end_dt = "" if end is None or end >= today else datetime.combine(end + timedelta(days=1), datetime.min.time(), timezone.utc)
        bars = self.ib.reqHistoricalData(self.contract(symbol), endDateTime=end_dt, durationStr=duration(start, end or today),
                                         barSizeSetting=BAR_SIZE[timeframe], whatToShow="TRADES", useRTH=True, formatDate=2)
        df = to_candles(bars, timeframe, now)
        first = pd.Timestamp(start).tz_localize(NY).tz_convert("UTC")
        return df[df.index >= first]

    def disconnect(self) -> None:
        self.ib.disconnect()
