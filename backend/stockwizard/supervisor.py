"""Stock Wizard on the PC (Ben, 18 Nov 2026: one installed program, stages 1 and 2).

    pythonw -m stockwizard.supervisor --settings %LOCALAPPDATA%\\StockWizard\\stockwizard.env
    python  -m stockwizard.supervisor --settings pc\\stockwizard.env --data      # Ben's PC: the data program too

One program instead of separate windows. It runs the bot (and with --data, or
RUN_DATA=1 in the settings, the data program) as background processes, keeps
their output in logs, starts a stopped one again a minute later (as the start
files did, so a TWS restart is ridden out), shows their state on an icon by the
clock, and every 30 seconds writes a heartbeat to Supabase (`pc_status`) for the
app's PC status line, on any device. Only one runs at a time on a PC: two bots
on one TWS would clash; opening it again shows the running one's window.

Stage 2: the app in its own window (pywebview, Windows' Edge engine), which
remembers the sign-in and only hides when closed, and a Settings screen
(pc_settings.py) instead of Notepad. Quit from the icon stops everything.
"""

from __future__ import annotations

import argparse
import os
import re
import socket
import subprocess
import sys
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path

from stockwizard import __version__

RESTART_AFTER = 60.0
BEAT_EVERY = 30.0
LOCK_PORT = 47917            # one supervisor per PC: the second can't take this port
LOG_LIMIT = 5_000_000


def read_settings(path: Path) -> dict[str, str]:
    """KEY=VALUE lines, as the start files read them."""
    out = {}
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        k, sep, v = line.partition("=")
        if sep and k.strip() and not k.strip().startswith("#"):
            out[k.strip()] = v.strip()
    return out


def load_settings(path: Path) -> dict[str, str]:
    """The settings for the programs (stage 3): a plain secret key in the file is encrypted there with
    Windows' protection (SUPABASE_SECRET_KEY_PROTECTED) and only ever decrypted in memory; the archive
    lives beside the settings unless ARCHIVE_PATH says otherwise."""
    s = read_settings(path)
    plain = s.get("SUPABASE_SECRET_KEY")
    if plain and sys.platform == "win32":
        from stockwizard.winsecret import protect  # noqa: PLC0415
        lines = path.read_text(encoding="utf-8-sig").splitlines()
        lines = [f"SUPABASE_SECRET_KEY_PROTECTED={protect(plain)}" if ln.partition("=")[0].strip() == "SUPABASE_SECRET_KEY" else ln
                 for ln in lines]
        tmp = path.with_suffix(".tmp")
        tmp.write_text("\n".join(lines) + "\n", encoding="utf-8")
        tmp.replace(path)
    elif not plain and s.get("SUPABASE_SECRET_KEY_PROTECTED"):
        from stockwizard.winsecret import unprotect  # noqa: PLC0415
        s["SUPABASE_SECRET_KEY"] = unprotect(s["SUPABASE_SECRET_KEY_PROTECTED"])
    s.pop("SUPABASE_SECRET_KEY_PROTECTED", None)
    s.setdefault("ARCHIVE_PATH", str(path.parent / "archive.sqlite"))
    return s


def _account(line: str) -> str:
    m = re.search(r"paper account (DU\w*)", line)
    return f"paper account {m.group(1)[:2]}…{m.group(1)[-3:]}" if m else "paper account"


def read_line(kind: str, line: str) -> tuple[str | None, str | None]:
    """What one line of a program's output says: (new state or None, plain detail or None)."""
    s = line.strip()
    if not s or s.startswith(("File ", "Traceback", "~", "^", "await ", "return ", "raise ", "self.", "result =", "value =", "sock =")):
        return None, None
    if "API connection failed" in s or "ConnectionRefusedError" in s or "refused the network connection" in s:
        return ("waiting" if kind == "bot" else "stopped"), "TWS isn't taking connections: is it running and logged in to Paper Trading?"
    if "disconnected" in s and "Interactive Brokers" in s:
        return ("waiting" if kind == "bot" else "stopped"), "TWS closed or restarted: reconnecting"
    if "bot key was refused" in s:
        return "stopped", "The bot key was refused: make a new one in the app (Bot key) and put it in the settings"
    if "Set BOT_KEY" in s:
        return "stopped", "No bot key in the settings"
    if "isn't a paper account" in s:
        return "stopped", "TWS is logged in to a live account: log in to Paper Trading"
    if kind == "bot":
        if s.startswith("Connected to Interactive Brokers"):
            return "connected", f"Connected, {_account(s)}"
        if s.startswith(("Order ", "Request ")):
            return None, s[:160]
        return None, None
    if s.startswith("Connected to Interactive Brokers for data"):
        return "catching up", "Catching up on candles"
    if s.startswith("Caught up"):
        return "idle", s.rstrip(".")
    if s.startswith("Streaming"):
        return "streaming", s.rstrip(".")
    if s.startswith("Stopped streaming"):
        return "idle", "Session over: waiting for the after-close update"
    if s.startswith("Archive:") and "backed up" in s:
        return "idle", "After-close update done: " + s[:120]
    if s.startswith("The data program writes"):
        return "stopped", "Needs the secret key: the data program runs only on Ben's PC"
    return None, None


@dataclass
class Child:
    kind: str                      # "bot" or "data"
    args: list[str]
    log: Path
    state: str = "starting"
    detail: str | None = None
    proc: object = None
    restart_at: float | None = None
    lines: list[str] = field(default_factory=list)

    def take(self, line: str) -> None:
        state, detail = read_line(self.kind, line)
        if state:
            self.state = state
        if detail:
            self.detail = detail
        self.lines = (self.lines + [line.rstrip()])[-200:]


class Supervisor:
    def __init__(self, python: str, settings: dict[str, str], run_data: bool, log_dir: Path,
                 popen=subprocess.Popen, clock=time.monotonic, port_open=None, beat=None):
        self.python, self.log_dir, self.clock, self.popen, self.beat_fn = python, log_dir, clock, popen, beat
        self._port_open = port_open
        log_dir.mkdir(parents=True, exist_ok=True)
        self.last_beat: float | None = None
        self.stopping = False
        self.version = __version__   # the installed release number replaces it (updates.py)
        self.configure(settings, run_data)

    def configure(self, settings: dict[str, str], run_data: bool) -> None:
        self.settings = settings
        self.port = int(settings.get("IB_PORT") or 7497)
        self.port_open = self._port_open or (lambda: _port_open(self.port))
        delayed = ["--delayed"] if settings.get("IB_DELAYED", "").lower() in ("1", "yes", "true") else []
        self.children = [Child("bot", [self.python, "-u", "-m", "stockwizard.run_bot", "--broker", "ibkr", "--port", str(self.port), *delayed, "--loop", "30"],
                               self.log_dir / "bot.log")]
        if run_data:
            self.children.append(Child("data", [self.python, "-u", "-m", "stockwizard.run_data", "--port", str(self.port)], self.log_dir / "data.log"))

    def reload(self, settings: dict[str, str], run_data: bool) -> None:
        """New settings from the Settings screen: stop the programs and start them again with them."""
        for c in self.children:
            if c.proc is not None and c.proc.poll() is None:
                c.proc.terminate()
                try:
                    c.proc.wait(timeout=10)
                except Exception:  # noqa: BLE001
                    c.proc.kill()
        self.configure(settings, run_data)
        self.last_beat = None   # tell the app straight away

    def child(self, kind: str) -> Child | None:
        return next((c for c in self.children if c.kind == kind), None)

    def start(self, c: Child) -> None:
        if c.log.exists() and c.log.stat().st_size > LOG_LIMIT:
            c.log.replace(c.log.with_suffix(".old.log"))
        env = {**os.environ, **self.settings, "PYTHONUNBUFFERED": "1", "PYTHONIOENCODING": "utf-8"}
        flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        first = c.proc is None
        c.proc = self.popen(c.args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=env, creationflags=flags,
                            text=True, encoding="utf-8", errors="replace")
        c.restart_at = None
        if first:
            c.state = "starting"   # a restart keeps "stopped" or "waiting", and why, until the program says otherwise
        threading.Thread(target=self._read, args=(c, c.proc), daemon=True).start()

    def _read(self, c: Child, proc) -> None:
        with open(c.log, "a", encoding="utf-8") as log:
            log.write(f"\n--- started {time.strftime('%Y-%m-%d %H:%M:%S')} ---\n")
            for line in proc.stdout:
                log.write(line)
                log.flush()
                c.take(line)

    def poll(self) -> None:
        """Start what isn't running; note what stopped and start it again a minute later."""
        now = self.clock()
        for c in self.children:
            if self.stopping:
                return
            if c.proc is None:
                self.start(c)
            elif c.proc.poll() is not None and c.restart_at is None:
                if c.state not in ("stopped",):
                    c.state = "waiting" if c.kind == "bot" else "stopped"
                err = next((ln for ln in reversed(c.lines) if re.match(r"^\w+(Error|Exception|Exit)\b", ln.strip())), None)
                if err and (c.detail is None or c.state == "stopped" and not c.detail.startswith(("TWS", "The bot key", "No bot key", "Needs"))):
                    c.detail = "Stopped: " + err.strip()[:150]
                c.restart_at = now + RESTART_AFTER
            elif c.restart_at is not None and now >= c.restart_at:
                self.start(c)
        if self.beat_fn and (self.last_beat is None or now - self.last_beat >= BEAT_EVERY):
            self.last_beat = now
            try:
                self.beat_fn(self.status())
            except Exception:  # noqa: BLE001 - the status line is a display; never stop the bots over it
                pass

    def status(self) -> dict:
        bot, data = self.child("bot"), self.child("data")
        connected = any(c.state in ("connected", "catching up", "idle", "streaming") for c in self.children)
        return {
            "host": socket.gethostname(), "version": self.version,
            "bot_state": bot.state, "bot_detail": bot.detail,
            "data_state": data.state if data else "off", "data_detail": data.detail if data else None,
            "tws_open": connected or bool(self.port_open()),
        }

    def stop(self) -> None:
        self.stopping = True
        for c in self.children:
            if c.proc is not None and c.proc.poll() is None:
                c.proc.terminate()
                try:
                    c.proc.wait(timeout=10)
                except Exception:  # noqa: BLE001
                    c.proc.kill()
            c.state = "off" if c.kind == "data" else "stopped"
            c.detail = "Stock Wizard was closed on the PC"
        if self.beat_fn:
            try:
                self.beat_fn(self.status())
            except Exception:  # noqa: BLE001
                pass


def _port_open(port: int) -> bool:
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=1):
            return True
    except OSError:
        return False


def heartbeat(store, owner: str):
    def beat(s: dict) -> None:
        store.upsert("pc_status", "owner", [{"owner": owner, "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), **s}])
    return beat


# --- the icon by the clock ---

COLOURS = {"connected": "#237F35", "waiting": "#C77700", "starting": "#C77700", "stopped": "#B2232F"}


def _icon_image(state: str, size: int = 64):
    """A filled circle in the bot's state colour with a bold white S, readable at the clock's 16 pixels."""
    from PIL import Image, ImageDraw, ImageFont  # noqa: PLC0415
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.ellipse((1, 1, size - 2, size - 2), fill=COLOURS.get(state, "#7A7A7A"), outline="white", width=max(2, size // 22))
    font = None
    for name in ("segoeuib.ttf", "arialbd.ttf"):   # Windows' bold faces; a plain default elsewhere
        try:
            font = ImageFont.truetype(name, int(size * 0.72))
            break
        except OSError:
            continue
    font = font or ImageFont.load_default(size=int(size * 0.72))
    x0, y0, x1, y1 = d.textbbox((0, 0), "S", font=font)
    d.text(((size - (x1 - x0)) / 2 - x0, (size - (y1 - y0)) / 2 - y0), "S", fill="white", font=font)
    return img


APP_URL = "https://benjaminkeithrose-svg.github.io/stockwizard/"


def _run_data(settings: dict[str, str], forced: bool) -> bool:
    return forced or settings.get("RUN_DATA", "").lower() in ("1", "yes", "true")


def run_desktop(sup: Supervisor, settings_path: Path, log_dir: Path, lock: socket.socket, show: bool, forced_data: bool,
                open_settings_first: bool = False) -> None:
    """The app in its own window, the icon by the clock and the Settings screen (stage 2).

    pywebview owns the main thread; the icon, the supervisor's loop and the "show yourself"
    listener run beside it. Closing the window only hides it: the bot keeps running until
    Quit on the icon.
    """
    import pystray  # noqa: PLC0415
    import webview  # noqa: PLC0415

    from stockwizard.pc_settings import PAGE, SettingsApi  # noqa: PLC0415
    from stockwizard.updates import Updater  # noqa: PLC0415

    state: dict = {"quitting": False, "settings": None}
    updater = Updater(None, settings_path.parent / "updates")
    if updater.current:
        sup.version = updater.current   # the installed release, in the app's PC status line
    main = webview.create_window("Stock Wizard", APP_URL, width=1280, height=860, min_size=(380, 600), hidden=not show)

    def on_closing():
        if state["quitting"]:
            return True
        main.hide()          # the bot keeps running; Quit on the icon stops it
        return False
    main.events.closing += on_closing

    def show_main():
        main.show()
        main.restore()

    def saved(_values: dict[str, str]) -> None:
        values = load_settings(settings_path)   # with the secret key decrypted, as at start
        os.environ.update(values)
        sup.reload(values, _run_data(values, forced_data))

    class Api(SettingsApi):
        def close(self):
            w = state["settings"]
            if w is not None:
                w.destroy()

    def open_settings():
        w = state["settings"]
        if w is not None:
            try:
                w.show()
                w.restore()
                return
            except Exception:  # noqa: BLE001 - it was closed: make another
                pass
        w = webview.create_window("Stock Wizard settings", html=PAGE, js_api=Api(settings_path, saved), width=600, height=780)
        w.events.closed += lambda: state.update(settings=None)
        state["settings"] = w

    def quit_(icon, _item):
        state["quitting"] = True
        sup.stop()
        icon.stop()
        for w in list(webview.windows):
            w.destroy()

    def label(kind: str):
        def text(_item) -> str:
            c = sup.child(kind)
            if c is None:
                return "Data program: off"
            return f"{'Bot' if kind == 'bot' else 'Data'}: {c.state}" + (f" · {c.detail[:70]}" if c.detail else "")
        return text

    def update(icon, _item):
        """Stage 4: download and check the new installer, start it, and close so it can replace the files."""
        def run():
            try:
                updater.apply()
            except Exception as e:  # noqa: BLE001 - say why and carry on as before
                icon.notify(f"The update didn't start: {e}", "Stock Wizard")
                return
            quit_(icon, None)
        threading.Thread(target=run, daemon=True).start()

    backtests = {"running": False}

    def run_backtests(icon, _item):
        """Ben's PC only (the secret key): the backtests, option backtests and pattern lab on the archive, one after another."""
        if backtests["running"]:
            return
        backtests["running"] = True

        def run():
            env = {**os.environ, **sup.settings, "PYTHONUNBUFFERED": "1", "PYTHONIOENCODING": "utf-8"}
            flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
            failed = []
            try:
                with open(log_dir / "backtests.log", "a", encoding="utf-8") as log:
                    for mod in ("stockwizard.run_backtests", "stockwizard.run_option_backtests", "stockwizard.run_lab"):
                        log.write(f"\n--- {mod} started {time.strftime('%Y-%m-%d %H:%M:%S')} ---\n")
                        log.flush()
                        if subprocess.call([sup.python, "-u", "-m", mod], stdout=log, stderr=subprocess.STDOUT, env=env,
                                           creationflags=flags) != 0:
                            failed.append(mod.rsplit(".", 1)[1])
                icon.notify("Backtests finished." if not failed else f"Backtests finished; failed: {', '.join(failed)} (see Logs).",
                            "Stock Wizard")
            finally:
                backtests["running"] = False
        threading.Thread(target=run, daemon=True).start()

    icon = pystray.Icon("stockwizard", _icon_image("starting"), "Stock Wizard", menu=pystray.Menu(
        pystray.MenuItem("Open Stock Wizard", lambda: show_main(), default=True),
        pystray.MenuItem(label("bot"), None, enabled=False),
        pystray.MenuItem(label("data"), None, enabled=False),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem("Settings", lambda: open_settings()),
        pystray.MenuItem("Logs", lambda: os.startfile(log_dir)),  # noqa: S606 - opens the logs folder
        pystray.MenuItem(lambda _i: "Backtests running…" if backtests["running"] else "Run backtests", run_backtests,
                         enabled=lambda _i: not backtests["running"],
                         visible=lambda _i: bool(sup.settings.get("SUPABASE_SECRET_KEY"))),
        pystray.MenuItem(lambda _i: updater.label(), update, enabled=lambda _i: updater.can_apply()),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem("Quit (stops the bot)", quit_),
    ))

    def requests():
        """Stock Wizard opened again (Start menu, a second double-click): show the window, or the settings."""
        lock.listen(4)
        while not state["quitting"]:
            try:
                conn, _ = lock.accept()
            except OSError:
                return
            with conn:
                what = conn.recv(32).decode(errors="ignore").strip()
            (open_settings if what == "settings" else show_main)()

    def loop():
        while not sup.stopping:
            found = updater.maybe_check()
            if found:
                icon.notify(f"Stock Wizard {found.version} is ready. Right-click the icon by the clock and choose Update"
                            + (" after the US close." if not updater.can_apply() else "."), "Stock Wizard update")
            sup.poll()
            bot = sup.child("bot")
            icon.icon = _icon_image(bot.state)
            icon.title = f"Stock Wizard: bot {bot.state}" + (f", data {sup.child('data').state}" if sup.child("data") else "")
            icon.update_menu()
            time.sleep(1)

    def started():
        icon.run_detached()
        threading.Thread(target=requests, daemon=True).start()
        threading.Thread(target=loop, daemon=True).start()
        if open_settings_first:
            open_settings()

    storage = settings_path.parent / "window"
    storage.mkdir(parents=True, exist_ok=True)
    webview.start(started, private_mode=False, storage_path=str(storage))   # keeps the app's sign-in between runs


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    default = Path(os.environ.get("LOCALAPPDATA", ".")) / "StockWizard" / "stockwizard.env"
    p.add_argument("--settings", type=Path, default=default)
    p.add_argument("--data", action="store_true", help="also run the data program (Ben's PC; or RUN_DATA=1 in the settings)")
    p.add_argument("--show", action="store_true", help="open the app's window (the Start menu); without it, just the icon (signing in to Windows)")
    p.add_argument("--open-settings", action="store_true", help="open the Settings screen")
    p.add_argument("--no-tray", action="store_true", help="no window or icon: run until stopped (for testing)")
    a = p.parse_args(argv)
    lock = socket.socket()
    try:
        lock.bind(("127.0.0.1", LOCK_PORT))   # held while this runs: one Stock Wizard per PC
    except OSError:
        # Already running: ask it to show its window (or its settings) instead of starting a second copy.
        try:
            with socket.create_connection(("127.0.0.1", LOCK_PORT), timeout=3) as c:
                c.sendall(b"settings" if a.open_settings else b"show")
            return 0
        except OSError:
            print("Stock Wizard is already running on this PC (look for its icon by the clock).")
            return 1
    if not a.settings.exists():
        print(f"No settings at {a.settings}: run the installer again and paste your bot key.")
        return 1
    settings = load_settings(a.settings)
    os.environ.update(settings)
    python = sys.executable.replace("pythonw.exe", "python.exe")
    log_dir = a.settings.parent / "logs"
    beat = None
    try:
        from stockwizard.data.store import SupabaseStore  # noqa: PLC0415
        from stockwizard.run_bot import find_owner  # noqa: PLC0415
        store = SupabaseStore()
        beat = heartbeat(store, find_owner(store))
    except BaseException as e:  # noqa: BLE001 - the bots still run; the status line just won't show
        print(f"No PC status line: {e}")
    sup = Supervisor(python, settings, _run_data(settings, a.data), log_dir, beat=beat)
    if a.no_tray:
        try:
            while True:
                sup.poll()
                time.sleep(1)
        except KeyboardInterrupt:
            sup.stop()
        return 0
    run_desktop(sup, a.settings, log_dir, lock, show=a.show or a.open_settings, forced_data=a.data, open_settings_first=a.open_settings)
    lock.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
