"""IBKR candles, the PC archive and the data program, against stand-ins. Nothing reaches IBKR or Supabase."""

from __future__ import annotations

from datetime import date, datetime, timezone
from types import SimpleNamespace

import pandas as pd
import pytest

from stockwizard.data.archive import Archive
from stockwizard.data.base import select_preferred
from stockwizard.data.ibkr import IBKRSource, duration, to_candles
from stockwizard.data.store import SupabaseStore
from stockwizard.run_data import DataRunner

NOW = pd.Timestamp("2026-11-18 22:00", tz="UTC")   # 17:00 New York, after the close


def bar(d, o=100.0, h=101.0, l=99.0, c=100.5, v=1000.0):
    return SimpleNamespace(date=d, open=o, high=h, low=l, close=c, volume=v)


# --- turning IBKR bars into candles ---

def test_a_daily_bar_opens_at_midnight_new_york():
    df = to_candles([bar(date(2026, 7, 1)), bar(date(2026, 11, 17))], "1d", NOW)
    assert list(df.index) == [pd.Timestamp("2026-07-01 04:00", tz="UTC"), pd.Timestamp("2026-11-17 05:00", tz="UTC")]  # summer, winter


def test_intraday_bars_stay_in_utc_and_the_forming_one_is_dropped():
    bars = [bar(datetime(2026, 11, 18, 20, 50, tzinfo=timezone.utc)), bar(datetime(2026, 11, 18, 21, 55, tzinfo=timezone.utc))]
    df = to_candles(bars, "5m", pd.Timestamp("2026-11-18 21:57", tz="UTC"))
    assert list(df.index) == [pd.Timestamp("2026-11-18 20:50", tz="UTC")]


def test_bars_without_a_value_are_left_out():
    df = to_candles([bar(date(2026, 11, 16)), bar(date(2026, 11, 17), o=-1, h=-1, l=-1, c=-1)], "1d", NOW)
    assert len(df) == 1


def test_no_bars_is_an_error_not_an_empty_success():
    with pytest.raises(ValueError):
        to_candles([], "1d", NOW)


def test_durations_are_days_up_to_a_year_then_years():
    assert duration(date(2026, 9, 19), date(2026, 11, 17)) == "60 D"
    assert duration(date(2021, 11, 18), date(2026, 11, 17)) == "5 Y"


class FakeLib:
    @staticmethod
    def Index(sym, exch, cur):
        return SimpleNamespace(kind="IND", symbol=sym, exchange=exch, conId=1)

    @staticmethod
    def Stock(sym, exch, cur):
        return SimpleNamespace(kind="STK", symbol=sym, exchange=exch, conId=2)


class FakeIB:
    def __init__(self, bars):
        self.bars, self.asked = bars, []

    def qualifyContracts(self, *cs):
        return list(cs)

    def reqHistoricalData(self, contract, **kw):
        self.asked.append((contract, kw))
        return self.bars


def test_symbols_map_to_ibkr_contracts():
    src = IBKRSource(ib=FakeIB([]), lib=FakeLib, clock=lambda: NOW)
    assert (src.contract("^VIX").kind, src.contract("^VIX").symbol, src.contract("^VIX").exchange) == ("IND", "VIX", "CBOE")
    assert (src.contract("BRK.B").kind, src.contract("BRK.B").symbol) == ("STK", "BRK B")
    assert src.contract("SPY").symbol == "SPY"


def test_the_live_ports_are_refused():
    for port in (7496, 4001):
        with pytest.raises(ValueError):
            IBKRSource(port=port, ib=FakeIB([]), lib=FakeLib)


def test_fetch_asks_for_regular_session_trades_and_keeps_from_start():
    ib = FakeIB([bar(date(2026, 11, d)) for d in (12, 13, 16, 17)])
    df = IBKRSource(ib=ib, lib=FakeLib, clock=lambda: NOW).fetch("SPY", "1d", date(2026, 11, 13))
    _, kw = ib.asked[0]
    assert kw["useRTH"] is True and kw["whatToShow"] == "TRADES" and kw["barSizeSetting"] == "1 day"
    assert df.index[0] == pd.Timestamp("2026-11-13 05:00", tz="UTC") and len(df) == 3


# --- the archive ---

def frame(start, n, freq="1D"):
    idx = pd.date_range(start, periods=n, freq=freq, tz="UTC")
    return pd.DataFrame({"open": 100.0, "high": 101.0, "low": 99.0, "close": 100.5, "volume": 10.0}, index=idx)


def test_the_archive_keeps_candles_and_overwrites_a_correction(tmp_path):
    a = Archive(tmp_path / "a.sqlite")
    a.upsert_candles("SPY", "1d", "ibkr", frame("2026-11-10 05:00", 3))
    fixed = frame("2026-11-12 05:00", 2)
    fixed["close"] = 100.9
    a.upsert_candles("SPY", "1d", "ibkr", fixed)
    df = a.read("SPY", "1d", "ibkr")
    assert len(df) == 4 and df["close"].iloc[2] == 100.9
    assert a.last_ts("SPY", "1d", "ibkr") == pd.Timestamp("2026-11-13 05:00", tz="UTC")
    assert a.last_ts("SPY", "5m", "ibkr") is None


def test_the_backup_is_a_whole_copy(tmp_path):
    a = Archive(tmp_path / "a.sqlite")
    a.upsert_candles("SPY", "1d", "ibkr", frame("2026-11-10 05:00", 3))
    dest = a.backup(tmp_path / "OneDrive" / "StockWizard")
    assert Archive(dest).count() == 3


# --- the data program ---

class FakeSource:
    name = "ibkr"

    def __init__(self, fail=()):
        self.asked, self.fail = [], set(fail)

    def fetch(self, symbol, timeframe, start, end):
        self.asked.append((symbol, timeframe, start))
        if symbol in self.fail:
            raise ValueError("no data")
        freq = {"1d": "1D", "1h": "1h", "5m": "5min", "1m": "1min"}[timeframe]
        first = pd.Timestamp(start).tz_localize("America/New_York").tz_convert("UTC")
        return frame(first, int((NOW - first) / pd.Timedelta(freq)), freq)


class FakeStore:
    def __init__(self):
        self.candles, self.deleted, self.symbols = {}, [], []

    def upsert_symbols(self, rows):
        self.symbols = list(rows)

    def upsert_candles(self, symbol, tf, source, df):
        self.candles[(symbol, tf)] = df
        return len(df)

    def delete(self, table, match):
        self.deleted.append((table, match))


SYMS = [{"symbol": "SPY"}, {"symbol": "^VIX"}]


def test_the_first_run_fetches_full_depth_and_sends_supabase_only_its_window(tmp_path):
    src, store = FakeSource(), FakeStore()
    r = DataRunner(src, Archive(tmp_path / "a.sqlite"), store, SYMS, clock=lambda: NOW, log=lambda *_: None)
    assert r.catch_up() == 0
    assert ("SPY", "1d", date(1990, 11, 27)) in src.asked                      # 36 years into the archive (as far as IBKR goes)
    assert r.archive.read("SPY", "1d", "ibkr").index[0].year == 1990
    assert store.candles[("SPY", "1d")].index[0] >= NOW - pd.Timedelta(days=365 * 5)   # 5 years to Supabase
    assert store.candles[("SPY", "5m")].index[0] >= NOW - pd.Timedelta(days=60)


def test_a_later_run_only_fetches_from_just_before_the_last_candle(tmp_path):
    src, store = FakeSource(), FakeStore()
    r = DataRunner(src, Archive(tmp_path / "a.sqlite"), store, SYMS, clock=lambda: NOW, log=lambda *_: None)
    r.catch_up()
    src.asked.clear()
    r.catch_up()
    starts = {(s, tf): d for s, tf, d in src.asked}
    assert starts[("SPY", "1d")] == date(2026, 11, 12)                          # last candle 17 Nov, less 5 days


def test_supabase_is_trimmed_to_the_window_for_ibkr_candles_only(tmp_path):
    store = FakeStore()
    DataRunner(FakeSource(), Archive(tmp_path / "a.sqlite"), store, SYMS, clock=lambda: NOW, log=lambda *_: None).catch_up()
    assert ("candles", {"source": "eq.ibkr", "timeframe": "eq.5m", "ts": "lt.2026-09-19T00:00:00+00:00"}) in store.deleted
    assert all(m["source"] == "eq.ibkr" for _, m in store.deleted)             # the long Yahoo history stays


def test_one_symbol_failing_doesnt_stop_the_rest(tmp_path):
    store = FakeStore()
    r = DataRunner(FakeSource(fail={"^VIX"}), Archive(tmp_path / "a.sqlite"), store, SYMS, clock=lambda: NOW, log=lambda *_: None)
    assert r.catch_up() == 4, "the failing symbol fails once per timeframe (1d, 1h, 5m, 1m)"
    assert ("SPY", "1d") in store.candles


def test_after_close_is_due_once_on_a_trading_day():
    r = DataRunner(FakeSource(), None, FakeStore(), SYMS, clock=lambda: NOW, log=lambda *_: None)
    assert r.after_close_due(None) == date(2026, 11, 18)
    assert r.after_close_due(date(2026, 11, 18)) is None
    r.clock = lambda: pd.Timestamp("2026-11-18 20:00", tz="UTC")              # 15:00 New York: not yet
    assert r.after_close_due(None) is None
    r.clock = lambda: pd.Timestamp("2026-11-21 22:00", tz="UTC")              # Saturday
    assert r.after_close_due(None) is None


# --- reading one source, never two mixed ---

class RowStore:
    def __init__(self, rows):
        self.rows = rows

    def select(self, table, q):
        src = q.get("source", "").removeprefix("eq.")
        return [r for r in self.rows if not src or r.get("source") == src]


def test_ibkr_candles_are_read_when_there_are_any_and_never_mixed_with_yahoos():
    both = RowStore([{"close": 1, "source": "yahoo-unofficial"}, {"close": 2, "source": "ibkr"}])
    assert select_preferred(both, "candles", {}) == [{"close": 2, "source": "ibkr"}]
    yahoo = RowStore([{"close": 1, "source": "yahoo-unofficial"}])
    assert select_preferred(yahoo, "candles", {}) == [{"close": 1, "source": "yahoo-unofficial"}]


def test_supabase_delete_refuses_to_empty_a_table():
    store = SupabaseStore(url="https://x.supabase.co", key="k", send=lambda *a: (204, b""))
    with pytest.raises(ValueError):
        store.delete("candles", {})
