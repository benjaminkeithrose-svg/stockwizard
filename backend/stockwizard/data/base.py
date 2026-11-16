"""The interface every candle source implements.

The app never talks to a data provider directly. Swapping the free
development source for IBKR or a paid provider means adding a class here,
nothing else.
"""

from __future__ import annotations

from datetime import date
from typing import Protocol

import pandas as pd


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


def drop_unfinished(df: pd.DataFrame, bar: pd.Timedelta, now: pd.Timestamp) -> pd.DataFrame:
    """Remove candles whose close time (open + bar) is still in the future."""
    return df[df.index + bar <= now]
