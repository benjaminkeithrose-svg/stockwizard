"""A person's bot signing in with a bot key (multi-user), against a stand-in Supabase. Nothing leaves the machine."""

from __future__ import annotations

import base64
import json

import pytest

from stockwizard.data.store import PUBLISHABLE_KEY, SupabaseStore, read_bot_key
from stockwizard.run_bot import find_owner


def make_key(email="bot-1@stockwizard.invalid", password="s3cret"):
    return "swbot1." + base64.urlsafe_b64encode(json.dumps({"e": email, "p": password}).encode()).decode().rstrip("=")


class FakeSupabase:
    def __init__(self, accept=True):
        self.calls, self.accept, self.n = [], accept, 0

    def __call__(self, method, url, headers, body):
        self.calls.append((method, url, headers, json.loads(body) if body else None))
        if "/auth/v1/token" in url:
            if not self.accept:
                return 400, b'{"error":"invalid_grant"}'
            self.n += 1
            return 200, json.dumps({"access_token": f"jwt-{self.n}", "refresh_token": f"r-{self.n}", "expires_in": 3600,
                                    "user": {"id": "bot-user-1"}}).encode()
        if "/rest/v1/bot_accounts" in url:
            return 200, b'[{"owner": "person-a"}]'
        return 200, b"[]"


def test_a_bot_key_unpacks_to_the_bot_accounts_sign_in():
    assert read_bot_key(make_key()) == ("bot-1@stockwizard.invalid", "s3cret")
    with pytest.raises(ValueError, match="isn't a Stock Wizard bot key"):
        read_bot_key("sb_secret_abc")


def test_with_a_bot_key_the_bot_signs_in_and_uses_its_own_login_not_a_secret(monkeypatch):
    monkeypatch.delenv("SUPABASE_SECRET_KEY", raising=False)
    sb = FakeSupabase()
    store = SupabaseStore(send=sb, bot_key=make_key(), clock=lambda: 1000.0)
    method, url, headers, body = sb.calls[0]
    assert url.endswith("/auth/v1/token?grant_type=password") and body == {"email": "bot-1@stockwizard.invalid", "password": "s3cret"}
    assert headers["apikey"] == PUBLISHABLE_KEY
    store.select("paper_orders", {"select": "*"})
    _, _, h, _ = sb.calls[-1]
    assert h["apikey"] == PUBLISHABLE_KEY and h["Authorization"] == "Bearer jwt-1"
    assert not store.is_service


def test_the_login_is_renewed_before_it_runs_out(monkeypatch):
    monkeypatch.delenv("SUPABASE_SECRET_KEY", raising=False)
    sb, now = FakeSupabase(), {"t": 1000.0}
    store = SupabaseStore(send=sb, bot_key=make_key(), clock=lambda: now["t"])
    now["t"] += 3400                                   # 56 minutes on: inside the last 5 minutes
    store.select("paper_orders", {"select": "*"})
    renew = [c for c in sb.calls if "grant_type=refresh_token" in c[1]]
    assert renew and renew[0][3] == {"refresh_token": "r-1"}
    assert sb.calls[-1][2]["Authorization"] == "Bearer jwt-2"


def test_a_replaced_key_is_refused_with_what_to_do(monkeypatch):
    monkeypatch.delenv("SUPABASE_SECRET_KEY", raising=False)
    with pytest.raises(RuntimeError, match="Make a new one"):
        SupabaseStore(send=FakeSupabase(accept=False), bot_key=make_key())


def test_with_neither_key_it_says_what_to_add(monkeypatch):
    monkeypatch.delenv("SUPABASE_SECRET_KEY", raising=False)
    monkeypatch.delenv("BOT_KEY", raising=False)
    with pytest.raises(RuntimeError, match="BOT_KEY"):
        SupabaseStore(send=FakeSupabase())


def test_the_bot_works_for_the_person_its_bot_account_belongs_to(monkeypatch):
    monkeypatch.delenv("SUPABASE_SECRET_KEY", raising=False)
    sb = FakeSupabase()
    store = SupabaseStore(send=sb, bot_key=make_key())
    assert find_owner(store) == "person-a"
    assert "bot_user=eq.bot-user-1" in sb.calls[-1][1]


def test_the_secret_key_still_works_and_writes_shared_data():
    store = SupabaseStore(url="https://x.supabase.co", key="sb_secret_x", send=FakeSupabase())
    assert store.is_service and store.bot is None
