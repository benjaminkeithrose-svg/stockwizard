"""Scan rules: worked examples, and the truncation test on every rule."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from stockwizard.scans import RULES, evaluate

from conftest import daily_index, intraday_index, make_candles
from test_truncation import assert_same


def closes(values, spread=0.5, volume=1000.0):
    values = np.asarray(values, dtype=float)
    idx = daily_index(len(values))
    return pd.DataFrame(
        {"open": values, "high": values + spread, "low": values - spread, "close": values, "volume": volume}, index=idx
    )


def last(df):
    return df.iloc[-1]


@pytest.mark.parametrize("rule", list(RULES))
@pytest.mark.parametrize("frame", ["intraday", "daily"])
def test_no_rule_looks_ahead(rule, frame, request):
    candles = request.getfixturevalue(frame)
    full = evaluate(rule, candles)
    assert full["hit"].notna().any()
    for k in sorted({30, len(candles) // 3, len(candles) // 2, len(candles) - 7, len(candles) - 1}):
        assert_same(full.drop(columns="direction"), evaluate(rule, candles.iloc[:k]).drop(columns="direction"), f"{rule} cut at {k}")
        cut = evaluate(rule, candles.iloc[:k])["direction"]
        assert (full["direction"].iloc[:k].fillna("") == cut.fillna("")).all(), f"{rule} direction changed at cut {k}"


def test_every_rule_fires_somewhere_on_made_up_history(daily):
    # The made-up history never falls 5%, so the drawdown rule is checked at 2%.
    easier = {"drawdown": {"pct": 2.0}}
    for rule in RULES:
        assert evaluate(rule, daily, **easier.get(rule, {}))["hit"].fillna(False).any(), rule


def test_breakout_up_and_down():
    flat = [100.0] * 25
    up = evaluate("breakout", closes(flat + [102.0]))
    assert bool(last(up)["hit"]) and last(up)["direction"] == "up"
    assert last(up)["level"] == pytest.approx(100.5)  # previous 20 candles' highest high
    down = evaluate("breakout", closes(flat + [98.0]))
    assert bool(last(down)["hit"]) and last(down)["direction"] == "down"
    inside = evaluate("breakout", closes(flat + [100.4]))
    assert not bool(last(inside)["hit"])
    assert evaluate("breakout", closes([100.0] * 10))["hit"].isna().all()  # warming up


def test_breakout_volume_filter():
    df = closes([100.0] * 25 + [102.0])
    df.iloc[-1, df.columns.get_loc("volume")] = 1200.0  # 1.2x average
    assert not bool(last(evaluate("breakout", df, volume_mult=1.5))["hit"])
    df.iloc[-1, df.columns.get_loc("volume")] = 2000.0
    assert bool(last(evaluate("breakout", df, volume_mult=1.5))["hit"])


def test_trend_break_fires_once_on_the_cross():
    values = [100.0] * 50 + [101.0] * 5 + [90.0, 89.0]
    out = evaluate("trend_break", closes(values))
    hits = out.index[out["hit"].fillna(False).to_numpy(dtype=bool)]
    assert list(hits) == [out.index[55]]
    assert out["direction"].iloc[55] == "down"
    assert out["below_by_pct"].iloc[55] < 0


def test_drawdown_threshold_and_first_day():
    values = [100.0] * 60 + [97.0, 95.0, 94.0, 96.0]
    out = evaluate("drawdown", closes(values))
    assert not bool(out["hit"].iloc[60])  # 3% down
    assert bool(out["hit"].iloc[61]) and out["first_day"].iloc[61] == 1  # 5% down: first day
    assert bool(out["hit"].iloc[62]) and out["first_day"].iloc[62] == 0
    assert not bool(out["hit"].iloc[63])  # back to 4% down
    assert out["drawdown_pct"].iloc[62] == pytest.approx(-6.0)


def test_rsi_divergence_on_a_tiring_rally():
    # A strong rally to a high, a dip, then a slow creep to a marginally higher high: weaker momentum.
    rally = list(np.linspace(100, 130, 30))
    dip = list(np.linspace(129, 120, 10))
    creep = list(np.linspace(120.5, 130.5, 25))
    out = evaluate("rsi_divergence", closes(rally + dip + creep, spread=0.2))
    fired = out[out["hit"].fillna(False).to_numpy(dtype=bool)]
    assert len(fired) >= 1
    row = fired.iloc[-1]
    assert row["rsi"] <= row["earlier_rsi"] - 2


def test_no_divergence_on_a_steady_rally():
    out = evaluate("rsi_divergence", closes(np.linspace(100, 200, 120), spread=0.2))
    assert not out["hit"].fillna(False).any()


def test_squeeze_on_counts_the_run(daily):
    out = evaluate("squeeze_on", daily)
    on = out["hit"].fillna(False).to_numpy(dtype=bool)
    i = int(np.flatnonzero(on)[-1])
    j = i
    while j > 0 and on[j - 1]:
        j -= 1
    assert out["candles_on"].iloc[i] == i - j + 1


def test_rules_work_on_intraday_candles():
    df = make_candles(intraday_index(days=3))
    for rule in RULES:
        assert len(evaluate(rule, df)) == len(df)
