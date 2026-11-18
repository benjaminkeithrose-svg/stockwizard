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
    s = Supervisor("python", settings or {"IB_PORT": "7497", "BOT_KEY": "swbot1.k"}, data, tmp_path / "logs", popen=launch, clock=lambda: clock["t"],
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


# --- stage 2: the Settings screen and restarting with new settings ---

from stockwizard.pc_settings import SettingsApi  # noqa: E402


def settings_file(tmp_path, text):
    f = tmp_path / "stockwizard.env"
    f.write_text(text, encoding="utf-8")
    return f


def test_the_settings_screen_shows_the_settings_but_never_the_key(tmp_path):
    f = settings_file(tmp_path, "BOT_KEY=swbot1.secret\nIB_PORT=4002\nIB_DELAYED=1\nNTFY_TOPIC=sw-abc\n")
    s = SettingsApi(f).load()
    assert s == {"bot_key_set": True, "uses_secret_key": False, "connection": "gateway", "delayed": True, "ntfy_topic": "sw-abc", "run_data": None,
                 "configured": True, "screens": {}}
    assert "swbot1.secret" not in str(s)


def test_saving_keeps_the_key_and_other_lines_and_restarts_the_bot(tmp_path):
    f = settings_file(tmp_path, "BOT_KEY=swbot1.old\nIB_PORT=7497\nSOMETHING=kept\n")
    restarted = []
    r = SettingsApi(f, on_saved=restarted.append).save({"bot_key": "", "connection": "gateway", "delayed": True, "ntfy_topic": "sw-1"})
    assert r == {"ok": True}
    v = read_settings(f)
    assert v == {"BOT_KEY": "swbot1.old", "SOMETHING": "kept", "IB_PORT": "4002", "IB_DELAYED": "1", "NTFY_TOPIC": "sw-1"}
    assert restarted and restarted[0]["IB_PORT"] == "4002"


def test_a_new_key_replaces_the_old_and_a_wrong_one_is_refused(tmp_path):
    f = settings_file(tmp_path, "BOT_KEY=swbot1.old\n")
    api = SettingsApi(f)
    assert "isn't an access key" in api.save({"bot_key": "sb_secret_xyz", "connection": "tws"})["error"]
    assert read_settings(f)["BOT_KEY"] == "swbot1.old", "nothing written when it's refused"
    api.save({"bot_key": " swbot1.new ", "connection": "tws"})
    assert read_settings(f)["BOT_KEY"] == "swbot1.new"


def test_no_key_yet_saves_and_waits_to_be_set_up(tmp_path):
    f = settings_file(tmp_path, "IB_PORT=7497\n")
    api = SettingsApi(f)
    assert api.save({"bot_key": "", "connection": "tws"}) == {"ok": True}
    assert api.load()["configured"] is False
    s, launch, _ = sup(tmp_path, {"IB_PORT": "7497"})
    s.poll()
    assert launch.started == [] and s.child("bot").state == "setup" and "Menu, Setup" in s.child("bot").detail


def test_the_app_hands_over_a_key_and_the_screens_keeping_the_rest(tmp_path):
    f = settings_file(tmp_path, "IB_PORT=7497\nIB_DELAYED=1\nNTFY_TOPIC=sw-1\n")
    saved = []
    api = SettingsApi(f, on_saved=saved.append)
    assert "isn't an access key" in api.set_key("sb_secret_nope")["error"]
    assert api.set_key("swbot1.new") == {"ok": True}
    assert api.set_screens({"0": "main", "1": "watch", "2": "nonsense"}) == {"ok": True}
    v = read_settings(f)
    assert v["BOT_KEY"] == "swbot1.new" and v["IB_DELAYED"] == "1" and v["NTFY_TOPIC"] == "sw-1" and v["SCREENS"] == "0:main,1:watch"
    assert api.load()["screens"] == {"0": "main", "1": "watch"} and saved[-1]["SCREENS"] == "0:main,1:watch"
    assert not callable(getattr(api, "on_saved", None)), "the page can't call the restart directly"


def test_the_data_program_switch_is_only_for_the_pc_with_the_secret_key(tmp_path):
    ben = settings_file(tmp_path, "SUPABASE_SECRET_KEY=sb_secret_x\nRUN_DATA=1\n")
    assert SettingsApi(ben).load()["run_data"] is True
    SettingsApi(ben).save({"connection": "tws", "run_data": False})
    assert read_settings(ben)["RUN_DATA"] == "0"
    (tmp_path / "other").mkdir()
    other = settings_file(tmp_path / "other", "BOT_KEY=swbot1.k\n")
    SettingsApi(other).save({"connection": "tws", "run_data": True})
    assert "RUN_DATA" not in read_settings(other), "only the secret-key PC runs the data program"


def test_an_odd_ntfy_topic_is_refused(tmp_path):
    f = settings_file(tmp_path, "BOT_KEY=swbot1.k\n")
    assert "ntfy topic" in SettingsApi(f).save({"connection": "tws", "ntfy_topic": "has spaces!"})["error"]


def test_new_settings_restart_the_programs_with_them(tmp_path):
    s, launch, _ = sup(tmp_path, {"IB_PORT": "7497", "BOT_KEY": "swbot1.k"})
    s.poll()
    first = launch.started[0][2]
    s.reload({"IB_PORT": "4002", "IB_DELAYED": "1", "BOT_KEY": "swbot1.k"}, run_data=False)
    assert first.terminated
    s.poll()
    args = launch.started[-1][0]
    assert "--port" in args and args[args.index("--port") + 1] == "4002" and "--delayed" in args


# --- stage 3: the secret key encrypted with Windows' protection; the archive beside the settings ---

import sys  # noqa: E402

import pytest  # noqa: E402

from stockwizard.supervisor import load_settings  # noqa: E402


@pytest.mark.skipif(sys.platform != "win32", reason="Windows' data protection")
def test_a_plain_secret_key_is_encrypted_in_the_file_and_decrypted_only_in_memory(tmp_path):
    f = settings_file(tmp_path, "SUPABASE_SECRET_KEY=sb_secret_madeup\nRUN_DATA=1\n")
    s = load_settings(f)
    assert s["SUPABASE_SECRET_KEY"] == "sb_secret_madeup"            # the programs get it
    text = f.read_text(encoding="utf-8")
    assert "sb_secret_madeup" not in text and "SUPABASE_SECRET_KEY_PROTECTED=dpapi1." in text and "RUN_DATA=1" in text
    assert load_settings(f)["SUPABASE_SECRET_KEY"] == "sb_secret_madeup"   # read back next time
    assert SettingsApi(f).load()["run_data"] is True, "Settings still sees it as the data PC"


def test_the_archive_sits_beside_the_settings_unless_told_otherwise(tmp_path):
    assert load_settings(settings_file(tmp_path, "BOT_KEY=swbot1.k\n"))["ARCHIVE_PATH"] == str(tmp_path / "archive.sqlite")
    assert load_settings(settings_file(tmp_path, "ARCHIVE_PATH=D:\a.sqlite\n"))["ARCHIVE_PATH"] == "D:\a.sqlite"


def test_a_program_that_keeps_failing_stays_stopped_and_says_why(tmp_path):
    """Stage 4 found it: the data program failed at once each restart while the line said 'starting'."""
    beats = []
    s, launch, clock = sup(tmp_path, data=True, beats=beats)
    s.poll()
    data = s.child("data")
    data.take("Connected to Interactive Brokers for data (read-only, client 30).")
    data.take("FileNotFoundError: [Errno 2] No such file or directory: 'C:\\app\\data\\universe.csv'")
    launch.started[1][2].code = 1
    clock["t"] = 1
    s.poll()
    assert data.state == "stopped" and data.detail.startswith("Stopped: FileNotFoundError")
    clock["t"] = 1 + RESTART_AFTER
    s.poll()                                   # restarted: still stopped, until it says otherwise
    assert data.state == "stopped" and data.detail.startswith("Stopped: FileNotFoundError")
    data.take("Caught up.")
    assert data.state == "idle"
