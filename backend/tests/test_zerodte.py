"""The 0DTE framework: fills at the bid and ask, every exit rule, signals that don't look ahead, the
false-discovery check, and recorded quotes. Made-up candles and quotes only."""

from datetime import date, datetime, time

import numpy as np
import pandas as pd
import pytest

from stockwizard.zerodte import engine, matrix, signals, stats
from stockwizard.zerodte.instruments import INSTRUMENTS
from stockwizard.zerodte.quotes import ModelQuotes, OptionQuote, RecordedQuotes
from stockwizard.zerodte.strategy import Config, legs_for, resolve

HOURS = ["09:30", "10:30", "11:30", "12:30", "13:30", "14:30", "15:30"]
NY = "America/New_York"


def bars(days=30, base=500.0, path=None, seed=1, start="2025-01-06"):
    """Hourly bars; `path(day_index, hour_index, price)` can push the price."""
    rng = np.random.default_rng(seed)
    idx, rows, px = [], [], base
    for i, d in enumerate(pd.bdate_range(start, periods=days)):
        for k, hm in enumerate(HOURS):
            o = px
            c = o * np.exp(rng.normal(0, 0.001))
            if path:
                c = path(i, k, o) or c
            rows.append([o, max(o, c) * 1.0003, min(o, c) * 0.9997, c, 1000.0])
            idx.append(pd.Timestamp(f"{d.date()} {hm}", tz=NY).tz_convert("UTC"))
            px = c
    return pd.DataFrame(rows, index=pd.DatetimeIndex(idx), columns=["open", "high", "low", "close", "volume"])


def setup(b, vol=0.18, quotes=None):
    return dict(bars=b, bar_minutes=60, quotes=quotes or ModelQuotes(), vol_at=lambda ts: vol, vix_prev=lambda d: 18.0, atr_prev=lambda d: 5.0)


def go(cfg, b, **kw):
    d = setup(b, **kw)
    return engine.run(cfg, d["bars"], d["bar_minutes"], d["quotes"], d["vol_at"], d["vix_prev"], d["atr_prev"], date(2025, 1, 1))


# --- quotes and strikes ---

def test_the_model_charges_the_spread_and_prices_puts_dearer():
    ch = ModelQuotes().chain(INSTRUMENTS["SPY"], datetime(2025, 1, 6, 15), 500.0, 5.5 * 3600, 0.18)
    q = ch[("P", 495.0)]
    assert q.bid < q.mid < q.ask and q.ask - q.bid >= 0.02
    assert ch[("P", 490.0)].iv > ch[("C", 510.0)].iv     # skew: downside volatility costs more
    assert ch[("C", 505.0)].delta == pytest.approx(-ch[("P", 495.0)].delta, abs=0.08)


def test_strikes_are_chosen_by_delta_and_width():
    ch = ModelQuotes().chain(INSTRUMENTS["SPY"], datetime(2025, 1, 6, 15), 500.0, 5.5 * 3600, 0.18)
    legs = legs_for(Config("SPY", "iron_condor", short_delta=0.15, width=2, call_width=3), "iron_condor", ch, 500.0, 1.0)
    sp, sc = legs[1], legs[2]
    assert abs(abs(ch[("P", sp.strike)].delta) - 0.15) < 0.05 and abs(ch[("C", sc.strike)].delta - 0.15) < 0.05
    assert legs[0].strike == sp.strike - 2 and legs[3].strike == sc.strike + 3


def test_direction_picks_the_trade():
    c = Config(structure="directional", neutral_trade="none")
    assert resolve(c, "bullish") == "bull_put" and resolve(c, "bearish") == "bear_call" and resolve(c, "neutral") is None
    assert resolve(Config(structure="directional_debit"), "bullish") == "bull_call_debit"


# --- fills and fees ---

def test_opening_sells_at_the_bid_buys_at_the_ask_and_pays_fees():
    b = bars(25)
    t = go(Config("SPY", "iron_condor", "10:30", 0.15, 2.0), b)["trades"][-1]
    assert t.exit_reason == "expiry"
    inst = INSTRUMENTS["SPY"]
    assert t.fees == pytest.approx(inst.per_leg_cost * 4)          # nothing to pay at expiry
    assert t.pnl == pytest.approx((t.credit - t.exit_cost) * 100 - t.fees)
    # the credit at fills is below the credit at mid
    at = pd.Timestamp(f"{t.day} 10:30", tz=NY)
    ch = ModelQuotes().chain(inst, at.to_pydatetime(), t.spot_in, 5.5 * 3600, 0.18)
    mid_credit = -sum((1 if l["side"] == "buy" else -1) * ch[(l["right"], l["strike"])].mid for l in t.legs)
    assert t.credit < mid_credit


# --- exits ---

def run_day(cfg, push):
    b = bars(25, path=lambda i, k, o: push(k, o) if i == 24 else None)
    return [t for t in go(cfg, b)["trades"] if t.day == b.index.tz_convert(NY)[-1].date()][0]


def test_a_stop_closes_on_a_strong_move():
    t = run_day(Config("SPY", "iron_condor", "10:30", 0.15, 5.0, stop_mult=1.5), lambda k, o: o * 1.006 if k >= 1 else None)
    assert t.exit_reason == "stop" and t.fees == pytest.approx(2 * INSTRUMENTS["SPY"].per_leg_cost * 4)


def test_a_breach_closes_when_the_price_reaches_a_short_strike():
    t = run_day(Config("SPY", "iron_condor", "10:30", 0.15, 5.0, stop_breach=True), lambda k, o: o * 1.006 if k >= 1 else None)
    assert t.exit_reason == "breach"


def test_a_delta_stop():
    t = run_day(Config("SPY", "iron_condor", "10:30", 0.15, 5.0, stop_delta=0.35), lambda k, o: o * 1.004 if k >= 1 else None)
    assert t.exit_reason == "delta"


def test_a_profit_target_on_a_quiet_day():
    t = run_day(Config("SPY", "iron_condor", "10:30", 0.20, 2.0, profit_target=0.25), lambda k, o: o)
    assert t.exit_reason == "profit_target" and t.pnl > 0


def test_a_time_exit():
    t = run_day(Config("SPY", "iron_condor", "10:30", 0.10, 2.0, exit_time="14:30"), lambda k, o: o)
    assert t.exit_reason == "time" and t.exit_time == "14:30"


def test_filters_skip_days():
    b = bars(25)
    assert not go(Config("SPY", "iron_condor", vix_max=15), b)["trades"]
    # At 13:30 the opening range (the first hour) is distinct; a strong climb after it leaves the range.
    res = go(Config("SPY", "iron_condor", "13:30", require_inside_range=True), bars(25, path=lambda i, k, o: o * 1.005 if 1 <= k <= 3 else None))
    assert res["skipped"].get("outside_opening_range", 0) > 0


def test_on_hourly_candles_direction_at_1030_uses_vwap_and_the_open():
    b = bars(3, path=lambda i, k, o: o * 1.004 if k == 0 else None)
    day = b.copy()
    day.index = day.index.tz_convert(NY)
    one = day[day.index.date == day.index[-1].date()]
    s = signals.at_entry(one, time(10, 30), 60)
    assert not s.range_distinct and s.inside_range is None and s.direction == "bullish"


def test_debit_spreads_cost_money_to_open():
    b = bars(25, path=lambda i, k, o: o * 1.004 if k == 0 else None)   # a bullish first hour every day
    t = go(Config("SPY", "directional_debit", "10:30", 0.5, 2.0), b)["trades"]
    assert t and all(x.structure == "bull_call_debit" and x.credit < 0 for x in t)


# --- no look-ahead ---

def test_signals_only_use_bars_finished_by_the_entry():
    b = bars(3)
    day = b.copy()
    day.index = day.index.tz_convert(NY)
    one = day[day.index.date == day.index[-1].date()]
    s_full = signals.at_entry(one, time(10, 30), 60)
    s_cut = signals.at_entry(one.iloc[:1], time(10, 30), 60)
    assert s_full == s_cut and s_full.price == pytest.approx(float(one["close"].iloc[0]))


@pytest.mark.parametrize("cfg", [Config("SPY", "iron_condor", "10:30", 0.15, 2.0, stop_mult=2.0, profit_target=0.5),
                                 Config("XSP", "directional", "13:30", 0.15, 1.0, exit_time="15:30")])
def test_truncation_no_trade_changes_when_later_days_are_cut(cfg):
    b = bars(40, seed=4)
    full = {t.day: t.row() for t in go(cfg, b)["trades"]}
    cut_b = b.iloc[: 7 * 30]
    cut = {t.day: t.row() for t in go(cfg, cut_b)["trades"]}
    assert cut and all(full[d] == r for d, r in cut.items())


# --- statistics and the false-discovery check ---

def test_benjamini_hochberg():
    assert stats.benjamini_hochberg([0.001, 0.2, 0.03, 0.8], q=0.1) == [True, False, True, False]
    assert stats.benjamini_hochberg([0.04] * 50, q=0.05) == [True] * 50
    assert stats.benjamini_hochberg([0.04] + [0.9] * 49, q=0.05) == [False] + [False] * 49


def test_summary_counts_tail_risk_and_months():
    trades = [engine.Trade(date(2025, 1, 2 + i), "iron_condor", "10:30", "16:00", "expiry", 500, 500, [], 0.5, 0, 2.8, p, 150, "neutral", 18.0)
              for i, p in enumerate([40, 40, 40, -150, 40])]
    s = stats.summary(trades)
    assert s["win_rate"] == 80.0 and s["largest_loss"] == -150 and s["max_drawdown"] == -150 and s["max_consecutive_losses"] == 1
    assert s["expectancy"] == 2.0 and s["months_positive_pct"] == 100


def test_matrix_runs_periods_and_reports():
    b = bars(60, seed=7)
    data = {"SPY": setup(b)}
    grid = [Config("SPY", "iron_condor", "10:30", d, 2.0) for d in (0.1, 0.2)]
    periods = matrix.Periods(date(2025, 1, 1), date(2025, 2, 14), date(2025, 3, 7), date(2025, 4, 30))
    out = matrix.run(grid, data, periods)
    assert out["tried"] == 2 and not out["final_used"]
    md = matrix.report_markdown(out, "test", ["made-up"])
    assert "Tried 2 strategies" in md and "not looked at" in md


# --- recorded quotes ---

def test_recorded_quotes_use_the_latest_snapshot_and_go_stale():
    t0 = datetime(2025, 1, 6, 15, 0)
    rows = [{"taken_at": t0, "right": "C", "strike": 505, "bid": 0.4, "ask": 0.45, "iv": 0.15},
            {"taken_at": t0, "right": "P", "strike": 495, "bid": 0.5, "ask": 0.56, "iv": 0.17}]
    rq = RecordedQuotes(rows, max_age_seconds=1800)
    ch = rq.chain(INSTRUMENTS["SPY"], datetime(2025, 1, 6, 15, 20), 500.0, 3 * 3600, 0.15)
    assert ch[("C", 505.0)].bid == 0.4 and 0 < ch[("C", 505.0)].delta < 0.5
    assert rq.chain(INSTRUMENTS["SPY"], datetime(2025, 1, 6, 16, 0), 500.0, 3600, 0.15) == {}
    assert isinstance(ch[("P", 495.0)], OptionQuote)


def test_the_kitty_sizes_to_two_percent_and_skips_what_it_cannot_afford():
    mk = lambda pnl, ml: engine.Trade(date(2025, 1, 2), "iron_condor", "10:30", "16:00", "expiry", 500, 500, [], 0.5, 0, 2.8, pnl, ml, "neutral", 18.0)  # noqa: E731
    k = stats.kitty([mk(30, 40), mk(50, 450)])
    assert k["taken"] == 1 and k["skipped"] == 1 and k["end"] == 5060      # 2 structures of $40 risk, then $450 is over $100
    k2 = stats.kitty([mk(-100, 100), mk(80, 100)])
    assert k2["end"] == 4900 and k2["skipped"] == 1                         # after the loss, 2% no longer covers $100
