"""Traditional patterns traders have long watched for (Ben, 19 Nov 2026), as flags on daily candles.

Each pattern is a True/False series: True on the day the pattern is complete, known at that
day's close from that day and earlier ones only. A chart pattern counts only on the day it's
confirmed (a flag on the day it breaks out, a double bottom on the day it clears its
neckline), never while it's still forming, because a forming pattern can only be named
looking back. tests/test_patterns.py proves it with the truncation test: cut the candles off
at any day and every earlier answer stays the same.

Candlestick patterns (one to three candles):
    bull_engulf, bear_engulf    a candle whose body swallows the previous one's, against the recent move
    hammer, shooting_star       a long lower (upper) shadow after a fall (rise)
    doji                        open and close almost equal: indecision
    morning_star, evening_star  a long candle, a small one, then a strong one the other way
    inside_bar                  today's range inside yesterday's
    three_soldiers, three_crows three strong candles in a row, each closing further on

Chart patterns (confirmed on the breakout day):
    bull_flag, bear_flag        a sharp move (the pole), a tight pause, then a break the same way
    double_bottom, double_top   two lows (highs) at about the same price, then a break of the
                                high (low) between them
    triangle_up, triangle_down  a flat top with rising lows breaking up (a flat bottom with falling
                                highs breaking down)
    breakout_20, breakdown_20   a close above the last 20 days' highs (below their lows)
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from stockwizard.candles import validate
from stockwizard.indicators import core

#: Pattern name to how it reads in the Lab.
PATTERNS: dict[str, str] = {
    "bull_engulf": "bullish engulfing candle",
    "bear_engulf": "bearish engulfing candle",
    "hammer": "hammer candle after a fall",
    "shooting_star": "shooting star after a rise",
    "doji": "doji (open and close almost equal)",
    "morning_star": "morning star (three-candle turn up)",
    "evening_star": "evening star (three-candle turn down)",
    "inside_bar": "inside bar",
    "three_soldiers": "three white soldiers",
    "three_crows": "three black crows",
    "bull_flag": "bull flag breaking out",
    "bear_flag": "bear flag breaking down",
    "double_bottom": "double bottom confirmed",
    "double_top": "double top confirmed",
    "triangle_up": "ascending triangle breaking out",
    "triangle_down": "descending triangle breaking down",
    "breakout_20": "close above its 20-day high",
    "breakdown_20": "close below its 20-day low",
}

SWING = 3          # a swing low (high) is the lowest (highest) of 3 candles each side: known 3 days later


def _candles(df: pd.DataFrame) -> dict[str, np.ndarray]:
    o, h, l, c = (df[k].to_numpy(dtype=float) for k in ("open", "high", "low", "close"))
    body = np.abs(c - o)
    # The usual body size: the 10 candles before (never today's own).
    avg_body = pd.Series(body).shift(1).rolling(10, min_periods=10).mean().to_numpy()
    ret5 = c / np.concatenate([np.full(5, np.nan), c[:-5]]) - 1   # the move over the last 5 days, into today
    return {"o": o, "h": h, "l": l, "c": c, "body": body, "avg": avg_body, "up": c > o, "down": c < o,
            "top": np.maximum(o, c), "bot": np.minimum(o, c), "rng": h - l, "ret5": ret5}


def _prev(x: np.ndarray, k: int = 1) -> np.ndarray:
    out = np.empty_like(x, dtype=float if x.dtype != bool else bool)
    if x.dtype == bool:
        out[:k] = False
    else:
        out[:k] = np.nan
    out[k:] = x[:-k]
    return out


def candlesticks(df: pd.DataFrame) -> pd.DataFrame:
    x = _candles(df)
    o, c, h, l, body, avg = x["o"], x["c"], x["h"], x["l"], x["body"], x["avg"]
    up, down, top, bot, rng = x["up"], x["down"], x["top"], x["bot"], x["rng"]
    falling, rising = _prev(x["ret5"]) < 0, _prev(x["ret5"]) > 0     # the move before today
    o1, c1, up1, down1, body1 = _prev(o), _prev(c), _prev(up), _prev(down), _prev(body)
    c2, up2, down2, body2, avg2 = _prev(c, 2), _prev(up, 2), _prev(down, 2), _prev(body, 2), _prev(avg, 2)
    o2 = _prev(o, 2)
    lower, upper = bot - l, h - top
    with np.errstate(invalid="ignore"):
        out = {
            "bull_engulf": down1 & up & (o <= c1) & (c >= o1) & (body > body1) & falling,
            "bear_engulf": up1 & down & (o >= c1) & (c <= o1) & (body > body1) & rising,
            "hammer": (rng > 0) & (lower >= 2 * body) & (upper <= 0.5 * np.maximum(body, rng * 0.05)) & falling,
            "shooting_star": (rng > 0) & (upper >= 2 * body) & (lower <= 0.5 * np.maximum(body, rng * 0.05)) & rising,
            "doji": (rng > 0) & (body <= 0.1 * rng),
            "morning_star": down2 & (body2 > avg2) & (body1 < 0.3 * avg2) & up & (c > (o2 + c2) / 2),
            "evening_star": up2 & (body2 > avg2) & (body1 < 0.3 * avg2) & down & (c < (o2 + c2) / 2),
            "inside_bar": (h < _prev(h)) & (l > _prev(l)),
            "three_soldiers": up & up1 & up2 & (c > c1) & (c1 > c2) & (body > 0.5 * avg) & (body1 > 0.5 * avg) & (body2 > 0.5 * avg)
                              & (o > o1) & (o1 > o2),
            "three_crows": down & down1 & down2 & (c < c1) & (c1 < c2) & (body > 0.5 * avg) & (body1 > 0.5 * avg) & (body2 > 0.5 * avg)
                           & (o < o1) & (o1 < o2),
        }
    return pd.DataFrame({k: np.nan_to_num(v.astype(float), nan=0.0).astype(bool) for k, v in out.items()}, index=df.index)


def _swings(values: np.ndarray, low: bool) -> list[tuple[int, int]]:
    """Swing points as (index, day it became known): the lowest (highest) of SWING candles each side."""
    out = []
    n = len(values)
    for i in range(SWING, n - SWING):
        w = values[i - SWING:i + SWING + 1]
        v = values[i]
        if np.isnan(v):
            continue
        if (low and v == np.nanmin(w) and np.sum(w == v) == 1) or (not low and v == np.nanmax(w) and np.sum(w == v) == 1):
            out.append((i, i + SWING))
    return out


def chart_patterns(df: pd.DataFrame) -> pd.DataFrame:
    x = _candles(df)
    h, l, c = x["h"], x["l"], x["c"]
    n = len(c)
    atr = core.atr(df, 14)["atr"].to_numpy()
    res = {k: np.zeros(n, dtype=bool) for k in ("bull_flag", "bear_flag", "double_bottom", "double_top", "triangle_up", "triangle_down")}

    # 20-day breakouts: today's close beyond the 20 days before (not counting today).
    hi20 = pd.Series(h).shift(1).rolling(20, min_periods=20).max().to_numpy()
    lo20 = pd.Series(l).shift(1).rolling(20, min_periods=20).min().to_numpy()
    with np.errstate(invalid="ignore"):
        res["breakout_20"] = c > hi20
        res["breakdown_20"] = c < lo20

    # Flags: a pole (a 5-day move of at least 3 daily ranges ending at bar p), then 3 to 15 quiet bars that
    # give back under half the pole and stay inside it, then today's close breaks out of the pause.
    for t in range(25, n):
        for p in range(t - 15, t - 2):
            if p < 6 or np.isnan(atr[p]):
                continue
            rise, fall = c[p] - c[p - 5], c[p - 5] - c[p]
            pause_h, pause_l = h[p + 1:t].max(), l[p + 1:t].min()
            if rise >= 3 * atr[p] and pause_h <= h[p] and h[p] - pause_l <= 0.5 * rise and c[t] > max(pause_h, h[p]) and c[t - 1] <= max(pause_h, h[p]):
                res["bull_flag"][t] = True
            if fall >= 3 * atr[p] and pause_l >= l[p] and pause_h - l[p] <= 0.5 * fall and c[t] < min(pause_l, l[p]) and c[t - 1] >= min(pause_l, l[p]):
                res["bear_flag"][t] = True

    # Double bottoms and tops, triangles: from swing points known by today.
    lows, highs = _swings(l, low=True), _swings(h, low=False)
    for t in range(n):
        known_lows = [i for i, k in lows if k <= t and t - i <= 80]
        known_highs = [i for i, k in highs if k <= t and t - i <= 80]
        if len(known_lows) >= 2:
            a, b = known_lows[-2], known_lows[-1]
            if b - a >= 10 and abs(l[b] - l[a]) <= 0.02 * l[a]:
                neck = h[a:b + 1].max()
                if c[t] > neck and (t == 0 or c[t - 1] <= neck) and t > b:
                    res["double_bottom"][t] = True
        if len(known_highs) >= 2:
            a, b = known_highs[-2], known_highs[-1]
            if b - a >= 10 and abs(h[b] - h[a]) <= 0.02 * h[a]:
                neck = l[a:b + 1].min()
                if c[t] < neck and (t == 0 or c[t - 1] >= neck) and t > b:
                    res["double_top"][t] = True
        if len(known_highs) >= 2 and len(known_lows) >= 2:
            (ha, hb), (la, lb) = known_highs[-2:], known_lows[-2:]
            top = max(h[ha], h[hb])
            if abs(h[hb] - h[ha]) <= 0.01 * h[ha] and l[lb] > l[la] and c[t] > top and c[t - 1] <= top and t > max(hb, lb):
                res["triangle_up"][t] = True
            bottom = min(l[la], l[lb])
            if abs(l[lb] - l[la]) <= 0.01 * l[la] and h[hb] < h[ha] and c[t] < bottom and c[t - 1] >= bottom and t > max(hb, lb):
                res["triangle_down"][t] = True
    return pd.DataFrame({k: np.asarray(v, dtype=bool) for k, v in res.items()}, index=df.index)


def detect(df: pd.DataFrame) -> pd.DataFrame:
    """Every pattern, one True/False column each, on daily candles."""
    df = validate(df)
    out = pd.concat([candlesticks(df), chart_patterns(df)], axis=1)
    return out[list(PATTERNS)]
