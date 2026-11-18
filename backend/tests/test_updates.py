"""Updates from inside Stock Wizard, against a stand-in GitHub. Nothing is downloaded or installed."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pandas as pd
import pytest

from stockwizard.updates import Updater, download, install_command, latest_release, version_tuple

INSTALLER = b"pretend installer bytes"
AFTER_CLOSE = pd.Timestamp("2026-11-18 22:00", tz="UTC")    # 17:00 New York
IN_SESSION = pd.Timestamp("2026-11-18 16:00", tz="UTC")     # 11:00 New York


def github(tag="bot-v0.1.12", data=INSTALLER, digest=None):
    calls = []

    def get(url):
        calls.append(url)
        if url.endswith("/releases/latest"):
            return json.dumps({"tag_name": tag, "assets": [{"name": "StockWizardBotSetup.exe", "size": len(data),
                "digest": digest or "sha256:" + hashlib.sha256(data).hexdigest(), "browser_download_url": "https://example.invalid/setup.exe"}]}).encode()
        return data
    get.calls = calls
    return get


def installed(tmp_path, version="0.1.10"):
    app = tmp_path / "app"
    app.mkdir()
    if version:
        (app / "VERSION").write_text(version, encoding="utf-8")
    return app


def updater(tmp_path, version="0.1.10", now=AFTER_CLOSE, **kw):
    clock = {"t": 0.0}
    launched = []
    u = Updater(installed(tmp_path, version), tmp_path / "updates", get=kw.get("get") or github(), clock=lambda: clock["t"],
                now=lambda: now, launch=launched.append)
    return u, clock, launched


def test_versions_compare_as_numbers():
    assert version_tuple("bot-v0.1.10") == (0, 1, 10)
    assert version_tuple("0.1.10") > version_tuple("0.1.9")


def test_a_newer_release_is_found_and_offered(tmp_path):
    u, _, _ = updater(tmp_path)
    found = u.maybe_check()
    assert found.version == "0.1.12" and u.label() == "Update to 0.1.12" and u.can_apply()


def test_the_same_version_is_up_to_date(tmp_path):
    u, _, _ = updater(tmp_path, version="0.1.12")
    assert u.maybe_check() is None and u.label() == "Version 0.1.12: up to date" and not u.can_apply()


def test_github_is_asked_at_start_and_then_every_6_hours(tmp_path):
    get = github()
    u, clock, _ = updater(tmp_path, get=get)
    u.maybe_check()
    clock["t"] = 5 * 3600
    u.maybe_check()
    assert len(get.calls) == 1
    clock["t"] = 6 * 3600
    u.maybe_check()
    assert len(get.calls) == 2


def test_during_the_us_session_the_update_waits_for_the_close(tmp_path):
    u, _, launched = updater(tmp_path, now=IN_SESSION)
    u.maybe_check()
    assert u.label() == "Update to 0.1.12 after the US close" and not u.can_apply()
    with pytest.raises(RuntimeError):
        u.apply()
    assert not launched


def test_taking_the_update_downloads_checks_and_starts_the_installer(tmp_path):
    u, _, launched = updater(tmp_path)
    u.maybe_check()
    path = u.apply()
    assert path.read_bytes() == INSTALLER
    assert launched == [[str(path), "/SILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/RESTART=1"]]


def test_a_download_that_doesnt_match_githubs_fingerprint_is_refused(tmp_path):
    get = github(digest="sha256:" + "0" * 64)
    with pytest.raises(ValueError, match="fingerprint"):
        download(latest_release(get), tmp_path, get)
    assert not list(tmp_path.glob("*.exe")), "nothing kept to run"


def test_a_copy_run_from_the_repository_never_updates(tmp_path):
    get = github()
    u, _, _ = updater(tmp_path, version=None, get=get)
    assert u.maybe_check() is None and not get.calls and "repository" in u.label()


def test_offline_is_tried_again_next_time(tmp_path):
    def down(_url):
        raise OSError("no internet")
    u, _, _ = updater(tmp_path, get=down)
    assert u.maybe_check() is None and u.error == "no internet" and u.label() == "Version 0.1.10: up to date"
