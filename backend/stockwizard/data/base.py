"""The interface every candle source implements.

The app never talks to a data provider directly. Swapping the free
development source for IBKR or a paid provider means adding a class here,
nothing else.
"""

from __future__ import annotations

from datetime import date
from typing import Protocol

import pandas as pd

#: Which stored candles to read when a symbol has several sources: the broker's first, the free one otherwise.
SOURCES = ["ibkr", "yahoo-unofficial"]


class CandleSource(Protocol):
    #: Stored with every candle (candles.source), e.g. "yahoo-unofficial".
    name: str
    #: Free development sources must say so; nothing they feed is reported as validated.
    validated: bool

    def fetch(self, symbol: str, timeframe: str, start: date | None, end: date | None) -> pd.DataFrame:
        """Candles for one symbol, as a frame that passes stockwizard.candles.validate.

        Only completed candles are returned: a candle still forming is dropped.
        """
        ...


def select_preferred(store, table: str, query: dict[str, str]) -> list[dict]:
    """`store.select` from the first source in SOURCES that has rows: one source, never a mix of two.

    Two sources stamp the same day differently (Yahoo's VIX is an hour later), so mixing them
    would count some days twice: a daily range computed over both would come out about half.
    """
    for src in SOURCES:
        rows = store.select(table, {**query, "source": f"eq.{src}"})
        if rows:
            return rows
    return store.select(table, query)   # rows with no source recorded (test stand-ins); none in the database


def drop_unfinished(df: pd.DataFrame, bar: pd.Timedelta, now: pd.Timestamp) -> pd.DataFrame:
    """Remove candles whose close time (open + bar) is still in the future."""
    return df[df.index + bar <= now]
