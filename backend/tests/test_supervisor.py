"""The supervisor on the PC, with stand-in programs and a made-up clock. Nothing is started for real."""

from __future__ import annotations

from pathlib import Path

from stockwizard.supervisor import RESTART_AFTER, Supervisor, read_line, read_settings


# --- reading the programs' output ---

def test_the_bots_lines_become_a_plain_state():
    assert read_line("bot", "Connected to Interactive Brokers, paper account DUR367930.") == ("connected", "Connected, paper account DU…930")
    assert read_line("bot", "API connection failed: ConnectionRefusedError(22, ...)")[0] == "waiting"
    assert read_line("bot", "Interactive Brokers disconnected (TWS or IB Gateway closed or restarted): trading stopped.")[0] == "waiting"
    assert read_line("bot", "RuntimeError: The bot key was refused: it may have been replaced")[0] == "stopped"
    assert read_line("bot", "Account U1234567 isn't a paper account (paper accounts start DU). Disconnected.")[0] == "stopped"
    assert read_line("bot", "Order 7: filled at 0.85") == (None, "Order 7: filled at 0.85")
    assert read_line("bot", '  File "C:\\x\\ib.py", line 369, in connect') == (None, None)


def test_the_data_programs_lines_become_a_plain_state():
    assert read_line("data", "Connected to Interactive Brokers for data (read-only, client 30).")[0] == "catching up"
    assert read_line("data", "Caught up.")[0] == "idle"
    assert read_line("data", "Streaming 29 symbols for live bars.")[0] == "streaming"
    assert read_line("data", "Stopped streaming: the session's over.")[0] == "idle"
    assert read_line("data", "API connection failed: ConnectionRefusedError")[0] == "stopped"


def test_settings_are_the_start_files_key_value_lines(tmp_path):
    f = tmp_path / "stockwizard.env"
    f.write_text("BOT_KEY=swbot1.abc=\nIB_PORT=7497\n\n# a note\n", encoding="utf-8")
    assert read_settings(f) == {"BOT_KEY": "swbot1.abc=", "IB_PORT": "7497"}


# --- running them ---

class FakeProc:
    def __init__(self, lines=()):
        self.stdout, self.code, self.terminated = iter(lines), None, False

    def poll(self):
        return self.code

    def terminate(self):
        self.terminated, self.code = True, 0

    def wait(self, timeout=None):
        return self.code


class Launcher:
    def __init__(self):
        self.started = []

    def __call__(self, args, **kw):
        p = FakeProc()
        self.started.append((args, kw, p))
        return p


def sup(tmp_path, settings=None, data=False, beats=None):
    clock = {"t": 0.0}
    launch = Launcher()
    s = Supervisor("python", settings or {"IB_PORT": "7497"}, data, tmp_path / "logs", popen=launch, clock=lambda: clock["t"],
                   port_open=lambda: False, beat=(beats.append if beats is not None else None))
    return s, launch, clock


def test_it_starts_the_bot_with_the_settings_and_no_window(tmp_path):
    s, launch, _ = sup(tmp_path, {"IB_PORT": "4002", "IB_DELAYED": "1", "BOT_KEY": "swbot1.x"})
    s.poll()
    args, kw, _ = launch.started[0]
    assert args[-8:] == ["stockwizard.run_bot", "--broker", "ibkr", "--port", "4002", "--delayed", "--loop", "30"]
    assert kw["env"]["BOT_KEY"] == "swbot1.x" and kw["env"]["PYTHONUNBUFFERED"] == "1"
    assert len(launch.started) == 1, "only the bot: the data program is Ben's"


def test_with_data_it_runs_the_data_program_too(tmp_path):
    s, launch, _ = sup(tmp_path, data=True)
    s.poll()
    assert [a[0][3] for a in launch.started] == ["stockwizard.run_bot", "stockwizard.run_data"]


def test_a_program_that_stops_is_started_again_a_minute_later(tmp_path):
    s, launch, clock = sup(tmp_path)
    s.poll()
    launch.started[0][2].code = 1          # the bot exited (TWS restarted)
    clock["t"] = 5
    s.poll()
    assert s.child("bot").state == "waiting" and len(launch.started) == 1
    clock["t"] = 5 + RESTART_AFTER - 1
    s.poll()
    assert len(launch.started) == 1
    clock["t"] = 5 + RESTART_AFTER
    s.poll()
    assert len(launch.started) == 2


def test_the_heartbeat_goes_every_30_seconds_and_says_whats_running(tmp_path):
    beats = []
    s, launch, clock = sup(tmp_path, beats=beats)
    s.poll()
    s.child("bot").take("Connected to Interactive Brokers, paper account DUR367930.")
    for t in (10, 29):
        clock["t"] = t
        s.poll()
    assert len(beats) == 1
    clock["t"] = 30
    s.poll()
    assert len(beats) == 2
    b = beats[-1]
    assert b["bot_state"] == "connected" and b["data_state"] == "off" and b["tws_open"] is True
    assert b["bot_detail"] == "Connected, paper account DU…930"


def test_quitting_stops_the_programs_and_says_so(tmp_path):
    beats = []
    s, launch, _ = sup(tmp_path, beats=beats)
    s.poll()
    s.stop()
    assert launch.started[0][2].terminated
    assert beats[-1]["bot_state"] == "stopped" and "closed on the PC" in beats[-1]["bot_detail"]
    s.poll()
    assert len(launch.started) == 1, "nothing starts again after quitting"
