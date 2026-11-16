"""The backtest engine against hand-made price paths, one test per rule in SPEC.md."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from stockwizard.backtest import Strategy, Trade, _beta_binomial_range, metrics, report, run

from conftest import daily_index, make_candles

N = 100
IDX = daily_index(N)
START = IDX[0]


def frame(closes, highs=None, lows=None, opens=None):
    closes = np.asarray(closes, dtype=float)
    opens = closes if opens is None else np.asarray(opens, dtype=float)
    highs = np.maximum(opens, closes) if highs is None else np.asarray(highs, dtype=float)
    lows = np.minimum(opens, closes) if lows is None else np.asarray(lows, dtype=float)
    return pd.DataFrame({"open": opens, "high": highs, "low": lows, "close": closes, "volume": 1.0}, index=IDX[: len(closes)])


def spy_falls_at(bar: int):
    """SPY flat at 100, then 6% down from `bar` on: the 5% drawdown signal fires at `bar` and stays on."""
    c = np.full(N, 100.0)
    c[bar:] = 94.0
    return frame(c)


def flat_vix(level=15.0):
    return np.full(N, level)


def strat(**kw):
    base = dict(signal_symbol="SPY", signal_rule="drawdown", signal_params={"lookback": 20, "pct": 5}, trade_symbol="^VIX",
                target_pct=40, stop_pct=15, max_bars=20)
    return Strategy("t", **{**base, **kw})


def test_entry_fills_at_the_next_candles_open():
    v = flat_vix()
    o = v.copy()
    o[71] = 16.0  # the next candle opens at 16
    res = run(strat(), spy_falls_at(70), frame(v, opens=o, highs=np.maximum(o, v), lows=np.minimum(o, v)), START)
    t = res.trades[0]
    assert t.signal_ts == IDX[70]
    assert t.entry_ts == IDX[71] and t.entry_price == 16.0


def test_target_exit_at_the_target_price():
    v = flat_vix()
    h = v.copy()
    h[74] = 25.0  # +66% intraday: the +40% target (21.0) is reached
    t = run(strat(), spy_falls_at(70), frame(v, highs=h), START).trades[0]
    assert t.exit_reason == "target" and t.exit_ts == IDX[74]
    assert t.exit_price == pytest.approx(21.0)
    assert t.return_pct == pytest.approx(40.0)


def test_stop_first_when_both_inside_one_candle():
    v = flat_vix()
    h, l = v.copy(), v.copy()
    h[74], l[74] = 25.0, 12.0  # both +40% and -15% inside candle 74
    t = run(strat(), spy_falls_at(70), frame(v, highs=h, lows=l), START).trades[0]
    assert t.exit_reason == "stop"
    assert t.exit_price == pytest.approx(12.75)
    assert t.return_pct == pytest.approx(-15.0)


def test_opening_through_the_stop_fills_at_the_open():
    v = flat_vix()
    v[74:] = 11.0  # opens and stays at 11, below the 12.75 stop
    t = run(strat(), spy_falls_at(70), frame(v), START).trades[0]
    assert t.exit_reason == "stop" and t.exit_price == 11.0


def test_time_limit_exits_at_the_close_of_the_last_candle():
    v = flat_vix()
    v[71:] = np.linspace(15, 16, N - 71)  # drifts up, never reaches target or stop
    t = run(strat(max_bars=10), spy_falls_at(70), frame(v), START).trades[0]
    assert t.exit_reason == "time" and t.bars == 10
    assert t.exit_ts == IDX[80] and t.exit_price == v[80]


def test_costs_are_charged_on_both_fills():
    v = flat_vix()
    h = v.copy()
    h[74] = 25.0
    t = run(strat(cost_pct=1.0), spy_falls_at(70), frame(v, highs=h), START).trades[0]
    assert t.return_pct == pytest.approx((21.0 * 0.99) / (15.0 * 1.01) * 100 - 100)


def test_one_position_at_a_time():
    res = run(strat(max_bars=5), spy_falls_at(70), frame(flat_vix()), START)
    # The drawdown signal stays on for 20 candles; while a trade is open, new signals are skipped.
    assert all(a.exit_ts < b.entry_ts for a, b in zip(res.trades, res.trades[1:]))
    assert res.skipped["already_in_trade"] > 0


def test_target_level_skips_entries_already_past_it():
    res = run(strat(target_pct=None, target_level=22, stop_pct=None, max_bars=30), spy_falls_at(70), frame(flat_vix(24.0)), START)
    assert res.skipped["already_past_target"] > 0
    assert not [t for t in res.trades if t.exit_reason != "open"]


def test_target_level_hit():
    v = flat_vix(15.0)
    h = v.copy()
    h[80] = 22.5
    t = run(strat(target_pct=None, target_level=22, stop_pct=None, max_bars=30), spy_falls_at(70), frame(v, highs=h), START).trades[0]
    assert t.exit_reason == "target" and t.exit_price == 22.0 and t.exit_ts == IDX[80]


def test_no_entries_before_the_start():
    res = run(strat(), spy_falls_at(70), frame(flat_vix()), IDX[90])
    assert all(t.signal_ts >= IDX[90] for t in res.trades)


def test_an_unfinished_trade_is_kept_but_not_counted():
    res = run(strat(max_bars=50), spy_falls_at(70), frame(flat_vix()), START)
    assert res.trades[-1].exit_reason == "open"
    assert metrics(res.trades, 100, 0)["trades"] == len(res.trades) - 1


def test_truncation_no_trade_changes_when_later_candles_are_removed():
    """SPEC.md rule 8 on the whole engine: cut the history short and every finished trade must be identical."""
    idx = daily_index(600)
    spy = make_candles(idx, seed=4)
    vix = make_candles(idx, seed=5, start=15.0)
    s = strat(signal_rule="trend_break", signal_params={"length": 20}, max_bars=15)
    full = [t.row() for t in run(s, spy, vix, idx[0]).trades if t.exit_reason != "open"]
    assert len(full) >= 5
    for k in (200, 350, 480, 599):
        cut = [t.row() for t in run(s, spy.iloc[:k], vix.iloc[:k], idx[0]).trades if t.exit_reason != "open"]
        assert cut == [t for t in full if pd.Timestamp(t["exit_ts"]) < idx[k]], f"cut at {k}"


def mk(ret, bars=3, reason="time"):
    t = Trade(IDX[0], IDX[1], 100.0, exit_ts=IDX[2], exit_price=100 + ret, exit_reason=reason, bars=bars)
    t.return_pct = ret
    return t


def test_metrics_by_hand():
    m = metrics([mk(10), mk(-5, reason="stop"), mk(20, reason="target"), mk(-5), mk(-5)], bars=100, bars_in_market=15)
    assert m["trades"] == 5 and m["wins"] == 2 and m["win_rate"] == 40
    assert m["targets_hit"] == 1 and m["target_rate"] == 20  # a time exit that closed up is a win, not a target
    assert m["exits"] == {"target": 1, "stop": 1, "time": 3}
    assert m["avg_win_pct"] == 15 and m["avg_loss_pct"] == -5
    assert m["profit_factor"] == 2 and m["expectancy_pct"] == 3
    assert m["longest_losing_streak"] == 2
    assert m["time_in_market_pct"] == 15
    # equity 1.10, 1.045, 1.254, 1.1913, 1.131735: deepest fall from a peak is from 1.254
    assert m["max_drawdown_pct"] == pytest.approx((1.254 * 0.95 * 0.95 / 1.254 - 1) * 100, rel=1e-5)
    assert m["return_pct"] == pytest.approx((1.1 * 0.95 * 1.2 * 0.95 * 0.95 - 1) * 100, rel=1e-5)


def test_range_for_the_next_100_trades():
    lo, hi = _beta_binomial_range(50, 50)
    assert 38 <= lo <= 45 and 55 <= hi <= 62
    lo_small, hi_small = _beta_binomial_range(5, 5)
    assert hi_small - lo_small > hi - lo  # fewer trades, wider range


def test_report_splits_build_and_held_back_and_windows():
    idx = daily_index(1500)
    spy, vix = make_candles(idx, seed=6), make_candles(idx, seed=7, start=15.0)
    res = run(strat(signal_rule="trend_break", signal_params={"length": 20}), spy, vix, idx[0])
    split = idx[1000]
    rep = report(res, idx[0], split, window_years=2)
    done = [t for t in res.trades if t.exit_reason != "open"]
    assert rep["build"]["trades"] == sum(t.entry_ts < split for t in done)
    assert rep["held_back"]["trades"] == sum(t.entry_ts >= split for t in done)
    assert sum(w["trades"] for w in rep["windows"]) == len(done)
    assert {w["period"] for w in rep["windows"]} <= {"build", "held_back", "both"}
    assert any("Few trades" in w for w in rep["warnings"]) or rep["build"]["trades"] >= 30
