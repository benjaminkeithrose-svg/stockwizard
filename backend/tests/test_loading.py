"""The loader and Supabase writer, with a fake source and a fake network. Nothing leaves the machine."""

from __future__ import annotations

import json
from pathlib import Path

import pandas as pd
import pytest

from stockwizard.data.store import SupabaseStore, candle_rows
from stockwizard.data.yahoo import to_candles
from stockwizard.load import read_symbols, run

from conftest import daily_index, intraday_index, make_candles

SYMBOLS_CSV = Path(__file__).parents[1] / "data" / "test_symbols.csv"


def yahoo_style(df: pd.DataFrame, tz="America/New_York") -> pd.DataFrame:
    raw = df.rename(columns=str.title)
    raw["Adj Close"] = raw["Close"] * 0.99
    raw.index = df.index.tz_convert(tz)
    return raw


def test_yahoo_frame_becomes_utc_candles_and_drops_the_unfinished_one():
    idx = intraday_index(days=1)
    df = make_candles(idx)
    now = idx[10] + pd.Timedelta(minutes=2)  # candle 10 still forming
    out = to_candles(yahoo_style(df), "5m", now=now)
    assert str(out.index.tz) == "UTC"
    assert len(out) == 10
    assert out.index[-1] == idx[9]
    assert list(out.columns) == ["open", "high", "low", "close", "volume"]


def test_yahoo_rejects_empty():
    with pytest.raises(ValueError):
        to_candles(pd.DataFrame(), "1d", now=pd.Timestamp.now(tz="UTC"))


def test_candle_rows_carry_source_and_version():
    df = make_candles(daily_index(3))
    rows = candle_rows("SPY", "1d", "yahoo-unofficial", df)
    assert len(rows) == 3
    assert rows[0]["ts"].endswith("+00:00")
    assert rows[0]["source"] == "yahoo-unofficial"
    assert rows[0]["source_version"].startswith("stockwizard-")


class FakeNet:
    def __init__(self, status=201):
        self.calls = []
        self.status = status

    def __call__(self, method, url, headers, body):
        self.calls.append((method, url, headers, json.loads(body)))
        return self.status


def test_store_upserts_in_batches_with_the_right_headers():
    net = FakeNet()
    store = SupabaseStore("https://example.supabase.co/", "sb_secret_test", send=net)
    df = make_candles(intraday_index(days=30))  # 2,340 candles -> 3 batches
    assert store.upsert_candles("SPY", "5m", "fake", df) == len(df)
    assert len(net.calls) == 3
    method, url, headers, body = net.calls[0]
    assert method == "POST"
    assert url == "https://example.supabase.co/rest/v1/candles?on_conflict=symbol,timeframe,source,ts"
    assert headers["apikey"] == "sb_secret_test" and "Authorization" not in headers
    assert "merge-duplicates" in headers["Prefer"]
    assert len(body) == 1000


def test_store_sends_bearer_for_legacy_jwt_key():
    net = FakeNet()
    SupabaseStore("https://x.supabase.co", "eyJfake", send=net).upsert_symbols([{"symbol": "SPY"}])
    assert net.calls[0][2]["Authorization"] == "Bearer eyJfake"


def test_store_raises_on_refusal():
    store = SupabaseStore("https://x.supabase.co", "k", send=FakeNet(status=401))
    with pytest.raises(RuntimeError, match="401"):
        store.upsert_symbols([{"symbol": "SPY"}])


def test_store_needs_credentials(monkeypatch):
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_SECRET_KEY", raising=False)
    with pytest.raises(RuntimeError, match="SUPABASE_URL"):
        SupabaseStore()


def test_symbol_list_reads_and_keeps_asx_watch_only():
    rows = read_symbols(SYMBOLS_CSV)
    assert {r["symbol"] for r in rows} >= {"SPY", "^VIX", "BHP.AX"}
    assert all(not r["tradable"] for r in rows if r["market"] == "ASX")


class FakeSource:
    name = "fake"
    validated = False

    def fetch(self, symbol, timeframe, start, end):
        if symbol == "MSFT":
            raise ConnectionError("source down")
        return make_candles(daily_index(50), seed=len(symbol))


def test_load_run_writes_symbols_then_candles_and_carries_on_after_a_failure(capsys):
    net = FakeNet()
    store = SupabaseStore("https://x.supabase.co", "k", send=net)
    failed = run(SYMBOLS_CSV, "1d", None, None, source=FakeSource(), store=store)
    assert failed == 1
    tables = [c[1].split("/rest/v1/")[1].split("?")[0] for c in net.calls]
    assert tables[0] == "symbols"
    assert tables.count("candles") == len(read_symbols(SYMBOLS_CSV)) - 1
    assert "MSFT: FAILED" in capsys.readouterr().err


def test_days_option_fetches_only_recent_candles(monkeypatch):
    import stockwizard.load as load
    from datetime import date, timedelta

    seen = {}
    monkeypatch.setattr(load, "run", lambda csv, tf, start, end: seen.update(tf=tf, start=start, end=end) or 0)
    assert load.main(["--symbols", str(SYMBOLS_CSV), "--timeframe", "5m", "--days", "7"]) == 0
    assert seen == {"tf": "5m", "start": date.today() - timedelta(days=7), "end": None}
    with pytest.raises(SystemExit):
        load.main(["--symbols", str(SYMBOLS_CSV), "--days", "7", "--start", "2020-01-01"])


def test_a_failed_symbol_makes_the_run_fail(monkeypatch):
    import stockwizard.load as load

    monkeypatch.setattr(load, "run", lambda *a: 1)
    assert load.main(["--symbols", str(SYMBOLS_CSV)]) == 1
