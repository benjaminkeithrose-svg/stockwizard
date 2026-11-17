"""Writes symbols and candles to Supabase through its REST API.

Runs server-side only. Reads SUPABASE_URL and SUPABASE_SECRET_KEY (the
secret/service-role key) from the environment; neither is ever committed or
sent to the browser.
"""

from __future__ import annotations

import json
import math
import os
import urllib.error
import urllib.parse
import urllib.request
from typing import Callable, Iterable

import pandas as pd

from stockwizard import __version__

BATCH = 1000

# (method, url, headers, body) -> (status code, response body). Replaced in tests.
Sender = Callable[[str, str, dict, bytes | None], tuple[int, bytes]]


def _urllib_send(method: str, url: str, headers: dict, body: bytes | None) -> tuple[int, bytes]:
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def _clean(v):
    """JSON has no NaN or infinity: write them as empty (null)."""
    if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
        return None
    if isinstance(v, dict):
        return {k: _clean(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [_clean(x) for x in v]
    return v


def _json(rows) -> bytes:
    return json.dumps(_clean(rows), allow_nan=False).encode()


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
            status, body = self.send(
                "POST",
                f"{self.url}/rest/v1/{table}?on_conflict={on_conflict}",
                self._headers(),
                _json(chunk),
            )
            if status >= 300:
                raise RuntimeError(f"Supabase refused {table} batch starting at row {i}: HTTP {status} {body[:300]!r}")
            written += len(chunk)
        return written

    def select(self, table: str, query: dict[str, str]) -> list[dict]:
        """Rows from a table. `query` is PostgREST's: {"select": "...", "symbol": "eq.SPY", "order": "ts.desc"}."""
        rows: list[dict] = []
        limit = int(query.get("limit", 10**9))
        while len(rows) < limit:
            q = {**query, "limit": str(min(BATCH, limit - len(rows))), "offset": str(len(rows))}
            status, body = self.send("GET", f"{self.url}/rest/v1/{table}?{urllib.parse.urlencode(q)}", self._headers(), None)
            if status >= 300:
                raise RuntimeError(f"Supabase refused reading {table}: HTTP {status} {body[:300]!r}")
            page = json.loads(body or b"[]")
            rows.extend(page)
            if len(page) < BATCH:
                break
        return rows

    def insert(self, table: str, rows: list[dict], returning: bool = False) -> list[dict]:
        headers = {**self._headers(), "Prefer": "return=representation" if returning else "return=minimal"}
        status, body = self.send("POST", f"{self.url}/rest/v1/{table}", headers, _json(rows))
        if status >= 300:
            raise RuntimeError(f"Supabase refused writing {table}: HTTP {status} {body[:300]!r}")
        return json.loads(body) if returning and body else []

    def update(self, table: str, match: dict[str, str], values: dict) -> list[dict]:
        """Change the rows matching `match` (PostgREST filters, e.g. {"id": "eq.5"}); returns them as changed."""
        headers = {**self._headers(), "Prefer": "return=representation"}
        url = f"{self.url}/rest/v1/{table}?{urllib.parse.urlencode(match)}"
        status, body = self.send("PATCH", url, headers, _json(values))
        if status >= 300:
            raise RuntimeError(f"Supabase refused updating {table}: HTTP {status} {body[:300]!r}")
        return json.loads(body) if body else []

    def read_candles(self, symbol: str, timeframe: str, source: str, before: pd.Timestamp, count: int) -> pd.DataFrame:
        """The last `count` candles that opened before `before`, oldest first, as a candle frame."""
        rows = self.select(
            "candles",
            {
                "select": "ts,open,high,low,close,volume",
                "symbol": f"eq.{symbol}",
                "timeframe": f"eq.{timeframe}",
                "source": f"eq.{source}",
                "ts": f"lt.{before.isoformat()}",
                "order": "ts.desc",
                "limit": str(count),
            },
        )
        if not rows:
            return pd.DataFrame(columns=["open", "high", "low", "close", "volume"], index=pd.DatetimeIndex([], tz="UTC"))
        df = pd.DataFrame(rows)
        df.index = pd.to_datetime(df.pop("ts"), utc=True)
        return df.sort_index()[["open", "high", "low", "close", "volume"]].astype(float)

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
