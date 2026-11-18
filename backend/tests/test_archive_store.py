"""Backtests reading the archive on the PC, with made-up candles. Nothing leaves the machine."""

from __future__ import annotations

import pandas as pd

from stockwizard.data.archive import Archive
from stockwizard.data.archive_store import STITCHED, ArchiveStore, joined, repair, to_ny_midnight
from stockwizard.run_backtests import read_range


def daily(stamps, close=100.0):
    idx = pd.DatetimeIndex([pd.Timestamp(s, tz="UTC") for s in stamps])
    return pd.DataFrame({"open": close, "high": close + 1, "low": close - 1, "close": close, "volume": 10.0}, index=idx)


class Supabase:
    def __init__(self):
        self.asked = []

    def select(self, table, q):
        self.asked.append(table)
        return [{"id": "s1"}]

    def insert(self, table, rows, returning=False):
        self.asked.append(("insert", table))
        return [{"id": 1}]


def archive(tmp_path):
    a = Archive(tmp_path / "a.sqlite")
    # Yahoo's VIX from 2004, stamped at midnight Chicago (06:00 UTC in winter); IBKR's from Oct 2005, at midnight New York.
    a.upsert_candles("^VIX", "1d", "yahoo-unofficial", daily(["2004-12-01 06:00", "2005-09-30 05:00", "2005-10-03 05:00"], close=15.0))
    a.upsert_candles("^VIX", "1d", "ibkr", daily(["2005-10-03 04:00", "2005-10-04 04:00"], close=16.0))
    return a


def test_yahoos_days_are_restamped_to_midnight_new_york():
    idx = to_ny_midnight(pd.DatetimeIndex([pd.Timestamp("2004-12-01 06:00", tz="UTC"), pd.Timestamp("2005-07-01 05:00", tz="UTC")]))
    assert list(idx) == [pd.Timestamp("2004-12-01 05:00", tz="UTC"), pd.Timestamp("2005-07-01 04:00", tz="UTC")]


def test_ibkrs_candles_with_yahoo_only_before_ibkrs_first(tmp_path):
    df = joined(archive(tmp_path), "^VIX", "1d", None, None)
    assert [ts.date().isoformat() for ts in df.index] == ["2004-12-01", "2005-09-30", "2005-10-03", "2005-10-04"]
    assert df.loc[pd.Timestamp("2005-10-03 04:00", tz="UTC"), "close"] == 16.0, "IBKR's own day wins: no day twice"
    assert df["close"].iloc[0] == 15.0


def test_a_backtest_reads_the_joined_history_and_says_so(tmp_path):
    store = ArchiveStore(Supabase(), archive(tmp_path))
    df, src = read_range(store, "^VIX", pd.Timestamp("2004-01-01", tz="UTC"), pd.Timestamp("2006-01-01", tz="UTC"))
    assert src == STITCHED and len(df) == 4
    df2, _ = read_range(store, "^VIX", pd.Timestamp("2005-01-01", tz="UTC"), pd.Timestamp("2005-10-04", tz="UTC"))
    assert [ts.date().isoformat() for ts in df2.index] == ["2005-09-30", "2005-10-03"], "the range is from and before"


def test_everything_but_candles_still_goes_to_supabase(tmp_path):
    inner = Supabase()
    store = ArchiveStore(inner, archive(tmp_path))
    assert store.select("strategies", {"select": "*"}) == [{"id": "s1"}]
    store.insert("backtest_runs", [{}], returning=True)
    assert inner.asked == ["strategies", ("insert", "backtest_runs")]


def test_ibkr_alone_is_still_there_for_repeating_a_run(tmp_path):
    store = ArchiveStore(Supabase(), archive(tmp_path))
    rows = store.select("candles", {"symbol": "eq.^VIX", "timeframe": "eq.1d", "source": "eq.ibkr", "order": "ts.desc", "limit": "1"})
    assert len(rows) == 1 and rows[0]["ts"].startswith("2005-10-04")


def test_bad_ticks_are_repaired_and_real_spikes_kept():
    idx = pd.DatetimeIndex([pd.Timestamp(d, tz="UTC") for d in ("2006-03-23 05:00", "2004-04-19 04:00", "2015-08-24 04:00")])
    df = pd.DataFrame({"open": [130.24, 113.55, 28.03], "high": [9130.03, 116.63, 53.29], "low": [129.66, 0.87, 28.03],
                       "close": [130.12, 113.79, 40.74], "volume": 1.0}, index=idx)
    out = repair(df)
    assert list(out["high"]) == [130.24, 116.63, 53.29], "SPY's 9,130 high becomes the open; the VIX's real 53.29 stays"
    assert list(out["low"]) == [129.66, 113.55, 28.03], "SPY's 0.87 low becomes the open"
    assert df["high"].iloc[0] == 9130.03, "the archive's own copy is untouched"


def test_the_store_serves_repaired_candles(tmp_path):
    a = Archive(tmp_path / "a.sqlite")
    a.upsert_candles("SPY", "1d", "ibkr", pd.DataFrame({"open": 130.24, "high": 9130.03, "low": 129.66, "close": 130.12, "volume": 1.0},
                                                        index=pd.DatetimeIndex([pd.Timestamp("2006-03-23 05:00", tz="UTC")])))
    rows = ArchiveStore(Supabase(), a).select("candles", {"symbol": "eq.SPY", "timeframe": "eq.1d", "source": f"eq.{STITCHED}"})
    assert rows[0]["high"] == 130.24
