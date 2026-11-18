"""Live bars from streamed prices, against a stand-in IBKR and Supabase. Made-up prices only."""

from __future__ import annotations

from types import SimpleNamespace

import pandas as pd

from stockwizard.data.live import LiveFeed, MinuteBars, in_session, streaming

T = lambda s: pd.Timestamp(s, tz="America/New_York").tz_convert("UTC")  # noqa: E731 - New York time to UTC


# --- the session ---

def test_the_session_is_930_to_1600_new_york_on_weekdays():
    assert not in_session(T("2026-11-18 09:29:59"))
    assert in_session(T("2026-11-18 09:30")) and in_session(T("2026-11-18 15:59:59"))
    assert not in_session(T("2026-11-18 16:00")) and not in_session(T("2026-11-21 11:00"))   # Saturday


def test_streaming_runs_on_trading_days_until_delayed_prices_catch_up():
    assert streaming(T("2026-11-18 09:30")) and streaming(T("2026-11-18 16:19"))
    assert not streaming(T("2026-11-18 16:20")) and not streaming(T("2026-11-26 11:00"))      # Thanksgiving


# --- minute bars ---

def test_samples_in_one_minute_make_one_bar_and_a_new_minute_starts_another():
    b = MinuteBars()
    for s, p in (("10:00:01", 100.0), ("10:00:20", 101.5), ("10:00:40", 99.5), ("10:00:59", 100.2), ("10:01:00", 100.4)):
        b.update("SPY", T(f"2026-11-18 {s}"), p)
    first = b.bars[("SPY", T("2026-11-18 10:00"))]
    assert (first["open"], first["high"], first["low"], first["close"]) == (100.0, 101.5, 99.5, 100.2)
    assert b.bars[("SPY", T("2026-11-18 10:01"))]["open"] == 100.4


def test_volume_is_what_the_days_running_total_grew_by():
    b = MinuteBars()
    b.update("SPY", T("2026-11-18 10:00:01"), 100.0, day_volume=5000)    # the first total only sets the baseline
    b.update("SPY", T("2026-11-18 10:00:30"), 100.1, day_volume=5300)
    b.update("SPY", T("2026-11-18 10:01:05"), 100.2, day_volume=5450)
    assert b.bars[("SPY", T("2026-11-18 10:00"))]["volume"] == 300
    assert b.bars[("SPY", T("2026-11-18 10:01"))]["volume"] == 150


def test_no_price_or_a_price_outside_the_session_is_left_out():
    b = MinuteBars()
    assert not b.update("SPY", T("2026-11-18 10:00"), float("nan"))
    assert not b.update("SPY", T("2026-11-18 10:00"), -1)                 # IBKR's "no value"
    assert not b.update("SPY", T("2026-11-18 16:05"), 100.0)
    assert not b.bars


def test_only_changed_bars_are_written():
    b = MinuteBars()
    b.update("SPY", T("2026-11-18 10:00:01"), 100.0)
    assert len(b.take_dirty()) == 1 and b.take_dirty() == []
    b.update("SPY", T("2026-11-18 10:00:30"), 100.5)
    (row,) = b.take_dirty()
    assert row["close"] == 100.5 and row["ts"] == T("2026-11-18 10:00").isoformat() and row["delayed"] is False


# --- the feed ---

class FakeIB:
    def __init__(self, tickers):
        self.tickers, self.data_type, self.cancelled = tickers, None, []

    def reqMarketDataType(self, t):
        self.data_type = t

    def reqMktData(self, contract, *a):
        return self.tickers[contract]

    def cancelMktData(self, contract):
        self.cancelled.append(contract)


class FakeSource:
    name = "ibkr"

    def __init__(self, tickers):
        self.ib, self.fetched = FakeIB(tickers), []

    def contract(self, sym):
        return sym

    def fetch(self, sym, tf, start, end):
        self.fetched.append((sym, tf, start))
        idx = pd.DatetimeIndex([T("2026-11-18 10:00"), T("2026-11-18 10:05")])
        return pd.DataFrame({"open": 1.0, "high": 1.0, "low": 1.0, "close": 1.0, "volume": 0.0}, index=idx)


class FakeStore:
    def __init__(self):
        self.upserts, self.deleted, self.candles = [], [], []

    def upsert(self, table, on_conflict, rows):
        self.upserts.append((table, on_conflict, rows))

    def delete(self, table, match):
        self.deleted.append((table, match))

    def upsert_candles(self, sym, tf, src, df):
        self.candles.append((sym, tf, len(df)))
        return len(df)


class FakeArchive:
    def __init__(self):
        self.saved = []

    def upsert_candles(self, *a):
        self.saved.append(a[:2])


def ticker(last, volume=None, data_type=1):
    return SimpleNamespace(last=last, volume=volume, marketDataType=data_type, marketPrice=lambda: last)


def feed(tickers, at):
    clock = {"t": T(at)}
    f = LiveFeed(FakeSource(tickers), FakeStore(), FakeArchive(), list(tickers), clock=lambda: clock["t"], log=lambda *_: None)
    return f, clock


def test_starting_asks_for_live_or_delayed_prices_and_clears_yesterdays_bars():
    f, _ = feed({"SPY": ticker(600.0), "^VIX": ticker(18.0)}, "2026-11-18 09:30:05")
    f.start()
    assert f.source.ib.data_type == 3 and set(f.tickers) == {"SPY", "^VIX"}
    assert f.store.deleted == [("live_bars", {"ts": f"lt.{T('2026-11-18 00:00').isoformat()}"})]


def test_a_delayed_price_goes_in_the_bar_when_it_really_traded_and_is_marked():
    f, _ = feed({"SPY": ticker(600.0, data_type=3)}, "2026-11-18 10:20:10")
    f.tick()
    (_, _, rows) = f.store.upserts[0]
    assert rows[0]["ts"] == T("2026-11-18 10:05").isoformat() and rows[0]["delayed"] is True


def test_bars_are_written_every_five_seconds_not_every_sample():
    f, clock = feed({"SPY": ticker(600.0)}, "2026-11-18 10:00:01")
    f.tick()
    for s in range(2, 6):                       # 4 more samples inside 5 seconds
        clock["t"] = T(f"2026-11-18 10:00:0{s}")
        f.tick()
    assert len([u for u in f.store.upserts if u[0] == "live_bars"]) == 1
    clock["t"] = T("2026-11-18 10:00:07")
    f.tick()
    assert len([u for u in f.store.upserts if u[0] == "live_bars"]) == 2
    assert f.store.upserts[0][1] == "symbol,ts"


def test_finished_5_minute_candles_are_fetched_once_each_5_minutes():
    f, clock = feed({"SPY": ticker(600.0)}, "2026-11-18 10:05:05")
    f.tick()
    assert not f.source.fetched                 # too soon after the mark: IBKR may not have the bar yet
    clock["t"] = T("2026-11-18 10:05:20")
    f.tick()
    clock["t"] = T("2026-11-18 10:06:00")
    f.tick()
    assert f.source.fetched == [("SPY", "5m", T("2026-11-18 10:05").tz_convert("America/New_York").date())]
    assert f.store.candles == [("SPY", "5m", 2)] and f.archive.saved == [("SPY", "5m")]


def test_stopping_cancels_the_streams_and_writes_the_last_bars():
    f, clock = feed({"SPY": ticker(600.0)}, "2026-11-18 15:59:58")
    f.tick()
    clock["t"] = T("2026-11-18 15:59:59")
    f.sample()
    f.stop()
    assert f.source.ib.cancelled == ["SPY"] and not f.tickers
    assert len([u for u in f.store.upserts if u[0] == "live_bars"]) == 2
