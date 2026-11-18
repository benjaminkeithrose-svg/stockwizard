"""The pretend bot's market reads today's 5-minute candles from Supabase (Yahoo removed, 18 Nov 2026). Made-up rows only."""

from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

from stockwizard.strategy_runner import PretendMarket

NY = ZoneInfo("America/New_York")


class Rows:
    def __init__(self, rows):
        self.rows, self.asked = rows, []

    def select(self, table, q):
        self.asked.append(q)
        return self.rows if q.get("source") == "eq.ibkr" else []


def bar(ts, close):
    return {"ts": ts, "open": close, "high": close + 1, "low": close - 1, "close": close, "volume": 100}


def test_todays_bars_come_from_the_stored_ibkr_candles():
    store = Rows([bar("2026-11-18T14:30:00+00:00", 600.0), bar("2026-11-18T14:35:00+00:00", 601.0)])
    df = PretendMarket(store).bars_today("SPY", datetime(2026, 11, 18, 9, 45, tzinfo=NY))
    assert list(df["close"]) == [600.0, 601.0] and str(df.index.tz) == "America/New_York"
    assert store.asked[0]["and"] == "(ts.gte.2026-11-18T05:00:00+00:00,ts.lt.2026-11-19T05:00:00+00:00)", "midnight to midnight New York"


def test_no_bars_yet_is_none():
    assert PretendMarket(Rows([])).bars_today("SPY", datetime(2026, 11, 18, 9, 45, tzinfo=NY)) is None
