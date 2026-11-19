"""Traditional patterns: none sees the future (the truncation test), and hand-made candles fire them. Made-up candles only."""

from __future__ import annotations

import numpy as np
import pandas as pd

from conftest import daily_index, make_candles
from stockwizard.patterns import PATTERNS, detect


def frame(rows: list[tuple[float, float, float, float]]) -> pd.DataFrame:
    idx = daily_index(len(rows))
    o, h, l, c = zip(*rows)
    return pd.DataFrame({"open": o, "high": h, "low": l, "close": c, "volume": 1000.0}, index=idx)


def test_every_pattern_is_known_at_the_close_from_earlier_candles_only():
    full = make_candles(daily_index(700), seed=11)
    whole = detect(full)
    assert list(whole.columns) == list(PATTERNS)
    for cut in (40, 150, 333, 500, 690, 699):
        part = detect(full.iloc[:cut])
        pd.testing.assert_frame_equal(whole.iloc[:cut], part, check_freq=False, obj=f"cut at {cut}")


def test_patterns_do_turn_up_on_a_long_random_history():
    d = detect(make_candles(daily_index(2500), seed=3))
    seen = {k for k in PATTERNS if d[k].any()}
    assert {"bull_engulf", "bear_engulf", "doji", "inside_bar", "breakout_20", "breakdown_20"} <= seen


def falling(n: int, start: float = 110.0, step: float = 1.0):
    return [(start - i * step + 0.3, start - i * step + 0.6, start - i * step - 0.6, start - i * step - 0.3) for i in range(n)]


def test_a_bullish_engulfing_candle_after_a_fall():
    rows = falling(12)
    last = rows[-1][3]
    rows += [(last + 0.2, last + 0.4, last - 0.8, last - 0.5),     # a small down candle
             (last - 0.9, last + 1.5, last - 1.0, last + 1.2)]     # a big up candle swallowing it
    d = detect(frame(rows))
    assert d["bull_engulf"].iloc[-1] and not d["bear_engulf"].iloc[-1]


def test_a_hammer_after_a_fall_and_a_doji():
    rows = falling(12)
    last = rows[-1][3]
    rows += [(last, last + 0.1, last - 3.0, last + 0.05)]            # tiny body, long lower shadow
    d = detect(frame(rows))
    assert d["hammer"].iloc[-1] and d["doji"].iloc[-1]


def test_a_20_day_breakout_counts_on_the_day_it_closes_above():
    rows = [(100.0, 101.0, 99.0, 100.0)] * 25 + [(100.0, 103.0, 99.5, 102.5)]
    d = detect(frame(rows))
    assert d["breakout_20"].iloc[-1] and not d["breakout_20"].iloc[:-1].any()


def test_a_bull_flag_counts_only_when_it_breaks_out():
    rows = [(100.0, 100.5, 99.5, 100.0)] * 20
    rows += [(100 + 2 * i, 101.5 + 2 * i, 99.5 + 2 * i, 101.5 + 2 * i) for i in range(5)]   # the pole: about +10
    top = rows[-1][1]
    rows += [(top - 1.5, top - 0.5, top - 2.5, top - 1.5)] * 5                              # the pause
    rows += [(top - 1.0, top + 1.5, top - 1.2, top + 1.2)]                                  # the break
    d = detect(frame(rows))
    assert d["bull_flag"].iloc[-1]
    assert not d["bull_flag"].iloc[:-1].any(), "never while the flag is still forming"


def test_a_double_bottom_counts_when_it_clears_the_high_between_the_lows():
    base = [(100.0, 100.5, 99.5, 100.0)]
    down = [(100 - i, 100.5 - i, 99.5 - i, 99.6 - i) for i in range(6)]
    low1 = [(94.5, 95.0, 90.0, 94.6)]
    up = [(95 + i, 95.8 + i, 94.8 + i, 95.6 + i) for i in range(6)]
    down2 = [(100.5 - i, 101.0 - i, 95.0 - i, 95.5 - i) for i in range(5)]
    low2 = [(94.6, 95.0, 90.5, 94.8)]
    rise = [(95.0 + i, 96.0 + i, 94.9 + i, 95.9 + i) for i in range(5)]
    brk = [(100.5, 103.5, 100.4, 103.2)]
    rows = base * 5 + down + low1 + up + down2 + low2 + rise + brk
    d = detect(frame(rows))
    assert d["double_bottom"].iloc[-1]
    assert not np.any(d["double_bottom"].iloc[:-1])
