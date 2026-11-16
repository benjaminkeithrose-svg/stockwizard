"""Each indicator checked against values worked out by hand on made-up candles."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from stockwizard.candles import CandleError, validate
from stockwizard.indicators import REGISTRY, compute

from conftest import daily_index, intraday_index, make_candles


def flat(index, price=100.0, volume=1000.0):
    return pd.DataFrame(
        {"open": price, "high": price, "low": price, "close": price, "volume": volume}, index=index
    )


def from_closes(closes, index=None, spread=0.0):
    closes = np.asarray(closes, dtype=float)
    index = index if index is not None else daily_index(len(closes))
    return pd.DataFrame(
        {
            "open": closes,
            "high": closes + spread,
            "low": closes - spread,
            "close": closes,
            "volume": 1000.0,
        },
        index=index,
    )


# --- trend -----------------------------------------------------------------


def test_sma_values_and_warm_up():
    df = from_closes([1, 2, 3, 4, 5, 6])
    out = compute("sma", df, "1d", length=3)["sma"]
    assert out.iloc[:2].isna().all()
    assert out.iloc[2:].tolist() == [2.0, 3.0, 4.0, 5.0]


def test_ema_seeded_with_simple_average():
    df = from_closes([2, 4, 6, 8, 10])
    out = compute("ema", df, "1d", length=3)["ema"]
    # Seed = mean(2, 4, 6) = 4; alpha = 0.5; then 0.5*8 + 0.5*4 = 6; 0.5*10 + 0.5*6 = 8.
    assert out.iloc[:2].isna().all()
    assert out.iloc[2:].tolist() == [4.0, 6.0, 8.0]


def test_macd_is_zero_on_a_flat_market():
    out = compute("macd", flat(daily_index(60)), "1d")
    assert out["macd"].dropna().eq(0).all()
    assert out["histogram"].dropna().eq(0).all()
    # First MACD at the slow EMA's seed (26th candle), first signal 8 candles later.
    assert out["macd"].first_valid_index() == out.index[25]
    assert out["signal"].first_valid_index() == out.index[33]


# --- volatility ------------------------------------------------------------


def test_atr_equals_constant_range():
    df = from_closes([100.0] * 30, spread=1.5)
    out = compute("atr", df, "1d", length=14)["atr"]
    assert out.iloc[:13].isna().all()
    assert np.allclose(out.iloc[13:], 3.0)


def test_atr_counts_gaps_through_previous_close():
    # Close 100 then a candle from 104 to 106: true range is 106 - 100 = 6, not 2.
    df = pd.DataFrame(
        {"open": [100, 105], "high": [100, 106], "low": [100, 104], "close": [100, 105], "volume": 1.0},
        index=daily_index(2),
    )
    assert compute("atr", df, "1d", length=1)["atr"].tolist() == [0.0, 6.0]


def test_bollinger_known_values():
    df = from_closes([1, 2, 3, 4, 5])
    out = compute("bollinger", df, "1d", length=5, mult=2.0).iloc[-1]
    sd = np.std([1, 2, 3, 4, 5])  # population: sqrt(2)
    assert out["mid"] == 3.0
    assert out["upper"] == pytest.approx(3 + 2 * sd)
    assert out["lower"] == pytest.approx(3 - 2 * sd)
    assert out["percent_b"] == pytest.approx((5 - (3 - 2 * sd)) / (4 * sd))
    assert out["bandwidth"] == pytest.approx(4 * sd / 3)


def test_bollinger_flat_market_has_zero_width_and_no_percent_b():
    out = compute("bollinger", flat(daily_index(25)), "1d").dropna(subset=["mid"])
    assert out["bandwidth"].eq(0).all()
    assert out["percent_b"].isna().all()


def test_keltner_band_is_mult_times_atr():
    df = from_closes([50.0] * 30, spread=1.0)
    out = compute("keltner", df, "1d", length=20, atr_length=10, mult=2.0).dropna()
    assert np.allclose(out["mid"], 50.0)
    assert np.allclose(out["upper"] - out["mid"], 4.0)
    assert np.allclose(out["mid"] - out["lower"], 4.0)


def test_squeeze_on_in_a_quiet_market_and_fires_on_expansion():
    rng = np.random.default_rng(3)
    quiet = 100 + rng.normal(0, 0.05, 40)
    breakout = 100 + np.cumsum(np.full(10, 1.5))
    df = from_closes(np.concatenate([quiet, breakout]), spread=1.0)
    out = compute("squeeze", df, "1d")
    assert out["squeeze_on"].iloc[:19].isna().all()  # warm-up
    assert out["squeeze_on"].iloc[19:40].all()  # tight closes, wide candles: bands inside channel
    fired = out.index[out["squeeze_fired"].fillna(False).to_numpy(dtype=bool)]
    assert len(fired) == 1 and fired[0] > df.index[39]
    assert out.loc[fired[0], "momentum"] > 0  # fired upwards


def test_squeeze_momentum_is_regression_value():
    # A straight-line rise: close minus its range/average centre is constant, so momentum equals it.
    df = from_closes(np.arange(1, 61, dtype=float))
    out = compute("squeeze", df, "1d", length=20)["momentum"].dropna()
    # For a line, highest high + lowest low midpoint and SMA are both 9.5 below the close.
    assert np.allclose(out, 9.5)


# --- momentum --------------------------------------------------------------


def test_rsi_extremes():
    up = compute("rsi", from_closes(np.arange(1, 31)), "1d")["rsi"]
    down = compute("rsi", from_closes(np.arange(30, 0, -1)), "1d")["rsi"]
    assert up.iloc[:14].isna().all() and up.iloc[14:].eq(100).all()
    assert down.iloc[14:].eq(0).all()
    assert compute("rsi", flat(daily_index(30)), "1d")["rsi"].isna().all()


def test_rsi_known_value():
    # Alternating +2, -1 moves with length 2: seed gain = (2+0)/2 = 1, seed loss = (0+1)/2 = 0.5.
    df = from_closes([10, 12, 11])
    assert compute("rsi", df, "1d", length=2)["rsi"].iloc[-1] == pytest.approx(100 - 100 / (1 + 2))


# --- intraday levels -------------------------------------------------------


def test_vwap_resets_each_session():
    idx = intraday_index(days=2)
    df = from_closes(np.where(np.arange(len(idx)) < 78, 10.0, 20.0), index=idx, spread=0.0)
    out = compute("vwap", df, "5m")["vwap"]
    assert out.iloc[:78].eq(10).all() and out.iloc[78:].eq(20).all()


def test_vwap_weights_by_volume():
    idx = intraday_index(days=1)[:2]
    df = pd.DataFrame(
        {"open": [10, 20], "high": [10, 20], "low": [10, 20], "close": [10, 20], "volume": [1, 3]}, index=idx
    )
    assert compute("vwap", df, "5m")["vwap"].tolist() == [10.0, 17.5]


def test_vwap_refuses_daily_candles():
    with pytest.raises(CandleError):
        compute("vwap", flat(daily_index(5)), "1d")


def test_anchored_vwap_starts_at_anchor():
    df = from_closes([10, 10, 30, 30])
    out = compute("anchored_vwap", df, "1d", anchor=df.index[2].isoformat())["anchored_vwap"]
    assert out.iloc[:2].isna().all() and out.iloc[2:].eq(30).all()


def test_opening_range_appears_when_complete_and_holds():
    idx = intraday_index(days=2)
    df = make_candles(idx, seed=5)
    out = compute("opening_range", df, "5m", minutes=30)
    day1 = df.iloc[:78]
    assert out["or_high"].iloc[:5].isna().all()  # 09:30 to 09:50 candles: range not finished
    assert out["or_high"].iloc[5] == day1["high"].iloc[:6].max()  # the 09:55 candle completes it
    assert out["or_low"].iloc[5] == day1["low"].iloc[:6].min()
    assert out["or_high"].iloc[5:78].nunique() == 1  # held all day
    assert out["or_high"].iloc[78:83].isna().all()  # next session starts fresh


def test_opening_range_skips_sessions_missing_a_candle():
    idx = intraday_index(days=1).delete(2)  # 09:40 candle missing
    out = compute("opening_range", make_candles(idx), "5m", minutes=30)
    assert out["or_high"].isna().all()


def test_opening_range_must_fit_the_timeframe():
    with pytest.raises(CandleError):
        compute("opening_range", make_candles(intraday_index(days=1)), "5m", minutes=32)


def test_prior_day_levels_intraday():
    idx = intraday_index(days=2)
    df = make_candles(idx, seed=9)
    out = compute("prior_day", df, "5m")
    day1, day2 = df.iloc[:78], df.iloc[78:]
    assert out.iloc[:78].isna().all().all()
    row = out.iloc[78]
    assert row["prior_high"] == day1["high"].max()
    assert row["prior_low"] == day1["low"].min()
    assert row["prior_close"] == day1["close"].iloc[-1]
    assert row["gap"] == pytest.approx(day2["open"].iloc[0] / day1["close"].iloc[-1] - 1)


def test_prior_day_levels_daily():
    df = make_candles(daily_index(3))
    out = compute("prior_day", df, "1d")
    assert out["prior_close"].iloc[1] == df["close"].iloc[0]
    assert out["prior_high"].iloc[2] == df["high"].iloc[1]


# --- candle checks ---------------------------------------------------------


def test_validate_rejects_bad_candles():
    good = make_candles(daily_index(5))
    with pytest.raises(CandleError, match="UTC"):
        validate(good.tz_convert("America/New_York"))
    with pytest.raises(CandleError, match="order"):
        validate(good.iloc[::-1])
    bad = good.copy()
    bad.iloc[2, bad.columns.get_loc("high")] = bad["low"].iloc[2] - 1
    with pytest.raises(CandleError, match="High"):
        validate(bad)


def test_registry_versions_and_unknown_names():
    assert all(i.code_version == f"{n}@{i.version}" for n, i in REGISTRY.items())
    with pytest.raises(KeyError):
        compute("not-an-indicator", flat(daily_index(5)), "1d")
    with pytest.raises(TypeError, match="anchor"):
        compute("anchored_vwap", flat(daily_index(5)), "1d")
