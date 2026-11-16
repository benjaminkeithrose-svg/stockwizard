"""The scanner's runner, against a fake database holding made-up candles. Nothing leaves the machine."""

from __future__ import annotations

import json
import urllib.parse

import pandas as pd
import pytest

from stockwizard.data.store import SupabaseStore
from stockwizard.scan import Scanner, apply_scan, candles_fingerprint

from conftest import daily_index, make_candles


class FakeSupabase:
    """Answers the few REST calls the scanner makes, from memory."""

    def __init__(self, candles: dict[str, pd.DataFrame], scans: list[dict], universe: list[str] | None = None):
        self.candles = candles
        self.tables = {"scans": scans, "scan_runs": [], "scan_results": [], "symbols": [
            {"symbol": s, "tradable": True} for s in candles if not s.startswith("^")]}
        self.universe = universe

    def __call__(self, method, url, headers, body):
        path, _, qs = url.partition("?")
        table = path.rsplit("/", 1)[-1]
        q = dict(urllib.parse.parse_qsl(qs))
        if method == "POST":
            rows = json.loads(body)
            if table == "scan_runs":
                for r in rows:
                    r["id"] = len(self.tables["scan_runs"]) + 1
            self.tables[table].extend(rows)
            return 201, json.dumps(rows).encode()
        if table == "candles":
            if int(q["offset"]) > 0:
                return 200, b"[]"
            df = self.candles.get(q["symbol"][3:], pd.DataFrame())
            if df.empty or q["source"] != "eq.yahoo-unofficial":
                return 200, b"[]"
            before = pd.Timestamp(q["ts"][3:])
            df = df[df.index < before].iloc[::-1].iloc[: int(q["limit"])]
            rows = [{"ts": ts.isoformat(), **{k: float(v) for k, v in r.items()}} for ts, r in df.iterrows()]
            return 200, json.dumps(rows).encode()
        if table == "watchlists":
            return 200, json.dumps([{"id": 1, "watchlist_symbols": [{"symbol": s} for s in self.universe]}] if self.universe else []).encode()
        rows = self.tables[table]
        if "id" in q:
            rows = [r for r in rows if str(r["id"]) == q["id"][3:]]
        if q.get("tradable") == "eq.true":
            rows = [r for r in rows if r["tradable"]]
        return 200, json.dumps(rows if int(q.get("offset", 0)) == 0 else []).encode()


SCANS = [
    {"id": "squeeze_on_1d", "rule": "squeeze_on", "timeframe": "1d", "params": {}, "symbols": None, "context": [], "enabled": True},
    {"id": "breakout_1d", "rule": "breakout", "timeframe": "1d", "params": {"length": 20}, "symbols": None, "context": [], "enabled": True},
    {"id": "spy_drawdown", "rule": "drawdown", "timeframe": "1d", "params": {"pct": 1}, "symbols": ["SPY"], "context": ["^VIX"], "enabled": True},
]


@pytest.fixture
def fake():
    idx = daily_index(300)
    candles = {name: make_candles(idx, seed=i) for i, name in enumerate(["AAA", "BBB", "CCC", "SPY", "^VIX"])}
    return FakeSupabase(candles, SCANS)


def scanner(fake):
    return Scanner(SupabaseStore("https://example.supabase.co", "k", send=fake))


AS_OF = daily_index(300)[-1] + pd.Timedelta(days=1)


def test_run_saves_a_run_per_scan_and_only_fired_symbols(fake):
    report = scanner(fake).run(AS_OF)
    assert len(report) == 3 and len(fake.tables["scan_runs"]) == 3
    for run in fake.tables["scan_runs"]:
        assert run["data_hash"] and run["result_hash"] and run["rule_version"].endswith("@1")
        saved = [r for r in fake.tables["scan_results"] if r["run_id"] == run["id"]]
        assert run["matches"] == len(saved)
    spy = next(r for r in fake.tables["scan_runs"] if r["scan_id"] == "spy_drawdown")
    assert spy["symbols"] == ["SPY"]
    assert sorted(next(r for r in fake.tables["scan_runs"] if r["scan_id"] == "breakout_1d")["symbols"]) == ["AAA", "BBB", "CCC", "SPY"]


def test_results_match_the_rule_on_the_last_candle(fake):
    scanner(fake).run(AS_OF, ["breakout_1d"])
    from stockwizard.scans import evaluate
    expected = sorted(s for s in ["AAA", "BBB", "CCC", "SPY"] if bool(evaluate("breakout", fake.candles[s]).iloc[-1]["hit"]))
    assert sorted(r["symbol"] for r in fake.tables["scan_results"]) == expected


def test_context_carries_the_vix_close(fake):
    scanner(fake).run(AS_OF, ["spy_drawdown"])
    for r in fake.tables["scan_results"]:
        assert r["context"]["^VIX"] == pytest.approx(fake.candles["^VIX"]["close"].iloc[-1], rel=1e-9)


def test_a_run_reproduces(fake):
    s = scanner(fake)
    s.run(AS_OF)
    for run in list(fake.tables["scan_runs"]):
        assert "identical" in s.rerun(run["id"])
    assert sum(r["trigger"] == "rerun" for r in fake.tables["scan_runs"]) == 3


def test_rerun_notices_changed_candles(fake):
    s = scanner(fake)
    s.run(AS_OF, ["breakout_1d"])
    fake.candles["AAA"].iloc[-5, fake.candles["AAA"].columns.get_loc("close")] *= 1.0001
    assert "changed" in s.rerun(1)


def test_as_of_in_the_past_ignores_later_candles(fake):
    early = daily_index(300)[200]
    scanner(fake).run(early, ["breakout_1d"])
    for r in fake.tables["scan_results"]:
        assert pd.Timestamp(r["candle_ts"]) < early


def test_universe_watchlist_wins_over_all_tradable(fake):
    fake.universe = ["BBB"]
    scanner(fake).run(AS_OF, ["breakout_1d"])
    assert fake.tables["scan_runs"][0]["symbols"] == ["BBB"]


def test_old_or_missing_data_is_left_out_and_noted():
    idx = daily_index(100)
    frames = {"OLD": make_candles(idx), "NEW": make_candles(idx, seed=3), "NONE": make_candles(idx).iloc[:0]}
    as_of = idx[-1] + pd.Timedelta(days=1)
    frames["OLD"] = frames["OLD"].iloc[:-20]
    _, skipped = apply_scan("breakout", "1d", {"length": 20, "volume_mult": 0}, frames, as_of)
    assert skipped == ["NONE", "OLD"]


def test_fingerprint_changes_with_any_candle():
    df = make_candles(daily_index(30))
    a = candles_fingerprint({"X": df})
    df2 = df.copy()
    df2.iloc[3, 0] += 0.01
    assert a != candles_fingerprint({"X": df2})
    assert a == candles_fingerprint({"X": df.copy()})


def test_vix_context_is_the_same_days_close_even_when_stamped_an_hour_later():
    idx = daily_index(100)
    spy = make_candles(idx, seed=1)
    vix = make_candles(idx, seed=2, start=15.0)
    vix.index = vix.index + pd.Timedelta(hours=1)  # Chicago midnight
    as_of = idx[-1] + pd.Timedelta(days=1)
    results, _ = apply_scan("drawdown", "1d", {"lookback": 60, "pct": 0.0}, {"SPY": spy}, as_of, {"^VIX": vix})
    assert results and results[0]["context"]["^VIX"] == pytest.approx(vix["close"].iloc[-1], rel=1e-9)
