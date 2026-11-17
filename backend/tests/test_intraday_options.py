"""Same-day option backtests on hourly candles: entry times, VIX1D, expected-move strikes, stops, no look-ahead. Made-up candles only."""

from datetime import date

import numpy as np
import pandas as pd
import pytest

from stockwizard.intraday_options import IntradayStrategy, run

HOURS = ["09:30", "10:30", "11:30", "12:30", "13:30", "14:30", "15:30"]


def hourly(days=40, seed=5, start="2025-01-06", base=500.0, drift=0.0015, shock=None):
    rng = np.random.default_rng(seed)
    idx, rows, px = [], [], base
    for d in pd.bdate_range(start, periods=days):
        for k, hm in enumerate(HOURS):
            t = pd.Timestamp(f"{d.date()} {hm}", tz="America/New_York").tz_convert("UTC")
            o = px
            c = o * np.exp(rng.normal(0, drift))
            if shock and d.date() == shock[0] and k in shock[1]:
                c = o * shock[2]
            rows.append([o, max(o, c) * 1.0005, min(o, c) * 0.9995, c, 1.0])
            idx.append(t)
            px = c
    return pd.DataFrame(rows, index=pd.DatetimeIndex(idx), columns=["open", "high", "low", "close", "volume"])


def daily_from(h):
    ny = h.index.tz_convert("America/New_York")
    g = h.groupby(ny.date)
    d = pd.DataFrame({"open": g["open"].first(), "high": g["high"].max(), "low": g["low"].min(), "close": g["close"].last(), "volume": 1.0})
    d.index = pd.DatetimeIndex([pd.Timestamp(x, tz="America/New_York") for x in d.index]).tz_convert("UTC")
    return d


def flat_index(h, value, hour_shift=0):
    return pd.DataFrame({"open": value, "high": value, "low": value, "close": value, "volume": 1.0}, index=h.index + pd.Timedelta(hours=hour_shift))


def data(vix=30.0, **kw):
    h = hourly(**kw)
    return h, daily_from(h), daily_from(flat_index(h, vix)), flat_index(h, 40.0)


START = date(2025, 1, 6)


def test_entry_at_1030_uses_the_second_candles_open():
    h, d, v, v1 = data()
    t = run(IntradayStrategy(entry="10:30"), h, d, v, None, START)["trades"]
    assert t and all(x.entry_time == "10:30" for x in t)
    first = t[0]
    assert first.spot_in == pytest.approx(float(h.loc[h.index.tz_convert("America/New_York").date == first.entry_day]["open"].iloc[1]))


def test_vix1d_is_read_at_the_entry_candle():
    h, d, v, v1 = data()
    t = run(IntradayStrategy(vol_source="vix1d"), h, d, v, v1, START)["trades"]
    assert t and all(x.vol == pytest.approx(0.40) for x in t)
    t2 = run(IntradayStrategy(vol_source="vix"), h, d, v, None, START)["trades"]
    assert all(x.vol == pytest.approx(0.30) for x in t2)


def test_no_trade_without_a_credit():
    h, d, v, v1 = data(vix=10.0)
    res = run(IntradayStrategy(), h, d, v, None, START)
    assert all(t.credit > 0 for t in res["trades"])


def test_expected_move_strikes_scale_with_volatility_and_multiple():
    h, d, v, v1 = data()
    a = run(IntradayStrategy(strikes="expected_move", em_mult=1.0, vol_source="vix1d"), h, d, v, v1, START)["trades"][0]
    b = run(IntradayStrategy(strikes="expected_move", em_mult=1.5, vol_source="vix1d"), h, d, v, v1, START)["trades"][0]
    wa = a.legs[2]["strike"] - a.legs[1]["strike"]
    wb = b.legs[2]["strike"] - b.legs[1]["strike"]
    assert wb > wa > 0
    em = a.spot_in * 0.40 * np.sqrt(1 / 252)   # a whole session in trading time
    assert abs(wa / 2 - em) <= 1.0


def test_a_stop_cuts_the_loss_on_a_steady_move():
    shock_day = pd.bdate_range("2025-01-06", periods=40)[35].date()
    h, d, v, v1 = data(vix=12.0, shock=(shock_day, (1, 2, 3, 4, 5), 1.008))   # a steady climb through the day
    held = {t.entry_day: t for t in run(IntradayStrategy(), h, d, v, None, START)["trades"]}
    stopped = {t.entry_day: t for t in run(IntradayStrategy(stop_mult=1.0), h, d, v, None, START)["trades"]}
    assert stopped[shock_day].exit_reason == "stop"
    assert stopped[shock_day].pnl > held[shock_day].pnl
    assert stopped[shock_day].pnl < 0


def test_a_jump_through_the_wing_in_one_hour_is_not_saved_by_a_stop():
    """Honest about stops: a gap past the long strike within the hour loses the most it can, plus the exit's costs."""
    shock_day = pd.bdate_range("2025-01-06", periods=40)[35].date()
    h, d, v, v1 = data(vix=12.0, shock=(shock_day, (3,), 1.06))
    held = {t.entry_day: t for t in run(IntradayStrategy(), h, d, v, None, START)["trades"]}[shock_day]
    stopped = {t.entry_day: t for t in run(IntradayStrategy(stop_mult=1.0), h, d, v, None, START)["trades"]}[shock_day]
    assert stopped.exit_reason == "stop" and stopped.pnl <= held.pnl


def test_short_days_are_skipped():
    h, d, v, v1 = data()
    ny = h.index.tz_convert("America/New_York")
    cut = h[~((ny.date == ny[30].date()) & (ny.hour >= 13))]   # a half day
    res = run(IntradayStrategy(), cut, d, v, None, START)
    assert res["skipped"]["short_day"] == 1


@pytest.mark.parametrize("cfg", [dict(), dict(entry="10:30", vol_source="vix1d", strikes="expected_move", stop_mult=1.0), dict(structure="iron_fly", stop_mult=2.0)])
def test_truncation_no_trade_uses_later_candles(cfg):
    h, d, v, v1 = data(days=40, seed=9)
    full = run(IntradayStrategy(**cfg), h, d, v, v1, START)["trades"]
    for k in (100, 180, 230):
        cut_h = h.iloc[:k]
        end = cut_h.index[-1]
        res = run(IntradayStrategy(**cfg), cut_h, d[d.index <= end], v[v.index <= end], v1[v1.index <= end], START)["trades"]
        last_full_day = max(t.entry_day for t in res) if res else None
        keep = lambda ts: [t.row() for t in ts if last_full_day and t.entry_day < last_full_day]  # noqa: E731
        assert keep(full) == keep(res)


def test_the_risk_cap():
    h, d, v, v1 = data()
    res = run(IntradayStrategy(max_loss_cap=50), h, d, v, None, START)
    assert not res["trades"] and res["skipped"]["over_risk_limit"] > 0
