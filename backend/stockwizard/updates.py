"""Updates from inside Stock Wizard (Ben, 18 Nov 2026: one installed program, stage 4).

The installed program checks GitHub for a newer release when it starts and every
6 hours. When there is one, the icon by the clock says so and its menu offers the
update. Taking it downloads the installer, checks it against the SHA-256 fingerprint
GitHub publishes for it, starts it to update in place (settings are kept) and closes
Stock Wizard; the installer opens Stock Wizard again when it's done.

Not during the US session: updating stops the bot for about a minute, so the offer
waits for the close. A copy run from the repository (no _release.py) never updates.
"""

from __future__ import annotations

import hashlib
import json
import re
import subprocess
import time
import urllib.request
from dataclasses import dataclass
from pathlib import Path

import pandas as pd

RELEASES = "https://api.github.com/repos/benjaminkeithrose-svg/stockwizard/releases/latest"
ASSET = "StockWizardSetup.exe"
CHECK_EVERY = 6 * 3600.0
NY = "America/New_York"


def version_tuple(v: str | None) -> tuple[int, ...] | None:
    """'bot-v0.1.10' or '0.1.10' → (0, 1, 10)."""
    m = re.search(r"(\d+(?:\.\d+)+)", v or "")
    return tuple(int(x) for x in m.group(1).split(".")) if m else None


def installed_version(app_dir: Path | None = None) -> str | None:
    """The installed release: written into the program (stockwizard/_release.py) by the installer's build.
    `app_dir` is for tests: a VERSION file there. A copy run from the repository has neither: None."""
    if app_dir is not None:
        f = app_dir / "VERSION"
        return f.read_text(encoding="utf-8").strip() if f.exists() else None
    try:
        from stockwizard._release import RELEASE  # noqa: PLC0415
    except ImportError:
        return None
    return RELEASE


def in_us_session(now: pd.Timestamp) -> bool:
    from stockwizard.zerodte import calendar  # noqa: PLC0415
    ny = now.tz_convert(NY)
    return calendar.is_trading_day(ny.date()) and (9, 30) <= (ny.hour, ny.minute) < (16, 0)


@dataclass
class Release:
    version: str
    url: str
    size: int
    sha256: str | None


def _get(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"Accept": "application/vnd.github+json", "User-Agent": "StockWizard-updater"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


def latest_release(get=_get) -> Release | None:
    d = json.loads(get(RELEASES))
    asset = next((a for a in d.get("assets", []) if a.get("name") == ASSET), None)
    if not asset:
        return None
    digest = asset.get("digest") or ""
    return Release(".".join(map(str, version_tuple(d.get("tag_name")) or ())), asset["browser_download_url"], int(asset["size"]),
                   digest.removeprefix("sha256:") if digest.startswith("sha256:") else None)


def download(release: Release, folder: Path, get=_get) -> Path:
    """The installer, checked against GitHub's size and fingerprint; refused if either differs."""
    data = get(release.url)
    if len(data) != release.size:
        raise ValueError(f"The download is {len(data):,} bytes, not the {release.size:,} GitHub lists: not installing it")
    if release.sha256 and hashlib.sha256(data).hexdigest() != release.sha256:
        raise ValueError("The download's fingerprint doesn't match GitHub's: not installing it")
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"StockWizardSetup-{release.version}.exe"
    path.write_bytes(data)
    return path


def install_command(installer: Path) -> list[str]:
    """Update in place: progress shown, no questions (the person's settings are kept), Stock Wizard reopened after."""
    return [str(installer), "/SILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/RESTART=1"]


class Updater:
    def __init__(self, app_dir: Path | None, download_dir: Path, get=_get, clock=time.monotonic, now=lambda: pd.Timestamp.now(tz="UTC"),
                 launch=None):
        self.current = installed_version(app_dir)
        self.download_dir, self.get, self.clock, self.now = download_dir, get, clock, now
        self.launch = launch or (lambda cmd: subprocess.Popen(cmd, creationflags=getattr(subprocess, "DETACHED_PROCESS", 0)))
        self.available: Release | None = None
        self.last_check: float | None = None
        self.error: str | None = None

    @property
    def enabled(self) -> bool:
        return self.current is not None

    def maybe_check(self) -> Release | None:
        """Ask GitHub at start and every 6 hours; returns a release newly found to be newer."""
        if not self.enabled or (self.last_check is not None and self.clock() - self.last_check < CHECK_EVERY):
            return None
        self.last_check = self.clock()
        try:
            r = latest_release(self.get)
        except Exception as e:  # noqa: BLE001 - offline, GitHub busy: try again next time
            self.error = str(e)
            return None
        self.error = None
        new = r if r and (version_tuple(r.version) or ()) > (version_tuple(self.current) or ()) else None
        found = new is not None and (self.available is None or self.available.version != new.version)
        self.available = new
        return new if found else None

    def label(self) -> str:
        if not self.enabled:
            return "Updates: not for a copy run from the repository"
        if self.available is None:
            return f"Version {self.current}: up to date"
        if in_us_session(self.now()):
            return f"Update to {self.available.version} after the US close"
        return f"Update to {self.available.version}"

    def can_apply(self) -> bool:
        return self.available is not None and not in_us_session(self.now())

    def apply(self) -> Path:
        """Download, check, and start the installer. The caller then closes Stock Wizard so its files can be replaced."""
        if not self.can_apply():
            raise RuntimeError("No update to install now")
        path = download(self.available, self.download_dir, self.get)
        self.launch(install_command(path))
        return path
