"""The pattern lab: measures don't look ahead, the statistics are right, a planted pattern is found,
noise is not, and the sealed years never influence the search."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from stockwizard.features import FEATURES, build, outcome
from stockwizard.lab import Condition, Settings, binom_tail, bh_qvalues, episodes, study

from conftest import daily_index, make_candles
from test_truncation import assert_same

N = 2600
IDX = daily_index(N, first="2008-01-02")
SPLIT = IDX[2000]


def frames(seed=1, plant=True):
    """Made-up SPY, VIX and 3-month VIX. With `plant`, the VIX jumps 50% two days after any 2%+ SPY drop over 5 days."""
    rng = np.random.default_rng(seed)
    spy = make_candles(IDX, seed=seed)
    v = 15 + np.cumsum(rng.normal(0, 0.3, N))
    v = np.clip(v, 10, 40)
    if plant:
        r5 = spy["close"].pct_change(5).to_numpy()
        for i in np.flatnonzero(r5 <= -0.02):
            if i + 2 < N:
                v[i + 2] = v[i] * 1.5
    vix = pd.DataFrame({"open": v, "high": v * 1.01, "low": v * 0.99, "close": v, "volume": 0.0}, index=IDX)
    v3 = v * 0.95 + 1
    vix3m = pd.DataFrame({"open": v3, "high": v3, "low": v3, "close": v3, "volume": 0.0}, index=IDX)
    return spy, vix, vix3m


def test_measures_do_not_look_ahead():
    spy, vix, vix3m = frames()
    full = build(spy, vix, vix3m)
    assert set(full.columns) == set(FEATURES)
    for k in (300, 1200, N - 3):
        assert_same(full, build(spy.iloc[:k], vix.iloc[:k], vix3m.iloc[:k]), f"measures cut at {k}")


def test_outcome_looks_only_at_the_next_days():
    v = np.full(30, 10.0)
    v[5] = 14.0  # the high on day 5
    vix = pd.DataFrame({"open": v, "high": v, "low": v, "close": v, "volume": 0.0}, index=daily_index(30))
    y = outcome(vix, vix.index, 30, 3)
    assert list(y.iloc[1:6]) == [0.0, 1.0, 1.0, 1.0, 0.0]  # days 2-4 see day 5 within 3 days; day 5 itself doesn't
    assert np.isnan(y.iloc[-1])


def test_binomial_tail_and_fdr():
    assert binom_tail(0, 10, 0.3) == 1.0
    assert binom_tail(10, 10, 0.5) == pytest.approx(0.5**10)
    assert binom_tail(3, 10, 0.2) == pytest.approx(1 - sum(
        __import__("math").comb(10, i) * 0.2**i * 0.8 ** (10 - i) for i in range(3)))
    q = bh_qvalues([0.01, 0.04, 0.03, 0.5])
    # Sorted 0.01, 0.03, 0.04, 0.5 -> raw 0.04, 0.06, 0.0533, 0.5 -> kept in order from the top: 0.04, 0.0533, 0.0533, 0.5
    assert q == pytest.approx([0.04, 0.16 / 3, 0.16 / 3, 0.5], rel=1e-6)


def test_episodes_count_each_run_once():
    m = np.array([0, 1, 1, 1, 0, 1, 0, 0, 1, 1], dtype=bool)
    assert list(np.flatnonzero(episodes(m))) == [1, 5, 8]


def test_condition_words():
    assert Condition("spy_vs_sma50", "<=", -3.21, 10).text() == "SPY 3.21% or more below its 50-day average"
    assert Condition("vix_level", ">=", 22.456, 90).text() == "VIX at or above 22.5"
    assert Condition("spy_squeeze_on", "flag", 1).text() == "SPY squeeze on"


def test_finds_the_planted_pattern_and_proves_it_on_the_sealed_years():
    spy, vix, vix3m = frames(plant=True)
    out = study(spy, vix, vix3m, IDX[250], SPLIT, Settings(rise_pct=30, days=5, min_episodes=15))
    c = out["counts"]
    assert c["tried"] > 1000 and c["survivors"] >= 1
    surv = [x for x in out["tried"] if x.status == "survivor"]
    assert any(any(cond.feature in ("spy_ret_5", "spy_ret_10", "spy_dd_20") for cond in s.conds) for s in surv)
    best = surv[0]
    assert best.lift > 2 and best.q <= 0.05
    assert best.sealed["trades"] > 0 and best.sealed["rate"] > best.sealed["base_rate"]


def test_noise_gives_no_or_few_survivors():
    spy, vix, vix3m = frames(seed=3, plant=False)
    out = study(spy, vix, vix3m, IDX[250], SPLIT, Settings(rise_pct=30, days=5, min_episodes=15))
    assert out["counts"]["survivors"] <= 1


def test_sealed_years_never_change_the_search():
    spy, vix, vix3m = frames(plant=True)
    s = Settings(rise_pct=30, days=5, min_episodes=15)
    a = study(spy, vix, vix3m, IDX[250], SPLIT, s)
    # Scramble everything in the sealed years.
    vix2 = vix.copy()
    vix2.loc[vix2.index >= SPLIT, ["open", "high", "low", "close"]] *= 3.0
    b = study(spy, vix2, vix3m, IDX[250], SPLIT, s)
    da = [(x.text(), x.episodes, x.hits, x.status) for x in a["tried"]]
    db = [(x.text(), x.episodes, x.hits, x.status) for x in b["tried"]]
    assert da == db


def test_symbols_line_up_by_trading_date_not_clock_time():
    """The VIX's daily candles are stamped at midnight Chicago, SPY's at midnight New York: an hour apart."""
    spy, vix, vix3m = frames()
    vix_chicago = vix.copy()
    vix_chicago.index = vix.index + pd.Timedelta(hours=1)
    a, b = build(spy, vix, vix3m), build(spy, vix_chicago, vix3m)
    assert b["vix_level"].notna().sum() == a["vix_level"].notna().sum() > 0
    assert (a["vix_level"].dropna() == b["vix_level"].dropna()).all()
    assert outcome(vix_chicago, spy.index, 30, 5).notna().sum() == outcome(vix, spy.index, 30, 5).notna().sum()


def test_identical_thresholds_count_once():
    from stockwizard.lab import conditions
    f = pd.DataFrame({k: np.zeros(100) for k in FEATURES})
    f["spy_down_days"] = np.r_[np.zeros(80), np.ones(20)]
    conds = [c for c in conditions(f) if c.feature == "spy_down_days"]
    assert len({(c.op, c.value) for c in conds}) == len(conds)
    assert Condition("spy_down_days", "<=", 0.0, 10).text() == "SPY closed up today"


# --- traditional patterns, linked symbols and the SPY questions (19 Nov 2026) ---

def linked_frames():
    return {"NVDA": make_candles(IDX, seed=21, start=40.0), "TSLA": make_candles(IDX[700:], seed=22, start=20.0)}


def test_linked_symbols_and_patterns_do_not_look_ahead():
    spy, vix, vix3m = frames()
    linked = linked_frames()
    full = build(spy, vix, vix3m, linked)
    assert {"spy_bull_flag", "nvda_rel_5", "nvda_corr_20", "tsla_breakout_20"} <= set(full.columns)
    assert full["tsla_ret_5"].iloc[:690].isna().all(), "no Tesla candles yet: no reading, never a made-up one"
    assert full["qqq_rsi"].isna().all(), "a linked symbol with no candles at all just has no readings"
    for k in (900, 1800, N - 3):
        cut = {sym: df[df.index < IDX[k]] for sym, df in linked.items()}
        assert_same(full, build(spy.iloc[:k], vix.iloc[:k], vix3m.iloc[:k], cut), f"linked measures cut at {k}")


def test_relative_strength_is_the_linked_move_less_spys():
    spy, vix, vix3m = frames()
    linked = linked_frames()
    f = build(spy, vix, vix3m, linked)
    i = 1500
    assert f["nvda_rel_5"].iloc[i] == pytest.approx(f["nvda_ret_5"].iloc[i] - f["spy_ret_5"].iloc[i])
    assert -1 <= f["nvda_corr_20"].dropna().min() and f["nvda_corr_20"].dropna().max() <= 1


def test_the_spy_questions_look_up_and_down_and_only_ahead():
    from stockwizard.features import spy_outcome
    from stockwizard.lab import upside_down
    rows = [(100.0, 100.5, 99.5, 100.0)] * 10 + [(100.0, 102.5, 99.0, 101.0)] + [(100.0, 100.5, 97.5, 98.0)] + [(100.0, 100.5, 99.5, 100.0)] * 5
    idx = daily_index(len(rows))
    o, h, l, c = zip(*rows)
    spy = pd.DataFrame({"open": o, "high": h, "low": l, "close": c, "volume": 1.0}, index=idx)
    up, down = spy_outcome(spy, 2.0, 3, up=True), spy_outcome(spy, 2.0, 3, up=False)
    assert up.iloc[9] == 1 and up.iloc[10] == 0, "day 9's next 3 days reach +2.5%; day 10's own high doesn't count for day 10"
    assert down.iloc[9] == 1 and down.iloc[12] == 0
    assert up.iloc[-3:].isna().all(), "the last days have no full window: unknown, not no"
    inv = upside_down(spy)
    assert inv["high"].iloc[11] == pytest.approx(1 / 97.5) and inv["close"].iloc[11] == pytest.approx(1 / 98.0)


def test_a_spy_question_runs_end_to_end_and_tests_survivors_on_the_sealed_years():
    spy, vix, vix3m = frames(plant=False)
    out = study(spy, vix, vix3m, IDX[250], SPLIT, Settings(rise_pct=1.5, days=5, min_episodes=15, target="spy_down"), linked_frames())
    assert out["counts"]["tried"] > 1000
    for c in out["tried"]:
        if c.status == "survivor":
            assert "trades" in c.sealed
