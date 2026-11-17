"""Option-structure backtests: causal (truncation test), costs, exits, hand-worked cases. Made-up candles only."""

from datetime import date

import numpy as np
import pandas as pd
import pytest

from stockwizard.option_backtest import OptionStrategy, atr14, intrinsic, legs_for, payoff_range, report, run
from stockwizard.rails import Leg


def frame(closes, first="2020-01-02", spread=1.0, opens=None, hour=21):
    idx = pd.bdate_range(first, periods=len(closes), tz="UTC") + pd.Timedelta(hours=hour)
    c = np.asarray(closes, float)
    o = np.asarray(opens if opens is not None else c, float)
    return pd.DataFrame({"open": o, "high": np.maximum(o, c) + spread, "low": np.minimum(o, c) - spread, "close": c, "volume": 1.0}, index=idx)


def market(n=80, seed=3, vix=15.0):
    rng = np.random.default_rng(seed)
    closes = 400 * np.exp(np.cumsum(rng.normal(0, 0.008, n)))
    opens = closes * np.exp(rng.normal(0, 0.003, n))
    spy = frame(closes, opens=opens, spread=2.0)
    vx = frame(np.full(n, vix), spread=0.5, hour=22)
    return spy, vx


def test_strikes_match_the_chart():
    assert [l.strike for l in legs_for("iron_condor", 600.4, 6.3, 5)] == [589, 594, 606, 611]
    assert [l.strike for l in legs_for("iron_fly", 600.4, 6.3, 5)] == [595, 600, 600, 605]


def test_a_flat_day_keeps_the_credit_less_costs():
    spy = frame([400.0] * 40, spread=4.0)            # ATR 8: shorts 8 away, never reached
    vx = frame([15.0] * 40, hour=22)
    res = run(OptionStrategy(dte=0), spy, vx, date(2020, 1, 1))
    t = res["trades"][-1]
    assert t.exit_reason == "expiry" and t.exit_cost == 0
    assert t.pnl == pytest.approx(t.credit * 100 - 0.65 * 4)
    assert t.credit < res["trades"][-1].max_loss / 100


def test_a_big_move_loses_the_most_it_can():
    closes = [400.0] * 30
    opens = [400.0] * 30
    closes[-1] = 440.0                                 # through the call wing on the last day
    spy = frame(closes, opens=opens, spread=4.0)
    vx = frame([15.0] * 30, hour=22)
    t = run(OptionStrategy(dte=0), spy, vx, date(2020, 1, 1))["trades"][-1]
    assert t.pnl == pytest.approx(-t.max_loss)


def test_slippage_and_commission_cost_what_they_should():
    spy, vx = market()
    free = run(OptionStrategy(dte=0, commission=0, slippage=0), spy, vx, date(2020, 1, 1))["trades"]
    paid = run(OptionStrategy(dte=0), spy, vx, date(2020, 1, 1))["trades"]
    for a, b in zip(free, paid):
        assert a.pnl - b.pnl == pytest.approx(0.05 * 4 * 100 + 0.65 * 4)


def test_one_position_at_a_time_for_multi_day():
    spy, vx = market()
    res = run(OptionStrategy(dte=5), spy, vx, date(2020, 1, 1))
    t = res["trades"]
    assert all(b.entry_day > a.exit_day for a, b in zip(t, t[1:]))
    assert res["skipped"]["already_in_trade"] > 0


def test_take_profit_closes_early_at_half_the_credit():
    spy = frame([400.0] * 60, spread=4.0)
    vx = frame([20.0] * 60, hour=22)
    res = run(OptionStrategy(dte=9, manage="take_50"), spy, vx, date(2020, 1, 1))
    early = [t for t in res["trades"] if t.exit_reason == "take_profit"]
    assert early, "a flat market should reach half the credit before expiry"
    for t in early:
        assert t.credit - t.exit_cost >= 0.5 * t.credit
        assert t.exit_day < t.entry_day + pd.Timedelta(days=14)


def test_signal_days_only():
    spy, vx = market(120)
    every = run(OptionStrategy(dte=0), spy, vx, date(2020, 1, 1))["trades"]
    some = run(OptionStrategy(dte=0, signal_rule="breakout", signal_params={"length": 10}), spy, vx, date(2020, 1, 1))["trades"]
    assert 0 < len(some) < len(every)


def test_vix_filter():
    spy, _ = market(60)
    high = frame([30.0] * 60, hour=22)
    res = run(OptionStrategy(dte=0, vix_max=15), spy, high, date(2020, 1, 1))
    assert not res["trades"] and res["skipped"]["filtered_out"] > 0


MONTHLY = [dict(dte=21, structure=k, short_atr=3, manage=m) for k, m in [
    ("bull_put", "stop_2x"), ("bear_call", "take_50"), ("iron_condor", "close_21"), ("bull_call_debit", "take_50"),
    ("bear_put_debit", "expiry"), ("call_condor", "close_21"), ("put_condor", "take_50")]]


@pytest.mark.parametrize("cfg", [dict(dte=0), dict(dte=5), dict(dte=9, manage="take_50"), dict(dte=0, structure="iron_fly"), *MONTHLY])
def test_truncation_no_trade_uses_later_candles(cfg):
    """Cut the data off at day k: every trade that ended before k must be identical."""
    spy, vx = market(150, seed=11)
    full = run(OptionStrategy(**cfg), spy, vx, date(2020, 1, 1))["trades"]
    for k in (60, 90, 120):
        cut = run(OptionStrategy(**cfg), spy.iloc[:k], vx.iloc[:k], date(2020, 1, 1))["trades"]
        end = spy.index[k - 1].date()
        assert [t.row() for t in full if t.expiry_day <= end] == [t.row() for t in cut if t.expiry_day <= end]


def test_report_splits_build_and_held_back_and_warns():
    spy, vx = market(150)
    res = run(OptionStrategy(dte=0), spy, vx, date(2020, 1, 1))
    split = spy.index[100].date()
    rep = report(res, split, OptionStrategy(dte=0))
    assert rep["build"]["trades"] + rep["held_back"]["trades"] == len(res["trades"])
    assert any("hypothetical" in w for w in rep["warnings"]) and any("Modelled" in w for w in rep["warnings"])
    assert rep["build"]["next_100_wins_low"] <= rep["build"]["win_rate"] <= rep["build"]["next_100_wins_high"] + 1


def test_atr_is_wilders():
    d = frame([100.0] * 30, spread=1.0)
    assert atr14(d).iloc[-1] == pytest.approx(2.0)


def test_intrinsic():
    legs = (Leg("P", "buy", 90), Leg("P", "sell", 95), Leg("C", "sell", 105), Leg("C", "buy", 110))
    assert intrinsic(legs, 100) == 0
    assert intrinsic(legs, 120) == pytest.approx(-5)


def test_the_risk_cap_skips_what_the_bot_would_refuse():
    spy, vx = market(80)
    capped = run(OptionStrategy(dte=0, wing=5, max_loss_cap=50), spy, vx, date(2020, 1, 1))
    assert not capped["trades"] and capped["skipped"]["over_risk_limit"] > 0   # $5 wings risk hundreds
    fly = run(OptionStrategy(dte=0, structure="iron_fly", wing=1, max_loss_cap=50), spy, vx, date(2020, 1, 1))
    assert all(t.max_loss <= 50 for t in fly["trades"])


# --- monthly: spreads, call and put condors, and the four ways of managing them ---

def test_monthly_strikes():
    st = lambda k: [(l.right, l.side, l.strike) for l in legs_for(k, 600.4, 2.0, 5, short_atr=3)]  # noqa: E731
    assert st("bull_put") == [("P", "buy", 589), ("P", "sell", 594)]
    assert st("bear_call") == [("C", "sell", 606), ("C", "buy", 611)]
    assert st("bull_call_debit") == [("C", "buy", 600), ("C", "sell", 605)]
    assert st("bear_put_debit") == [("P", "sell", 595), ("P", "buy", 600)]
    assert st("call_condor") == [("C", "buy", 589), ("C", "sell", 594), ("C", "sell", 606), ("C", "buy", 611)]
    assert st("put_condor") == [("P", "buy", 589), ("P", "sell", 594), ("P", "sell", 606), ("P", "buy", 611)]


def test_payoff_range_by_hand():
    # a $5 bull call spread for a $2 debit: makes at most 3, loses at most 2
    assert payoff_range((Leg("C", "buy", 600), Leg("C", "sell", 605)), -2.0) == (3.0, 2.0)
    # a $5-wing call condor (589/594/606/611) for $1.50: makes at most 3.50 between 594 and 606, loses the 1.50 outside
    best, worst = payoff_range(tuple(legs_for("call_condor", 600.4, 2.0, 5, short_atr=3)), -1.5)
    assert (best, worst) == (3.5, 1.5)
    # an iron condor: the credit, or the widest wing less it
    assert payoff_range(tuple(legs_for("iron_condor", 600.4, 2.0, 5, short_atr=3)), 1.2) == (1.2, pytest.approx(3.8))


def test_a_call_condor_and_iron_condor_on_the_same_strikes_end_alike():
    """The same payoff at expiry (put-call parity): held to expiry, results differ only by the debit and credit's financing."""
    spy, vx = market(200, seed=5)
    a = run(OptionStrategy(dte=21, structure="iron_condor", short_atr=3, commission=0, slippage=0), spy, vx, date(2020, 1, 1))["trades"]
    b = run(OptionStrategy(dte=21, structure="call_condor", short_atr=3, commission=0, slippage=0), spy, vx, date(2020, 1, 1))["trades"]
    assert len(a) == len(b) > 3
    for x, y in zip(a, b):
        assert x.pnl == pytest.approx(y.pnl, abs=2.0)


def test_a_debit_spread_risks_its_debit():
    spy, vx = market(200)
    for t in run(OptionStrategy(dte=21, structure="bull_call_debit"), spy, vx, date(2020, 1, 1))["trades"]:
        assert t.credit < 0 and t.max_loss == pytest.approx(-t.credit * 100 + 0.65 * 2)
        assert t.pnl >= -t.max_loss - 1e-6


def test_close_at_21_days_left():
    spy, vx = market(200)
    for t in run(OptionStrategy(dte=21, manage="close_21", short_atr=3), spy, vx, date(2020, 1, 1))["trades"]:
        assert t.exit_reason == "days_left" and (t.expiry_day - t.exit_day).days <= 21 < (t.expiry_day - t.entry_day).days


def test_stop_at_twice_the_credit():
    closes = [400.0] * 30 + [400.0 * 1.012 ** i for i in range(1, 30)]     # flat, then a steady climb into the calls
    spy = frame(closes, spread=2.0)
    vx = frame([15.0] * len(closes), hour=22)
    res = run(OptionStrategy(dte=21, structure="bear_call", short_atr=2, manage="stop_2x"), spy, vx, date(2020, 1, 1))
    stops = [t for t in res["trades"] if t.exit_reason == "stop"]
    assert stops
    for t in stops:
        assert t.exit_cost - t.credit >= 2 * t.credit


def test_take_50_on_a_debit_spread_is_half_the_most_it_can_make():
    closes = [400.0] * 20 + [400.0 * 1.01 ** i for i in range(1, 40)]
    spy = frame(closes, spread=2.0)
    vx = frame([15.0] * len(closes), hour=22)
    trades = run(OptionStrategy(dte=21, structure="bull_call_debit", manage="take_50"), spy, vx, date(2020, 1, 1))["trades"]
    assert any(t.exit_reason == "take_profit" for t in trades)
    for t in trades:
        if t.exit_reason == "take_profit":
            best, _ = payoff_range(tuple(Leg(**{k: v for k, v in l.items()}) for l in t.legs), t.credit)
            assert t.credit - t.exit_cost >= 0.5 * best
