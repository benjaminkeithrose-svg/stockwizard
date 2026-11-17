"""The bot's own strategies, against a stand-in market and database: propose once at the entry time, the rails and
approval as usual, record a day with no setup, manage exits, and settle at the close. Made-up prices only."""

from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd

from stockwizard.run_bot import BotRunner
from stockwizard.zerodte.instruments import INSTRUMENTS
from stockwizard.zerodte.quotes import ModelQuotes

from test_run_bot import LIMITS, OWNER, FakeStore, actions

NY = ZoneInfo("America/New_York")
DAY = datetime(2026, 11, 18, tzinfo=NY).date()    # a Wednesday


class FakeMarket:
    bar_minutes = 5

    def __init__(self, path=None, vix=16.0):
        self.path, self.vix = path or (lambda i, o: o * 1.0001), vix

    def bars_today(self, instrument, now):
        start = datetime.combine(DAY, datetime.min.time(), NY).replace(hour=9, minute=30)
        rows, px, t = [], 600.0, start
        i = 0
        while t + timedelta(minutes=5) <= now.astimezone(NY) and t.hour < 16:
            o = px
            c = self.path(i, o)
            rows.append({"ts": t, "open": o, "high": max(o, c) + 0.05, "low": min(o, c) - 0.05, "close": c, "volume": 1000.0})
            px, t, i = c, t + timedelta(minutes=5), i + 1
        return pd.DataFrame(rows).set_index("ts") if rows else None

    def chain(self, instrument, now, spot, only=None):
        close = datetime.combine(DAY, datetime.min.time(), NY).replace(hour=16)
        return ModelQuotes().chain(INSTRUMENTS[instrument], now, spot, max((close - now.astimezone(NY)).total_seconds(), 0), 0.16, only=only)

    def vix_prev(self, day):
        return self.vix


def at(h, m):
    return datetime.combine(DAY, datetime.min.time(), NY).replace(hour=h, minute=m).astimezone(timezone.utc)


def setup(cfg, limits=None, market=None):
    s = FakeStore()
    s.set_limits(**(limits or {**LIMITS, "max_loss_per_trade": 500, "max_capital_at_risk": 1000, "max_loss_per_day": 1000}))
    s.tables["bot_strategies"] = [{"id": "st-1", "owner": OWNER, "label": "XSP condor", "config": cfg, "enabled": True}]
    clock = {"t": at(10, 0)}
    r = BotRunner(s, OWNER, clock=lambda: clock["t"], market=market or FakeMarket())
    return s, r, clock


CONDOR = {"instrument": "XSP", "structure": "iron_condor", "entry": "10:30", "short_delta": 0.15, "width": 2.0}


def test_nothing_before_the_entry_time_then_one_proposal_waiting_for_approval():
    s, r, clock = setup(CONDOR)
    r.cycle()
    assert not s.tables["paper_orders"]
    clock["t"] = at(10, 35)
    said = r.cycle()
    assert any("proposed order" in x for x in said), said
    o = s.tables["paper_orders"][0]
    assert o["status"] == "proposed" and o["strategy_id"] == "st-1" and o["price_kind"] == "credit" and o["symbol"] == "XSP"
    assert len(o["legs"]) == 4 and str(o["expiry"]).startswith("2026-11-18")
    clock["t"] = at(10, 40)
    r.cycle()
    assert len(s.tables["paper_orders"]) == 1, "once a day"
    assert not r.broker.calls, "nothing sent before Ben approves"


def test_too_late_is_no_trade():
    s, r, clock = setup(CONDOR)
    clock["t"] = at(11, 0)
    r.cycle()
    assert not s.tables["paper_orders"]


def test_a_day_with_no_setup_is_recorded_once():
    s, r, clock = setup({**CONDOR, "structure": "directional", "neutral_trade": "none"}, market=FakeMarket(path=lambda i, o: o))
    clock["t"] = at(10, 35)
    said = r.cycle()
    assert any("no trade today" in x for x in said)
    clock["t"] = at(10, 40)
    r.cycle()
    assert actions(s).count("strategy_no_trade") == 1


def test_the_vix_filter():
    s, r, clock = setup({**CONDOR, "vix_max": 15.0})
    clock["t"] = at(10, 35)
    said = r.cycle()
    assert any("outside the strategy's range" in x for x in said) and not s.tables["paper_orders"]


def test_the_rails_still_decide():
    s, r, clock = setup(CONDOR, limits={**LIMITS, "max_loss_per_trade": 50})
    clock["t"] = at(10, 35)
    r.cycle()
    o = s.tables["paper_orders"][0]
    assert o["status"] == "refused" and any(x["rail"] == "per_trade" for x in o["refusals"])


def test_automatic_mode_fills_then_a_time_exit_closes_it():
    cfg = {**CONDOR, "exit_time": "15:00"}
    s, r, clock = setup(cfg, limits={**LIMITS, "approval_mode": "automatic", "max_loss_per_trade": 500, "max_capital_at_risk": 1000, "max_loss_per_day": 1000})
    clock["t"] = at(10, 35)
    r.cycle()
    o = s.tables["paper_orders"][0]
    assert o["status"] == "filled"
    clock["t"] = at(12, 0)
    r.cycle()
    assert o["status"] == "filled"
    clock["t"] = at(15, 5)
    said = r.cycle()
    assert o["status"] == "closed" and any("closed (time)" in x for x in said), said


def test_a_stop_closes_on_a_strong_move():
    cfg = {**CONDOR, "stop_mult": 1.5}
    climb = lambda i, o: o * (1.0015 if i >= 12 else 1.0)   # flat to 10:30, then a steady climb  # noqa: E731
    s, r, clock = setup(cfg, limits={**LIMITS, "approval_mode": "automatic", "max_loss_per_trade": 500, "max_capital_at_risk": 1000, "max_loss_per_day": 1000},
                        market=FakeMarket(path=climb))
    clock["t"] = at(10, 35)
    r.cycle()
    for h, m in [(11, 30), (12, 30), (13, 30), (14, 30)]:
        clock["t"] = at(h, m)
        r.cycle()
    o = s.tables["paper_orders"][0]
    assert o["status"] == "closed" and o["pnl"] < 0
    assert r.bot.realised_loss_today == -o["pnl"]


def test_held_to_the_close_it_settles():
    s, r, clock = setup(CONDOR, limits={**LIMITS, "approval_mode": "automatic", "max_loss_per_trade": 500, "max_capital_at_risk": 1000, "max_loss_per_day": 1000})
    clock["t"] = at(10, 35)
    r.cycle()
    clock["t"] = at(16, 5)
    said = r.cycle()
    o = s.tables["paper_orders"][0]
    assert o["status"] == "closed" and any("settled at the close" in x for x in said)
    assert o["pnl"] > 0, "a quiet day keeps the credit, less fees"


def test_switched_off_strategies_do_nothing():
    s, r, clock = setup(CONDOR)
    s.tables["bot_strategies"][0]["enabled"] = False
    clock["t"] = at(10, 35)
    r.cycle()
    assert not s.tables["paper_orders"]


def test_a_restart_remembers_which_strategy_an_order_came_from():
    s, r, clock = setup({**CONDOR, "exit_time": "15:00"},
                        limits={**LIMITS, "approval_mode": "automatic", "max_loss_per_trade": 500, "max_capital_at_risk": 1000, "max_loss_per_day": 1000})
    clock["t"] = at(10, 35)
    r.cycle()
    r2 = BotRunner(s, OWNER, clock=lambda: at(15, 5), market=FakeMarket())
    said = r2.cycle()
    assert any("closed (time)" in x for x in said), said
