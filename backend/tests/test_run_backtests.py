"""The backtest runner against a fake database with made-up candles. Nothing leaves the machine."""

from __future__ import annotations

import json
import re
import urllib.parse

import pandas as pd
import pytest

from stockwizard.data.store import SupabaseStore
from stockwizard.run_backtests import Backtester

from conftest import daily_index, make_candles

IDX = daily_index(1200, first="2015-01-02")
STRAT = {
    "id": "t1", "label": "Test", "family": "f", "version": 1, "enabled": True, "position": 0,
    "start_date": "2016-01-04", "split_date": "2018-06-01",
    "config": {"signal_symbol": "SPY", "signal_rule": "trend_break", "signal_params": {"length": 20},
               "trade_symbol": "^VIX", "target_pct": 10, "stop_pct": 5, "max_bars": 10, "cost_pct": 0, "study": True},
}


class Fake:
    def __init__(self):
        self.candles = {"SPY": make_candles(IDX, seed=1), "^VIX": make_candles(IDX, seed=2, start=15.0)}
        self.t = {"strategies": [dict(STRAT)], "backtest_runs": [], "backtest_trades": [], "backtest_metrics": []}

    def __call__(self, method, url, headers, body):
        path, _, qs = url.partition("?")
        table = path.rsplit("/", 1)[-1]
        q = dict(urllib.parse.parse_qsl(qs))
        if method == "POST":
            rows = json.loads(body)
            if table == "backtest_runs":
                for r in rows:
                    r["id"] = len(self.t["backtest_runs"]) + 1
            self.t[table].extend(rows)
            return 201, json.dumps(rows).encode()
        if int(q.get("offset", 0)) > 0:
            return 200, b"[]"
        if table == "candles":
            if q["source"] != "eq.yahoo-unofficial":
                return 200, b"[]"
            lo, hi = re.match(r"\(ts\.gte\.(.+),ts\.lt\.(.+)\)", q["and"]).groups()
            df = self.candles[q["symbol"][3:]]
            df = df[(df.index >= pd.Timestamp(lo)) & (df.index < pd.Timestamp(hi))]
            return 200, json.dumps([{"ts": ts.isoformat(), **{k: float(v) for k, v in r.items()}} for ts, r in df.iterrows()]).encode()
        rows = self.t[table]
        for key in ("id", "strategy_id"):
            if key in q:
                rows = [r for r in rows if str(r[key]) == q[key][3:]]
        if q.get("trigger") == "neq.rerun":
            rows = [r for r in rows if r["trigger"] != "rerun"]
        return 200, json.dumps(rows).encode()


@pytest.fixture
def fake():
    return Fake()


AS_OF = IDX[-1] + pd.Timedelta(days=1)


def test_a_run_saves_trades_and_metrics_for_both_periods(fake):
    lines = Backtester(SupabaseStore("https://x.supabase.co", "k", send=fake)).run(as_of=AS_OF)
    assert len(lines) == 1 and "run 1" in lines[0]
    run = fake.t["backtest_runs"][0]
    assert run["config_hash"] and run["data_hash"] and run["result_hash"] and not run["held_back_burned"]
    trades = fake.t["backtest_trades"]
    assert trades and {t["period"] for t in trades} == {"build", "held_back"}
    kinds = [m["kind"] for m in fake.t["backtest_metrics"]]
    assert kinds[:2] == ["build", "held_back"] and "window" in kinds
    build = fake.t["backtest_metrics"][0]["metrics"]
    assert build["trades"] == sum(1 for t in trades if t["period"] == "build" and t["exit_reason"] != "open")


def test_a_saved_run_repeats_exactly(fake):
    bt = Backtester(SupabaseStore("https://x.supabase.co", "k", send=fake))
    bt.run(as_of=AS_OF)
    assert "identical" in bt.rerun(1)


def test_changed_candles_are_reported_not_compared(fake):
    bt = Backtester(SupabaseStore("https://x.supabase.co", "k", send=fake))
    bt.run(as_of=AS_OF)
    fake.candles["^VIX"].iloc[600, 3] *= 1.001
    assert "changed" in bt.rerun(1)


def test_changing_settings_after_a_run_burns_the_held_back_period(fake):
    bt = Backtester(SupabaseStore("https://x.supabase.co", "k", send=fake))
    bt.run(as_of=AS_OF)
    bt.run(as_of=AS_OF)  # same settings: still a fair test
    assert not fake.t["backtest_runs"][1]["held_back_burned"]
    fake.t["strategies"][0]["config"] = {**STRAT["config"], "max_bars": 12}
    bt.run(as_of=AS_OF)
    assert fake.t["backtest_runs"][2]["held_back_burned"]
