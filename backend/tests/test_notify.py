"""Phone notifications: each order's state told once at the end of a cycle, stops flagged, the daily limit once,
nothing without a topic, and a failed send never stops the bot. Made-up orders; nothing is posted anywhere."""

from stockwizard.notify import Notifier
from stockwizard.run_bot import BotRunner

from test_run_bot import LIMITS, OWNER, FakeStore
from test_strategy_runner import CONDOR, FakeMarket, at, setup


class Phone:
    def __init__(self, fail=False):
        self.sent, self.fail = [], fail

    def __call__(self, url, body, headers):
        if self.fail:
            raise OSError("offline")
        self.sent.append((url, headers["Title"], body.decode(), headers["Priority"]))


def runner(cfg, limits, market=None):
    s, r, clock = setup(cfg, limits=limits, market=market)
    phone = Phone()
    r.notifier = Notifier("made-up-topic", post=phone)
    return s, r, clock, phone


AUTO = {**LIMITS, "approval_mode": "automatic", "max_loss_per_trade": 500, "max_capital_at_risk": 1000, "max_loss_per_day": 1000}


def test_an_order_waiting_for_approval_is_told_once():
    s, r, clock, phone = runner(CONDOR, {**AUTO, "approval_mode": "approve"})
    clock["t"] = at(10, 35)
    r.cycle()
    clock["t"] = at(10, 40)
    r.cycle()
    assert [x[1] for x in phone.sent] == ["Order waiting for you"]
    url, _, body, prio = phone.sent[0]
    assert url == "https://ntfy.sh/made-up-topic" and "XSP iron condor" in body and "most it can lose" in body and prio == "high"


def test_automatic_mode_tells_the_fill_not_the_wait_then_the_close():
    s, r, clock, phone = runner({**CONDOR, "exit_time": "15:00"}, AUTO)
    clock["t"] = at(10, 35)
    r.cycle()
    assert [x[1] for x in phone.sent] == ["Order filled"]
    clock["t"] = at(15, 5)
    r.cycle()
    assert phone.sent[-1][1].startswith("Closed (time): ")


def test_a_stop_is_flagged_and_the_daily_limit_told_once():
    climb = lambda i, o: o * (1.0015 if i >= 12 else 1.0)  # noqa: E731
    s, r, clock, phone = runner({**CONDOR, "stop_mult": 1.5}, AUTO, market=FakeMarket(path=climb))
    clock["t"] = at(10, 35)
    r.cycle()
    s.set_limits(**{**AUTO, "max_loss_per_day": 20})   # lowered once the trade is on, so the stop's loss reaches it
    for h, m in [(11, 30), (12, 30), (13, 30), (14, 30), (15, 0)]:
        clock["t"] = at(h, m)
        r.cycle()
    titles = [x[1] for x in phone.sent]
    assert any(t.startswith("Stopped out (stop)") for t in titles), titles
    assert titles.count("Daily loss limit reached") == 1
    assert [x[3] for x in phone.sent if x[1] == "Daily loss limit reached"] == ["urgent"]


def test_a_restart_doesnt_repeat_what_was_told():
    s, r, clock, phone = runner(CONDOR, {**AUTO, "approval_mode": "approve"})
    clock["t"] = at(10, 35)
    r.cycle()
    phone2 = Phone()
    r2 = BotRunner(s, OWNER, clock=lambda: at(10, 45), market=FakeMarket(), notifier=Notifier("made-up-topic", post=phone2))
    r2.cycle()
    assert not phone2.sent


def test_no_topic_sends_nothing_and_a_failure_never_stops_the_bot():
    s, r, clock = setup(CONDOR)
    clock["t"] = at(10, 35)
    r.cycle()                       # no notifier: nothing to send, nothing breaks
    s, r, clock, _ = runner(CONDOR, {**AUTO, "approval_mode": "approve"})
    r.notifier = Notifier("made-up-topic", post=Phone(fail=True))
    clock["t"] = at(10, 35)
    said = r.cycle()
    assert s.tables["paper_orders"][0]["status"] == "proposed"
    assert any("Couldn't send the phone notification" in x for x in said)


def test_from_env(monkeypatch):
    monkeypatch.delenv("NTFY_TOPIC", raising=False)
    assert Notifier.from_env() is None
    monkeypatch.setenv("NTFY_TOPIC", " made-up ")
    assert Notifier.from_env().topic == "made-up"
