"""Writes symbols and candles to Supabase through its REST API.

Runs server-side only. Reads SUPABASE_URL and SUPABASE_SECRET_KEY (the
secret/service-role key) from the environment; neither is ever committed or
sent to the browser.
"""

from __future__ import annotations

import json
import math
import os
import urllib.request
from typing import Callable, Iterable

import pandas as pd

from stockwizard import __version__

BATCH = 1000

# (method, url, headers, body) -> status code. Replaced in tests.
Sender = Callable[[str, str, dict, bytes], int]


def _urllib_send(method: str, url: str, headers: dict, body: bytes) -> int:
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.status


class SupabaseStore:
    def __init__(self, url: str | None = None, key: str | None = None, send: Sender = _urllib_send):
        self.url = (url or os.environ.get("SUPABASE_URL", "")).rstrip("/")
        self.key = key or os.environ.get("SUPABASE_SECRET_KEY", "")
        if not self.url or not self.key:
            raise RuntimeError("Set SUPABASE_URL and SUPABASE_SECRET_KEY to write to Supabase")
        self.send = send

    def _headers(self) -> dict:
        h = {
            "apikey": self.key,
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates,return=minimal",
        }
        if self.key.startswith("eyJ"):  # legacy service_role JWT
            h["Authorization"] = f"Bearer {self.key}"
        return h

    def _upsert(self, table: str, on_conflict: str, rows: list[dict]) -> int:
        written = 0
        for i in range(0, len(rows), BATCH):
            chunk = rows[i : i + BATCH]
            status = self.send(
                "POST",
                f"{self.url}/rest/v1/{table}?on_conflict={on_conflict}",
                self._headers(),
                json.dumps(chunk).encode(),
            )
            if status >= 300:
                raise RuntimeError(f"Supabase refused {table} batch starting at row {i}: HTTP {status}")
            written += len(chunk)
        return written

    def upsert_symbols(self, symbols: Iterable[dict]) -> int:
        return self._upsert("symbols", "symbol", list(symbols))

    def upsert_candles(self, symbol: str, timeframe: str, source: str, candles: pd.DataFrame) -> int:
        return self._upsert("candles", "symbol,timeframe,source,ts", candle_rows(symbol, timeframe, source, candles))


def candle_rows(symbol: str, timeframe: str, source: str, candles: pd.DataFrame) -> list[dict]:
    version = f"stockwizard-{__version__}/split-adjusted"
    rows = []
    for ts, r in candles.iterrows():
        rows.append(
            {
                "symbol": symbol,
                "timeframe": timeframe,
                "ts": ts.isoformat(),
                "open": float(r["open"]),
                "high": float(r["high"]),
                "low": float(r["low"]),
                "close": float(r["close"]),
                "volume": 0.0 if math.isnan(r["volume"]) else float(r["volume"]),
                "source": source,
                "source_version": version,
            }
        )
    return rows
