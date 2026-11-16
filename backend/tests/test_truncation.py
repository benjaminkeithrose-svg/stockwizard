"""The truncation test (SPEC.md, Backtesting engine rule 8).

Compute every indicator on the full history, then again with the final
candles removed. Every value on the remaining candles must be identical. If
one changes, the indicator used a candle from its future: a look-ahead bug.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from stockwizard.indicators import REGISTRY, compute

TOLERANCE = 1e-9


def _params(name: str, candles: pd.DataFrame) -> dict:
    if name == "anchored_vwap":
        return {"anchor": candles.index[len(candles) // 5].isoformat()}
    return {}


def _cut_points(n: int) -> list[int]:
    # Early (inside warm-up), middle, and the very last candle removed.
    return sorted({5, 30, n // 3, n // 2, (2 * n) // 3, n - 7, n - 1})


def assert_same(full: pd.DataFrame, cut: pd.DataFrame, label: str) -> None:
    head = full.iloc[: len(cut)]
    assert list(head.columns) == list(cut.columns), label
    for col in head.columns:
        a, b = head[col], cut[col]
        a_na, b_na = a.isna().to_numpy(), b.isna().to_numpy()
        bad = a_na != b_na
        both = ~a_na & ~b_na
        if both.any():
            av = a.to_numpy()[both].astype(float)
            bv = b.to_numpy()[both].astype(float)
            diff = np.zeros(len(a), dtype=bool)
            diff[both] = ~np.isclose(av, bv, rtol=TOLERANCE, atol=TOLERANCE)
            bad |= diff
        if bad.any():
            first = head.index[np.flatnonzero(bad)[0]]
            raise AssertionError(f"{label}: column {col} changed at {first} when later candles were removed")


def _cases():
    for name, ind in REGISTRY.items():
        yield pytest.param(name, "intraday", id=f"{name}-5m")
        if not ind.intraday_only:
            yield pytest.param(name, "daily", id=f"{name}-1d")


@pytest.mark.parametrize("name,frame", list(_cases()))
def test_no_indicator_looks_ahead(name, frame, request):
    candles = request.getfixturevalue(frame)
    timeframe = "5m" if frame == "intraday" else "1d"
    params = _params(name, candles)
    full = compute(name, candles, timeframe, **params)
    assert len(full) == len(candles)
    assert full.notna().any().any(), f"{name} produced no values at all"
    for k in _cut_points(len(candles)):
        cut = compute(name, candles.iloc[:k], timeframe, **params)
        assert_same(full, cut, f"{name} cut at {k}")


def test_truncation_test_catches_look_ahead(daily):
    """Prove the test itself works: a centred average peeks ahead and must be caught."""

    def leaky(df):
        return pd.DataFrame({"centred": df["close"].rolling(5, center=True).mean()})

    full = leaky(daily)
    with pytest.raises(AssertionError, match="changed"):
        assert_same(full, leaky(daily.iloc[:200]), "leaky")


def test_every_registered_indicator_is_covered():
    covered = {p.values[0] for p in _cases()}
    assert covered == set(REGISTRY)
