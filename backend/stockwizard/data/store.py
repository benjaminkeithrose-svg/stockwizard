"""Writes symbols and candles to Supabase through its REST API.

Runs server-side only. Reads SUPABASE_URL and SUPABASE_SECRET_KEY (the
secret/service-role key) from the environment; neither is ever committed or
sent to the browser.
"""

from __future__ import annotations

import base64
import json
import math
import os
import time
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


#: Stock Wizard's project and its publishable key: public by design (the web app ships them, web/src/config.ts).
DEFAULT_URL = "https://cxpspihahmztfydvdwpd.supabase.co"
PUBLISHABLE_KEY = "sb_publishable_6C3xmFTbEXfkNtt3Xv3Opg_8d0XoGUG"


def read_bot_key(bot_key: str) -> tuple[str, str]:
    """The bot account's email and password packed in a bot key ("swbot1." + base64 JSON), made in the app."""
    prefix, _, body = bot_key.strip().partition(".")
    if prefix != "swbot1" or not body:
        raise ValueError("That isn't a Stock Wizard access key: make one in the app (Menu, then Access key) and copy all of it")
    d = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
    return d["e"], d["p"]


class BotLogin:
    """A person's bot signed in as its bot account (multi-user, 18 Nov 2026): the database lets it act on that
    one person's orders and nothing else. Its login lasts an hour and is renewed before it runs out."""

    def __init__(self, url: str, bot_key: str, send: Sender, clock=time.time):
        self.url, self.send, self.clock = url, send, clock
        self.email, self.password = read_bot_key(bot_key)
        self.token = self.refresh_token = ""
        self.expires_at = 0.0
        self.user_id = ""
        self._login({"email": self.email, "password": self.password}, "password")

    def _login(self, body: dict, grant: str) -> None:
        status, raw = self.send("POST", f"{self.url}/auth/v1/token?grant_type={grant}",
                                {"apikey": PUBLISHABLE_KEY, "Content-Type": "application/json"}, json.dumps(body).encode())
        if status >= 300:
            if grant == "refresh_token":   # the renewal was refused (an old login): sign in afresh
                return self._login({"email": self.email, "password": self.password}, "password")
            raise RuntimeError("The access key was refused: it may have been replaced in the app. Make a new one (Menu, then Access key) "
                               f"and paste it in Stock Wizard's Settings on this PC. (HTTP {status})")
        d = json.loads(raw)
        self.token, self.refresh_token = d["access_token"], d["refresh_token"]
        self.expires_at = self.clock() + float(d.get("expires_in", 3600))
        self.user_id = d["user"]["id"]

    def bearer(self) -> str:
        if self.clock() > self.expires_at - 300:
            self._login({"refresh_token": self.refresh_token}, "refresh_token")
        return self.token


class SupabaseStore:
    def __init__(self, url: str | None = None, key: str | None = None, send: Sender = _urllib_send,
                 bot_key: str | None = None, clock=time.time):
        """With the secret key (Ben's PC: the data program and his bot) it bypasses the database's rules.
        With a bot key (anyone's bot, BOT_KEY) it signs in as that person's bot account instead."""
        self.url = (url or os.environ.get("SUPABASE_URL") or DEFAULT_URL).rstrip("/")
        self.key = key or os.environ.get("SUPABASE_SECRET_KEY", "")
        self.send = send
        self.bot: BotLogin | None = None
        bot_key = bot_key or os.environ.get("BOT_KEY", "")
        if not self.key:
            if not bot_key:
                raise RuntimeError("No access key: make one in the app (Menu, then Access key) and paste it in Stock Wizard's Settings (BOT_KEY), or on Ben's PC SUPABASE_SECRET_KEY")
            self.bot, self.key = BotLogin(self.url, bot_key, send, clock), PUBLISHABLE_KEY

    @property
    def is_service(self) -> bool:
        """True with the secret key: shared data (market snapshots, recorded quotes) is written only this way."""
        return self.bot is None

    def _headers(self) -> dict:
        h = {
            "apikey": self.key,
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates,return=minimal",
        }
        if self.bot is not None:
            h["Authorization"] = f"Bearer {self.bot.bearer()}"
        elif self.key.startswith("eyJ"):  # legacy service_role JWT
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

    def upsert(self, table: str, on_conflict: str, rows: list[dict]) -> int:
        """Insert rows, or replace the ones whose `on_conflict` column already exists."""
        return self._upsert(table, on_conflict, rows)

    def delete(self, table: str, match: dict[str, str]) -> None:
        """Remove the rows matching `match` (PostgREST filters). Refuses an empty match: never a whole table."""
        if not match:
            raise ValueError("delete needs at least one filter")
        url = f"{self.url}/rest/v1/{table}?{urllib.parse.urlencode(match)}"
        status, body = self.send("DELETE", url, {**self._headers(), "Prefer": "return=minimal"}, None)
        if status >= 300:
            raise RuntimeError(f"Supabase refused deleting from {table}: HTTP {status} {body[:300]!r}")

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
