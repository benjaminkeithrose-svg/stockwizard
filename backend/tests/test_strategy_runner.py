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
        self.expiries = []

    def bars_today(self, instrument, now):
        start = datetime.combine(now.astimezone(NY).date(), datetime.min.time(), NY).replace(hour=9, minute=30)
        rows, px, t = [], 600.0, start
        i = 0
        while t + timedelta(minutes=5) <= now.astimezone(NY) and t.hour < 16:
            o = px
            c = self.path(i, o)
            rows.append({"ts": t, "open": o, "high": max(o, c) + 0.05, "low": min(o, c) - 0.05, "close": c, "volume": 1000.0})
            px, t, i = c, t + timedelta(minutes=5), i + 1
        return pd.DataFrame(rows).set_index("ts") if rows else None

    def chain(self, instrument, now, spot, only=None, expiry=None):
        from stockwizard.strategy_runner import _seconds_to_expiry  # noqa: PLC0415
        self.expiries.append(expiry)
        return ModelQuotes().chain(INSTRUMENTS[instrument], now, spot, _seconds_to_expiry(now, expiry or now.astimezone(NY).date()), 0.16, only=only)

    def atr(self, instrument, day):
        return 3.0

    def vix_prev(self, day):
        return self.vix

    def vol_now(self, now):
        return 0.16


def at(h, m, day=DAY):
    return datetime.combine(day, datetime.min.time(), NY).replace(hour=h, minute=m).astimezone(timezone.utc)


def setup(cfg, limits=None, market=None):
    s = FakeStore()
    s.set_limits(**(limits or {**LIMITS, "max_loss_per_trade": 500, "max_capital_at_risk": 1000, "max_loss_per_day": 1000}))
    s.tables["bot_strategies"] = [{"id": "st-1", "owner": OWNER, "label": "XSP condor", "config": cfg, "enabled": True}]
    clock = {"t": at(10, 0)}
    s.clock = lambda: clock["t"]
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
    assert o["status"] == "closed" and any("close sent (time)" in x for x in said), said


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
    assert any("close sent (time)" in x for x in said), said


def test_the_today_snapshot_is_saved_during_the_session_only():
    s, r, clock = setup(CONDOR)
    clock["t"] = at(9, 0)
    r.cycle()
    assert not s.tables.get("market_snapshots")
    clock["t"] = at(11, 0)
    r.cycle()
    clock["t"] = at(11, 30)
    r.cycle()
    snaps = s.tables["market_snapshots"]
    assert len(snaps) == 1, "one row per symbol, overwritten"
    sn = snaps[0]
    assert sn["symbol"] == "SPY" and sn["vix1d"] == 16.0 and sn["vix"] == 16.0 and sn["source"] == "pretend"
    assert sn["or_high"] >= sn["or_low"] and sn["expected_move"] > 0 and sn["direction"] in ("bullish", "bearish", "neutral")
    assert sn["taken_at"].startswith("2026-11-18T16:30")


# --- multi-day strategies (as the option backtests: one at a time, expiry `dte` trading days into the trade) ---

from datetime import date  # noqa: E402

AUTO = {**LIMITS, "approval_mode": "automatic", "max_loss_per_trade": 500, "max_capital_at_risk": 1000, "max_loss_per_day": 1000}
THREE_DAY = {"instrument": "XSP", "structure": "iron_condor", "entry": "10:00", "short_delta": 0.15, "width": 2.0, "dte": 3}


def test_a_three_day_condor_expires_two_sessions_on_skipping_the_weekend():
    s, r, clock = setup(THREE_DAY)
    clock["t"] = at(10, 5, date(2026, 11, 19))        # a Thursday: Thu, Fri, Mon
    r.cycle()
    o = s.tables["paper_orders"][0]
    assert str(o["expiry"]).startswith("2026-11-23") and o["status"] == "proposed", o
    assert r.strategies.market.expiries[-1] == date(2026, 11, 23), "priced for that expiry"


def test_thanksgiving_is_skipped_both_ways():
    s, r, clock = setup(THREE_DAY)
    clock["t"] = at(10, 5, date(2026, 11, 26))        # Thanksgiving: no proposal at all
    r.cycle()
    assert not s.tables["paper_orders"]
    clock["t"] = at(10, 5, date(2026, 11, 25))        # Wed, Fri, Mon
    r.cycle()
    assert str(s.tables["paper_orders"][0]["expiry"]).startswith("2026-11-30")


def test_one_position_at_a_time_held_overnight_then_settled_at_expiry():
    s, r, clock = setup(THREE_DAY, limits=AUTO)
    clock["t"] = at(10, 5, date(2026, 11, 18))        # Wed → expires Fri 20th
    r.cycle()
    o = s.tables["paper_orders"][0]
    assert o["status"] == "filled"
    clock["t"] = at(16, 5, date(2026, 11, 18))
    r.cycle()
    assert o["status"] == "filled", "not settled before its expiry"
    for d in (19, 20):
        clock["t"] = at(10, 5, date(2026, 11, d))
        said = r.cycle()
        assert len(s.tables["paper_orders"]) == 1 and any("one at a time" in x for x in said), said
    clock["t"] = at(16, 5, date(2026, 11, 20))
    said = r.cycle()
    assert o["status"] == "closed" and any("settled at the close" in x for x in said), said


def test_a_multi_day_profit_target_closes_on_a_later_day():
    s, r, clock = setup({**THREE_DAY, "profit_target": 0.5}, limits=AUTO, market=FakeMarket(path=lambda i, o: o))
    clock["t"] = at(10, 5, date(2026, 11, 18))
    r.cycle()
    o = s.tables["paper_orders"][0]
    clock["t"] = at(15, 0, date(2026, 11, 20))         # a flat market, most of the time value gone
    said = r.cycle()
    assert o["status"] == "closed" and o["pnl"] > 0 and any("profit target" in x for x in said), said


def test_shorts_by_daily_range():
    s, r, clock = setup({**THREE_DAY, "short_atr": 1.0, "width": 1.0}, market=FakeMarket(path=lambda i, o: o))
    clock["t"] = at(10, 5, date(2026, 11, 18))
    r.cycle()
    legs = sorted(s.tables["paper_orders"][0]["legs"], key=lambda l: l["strike"])
    spot = 600.0 * INSTRUMENTS["XSP"].scale
    at_ = round(spot)
    assert [l["strike"] for l in legs] == [at_ - 4, at_ - 3, at_ + 3, at_ + 4], legs   # ATR 3 either side, $1 wings


# --- bots made from backtests: their management and signals, as the backtests run them ---

def _daily(n=120, up=True):
    idx = pd.bdate_range(end="2026-11-17", periods=n, tz="UTC") + pd.Timedelta(hours=21)
    c = np.linspace(300, 600, n) if up else np.full(n, 600.0)   # steps of 2.5 clear the previous high (+2)
    return pd.DataFrame({"open": c, "high": c + 2, "low": c - 2, "close": c, "volume": 1e6}, index=idx)


class DailyMarket(FakeMarket):
    def __init__(self, daily, **kw):
        super().__init__(**kw)
        self._daily = daily

    def daily(self, instrument, day):
        return self._daily


MONTHLY_BULL_PUT = {"instrument": "SPY", "structure": "bull_put", "entry": "10:00", "short_delta": 0.15, "short_atr": 3, "width": 5, "dte": 21}


def test_a_bull_put_placed_by_daily_range():
    s, r, clock = setup(MONTHLY_BULL_PUT, market=FakeMarket(path=lambda i, o: o))
    clock["t"] = at(10, 5, date(2026, 11, 18))
    r.cycle()
    o = s.tables["paper_orders"][0]
    legs = sorted(o["legs"], key=lambda l: l["strike"])
    at_ = round(600.0 * INSTRUMENTS["SPY"].scale)
    assert [(l["right"], l["side"], l["strike"]) for l in legs] == [("P", "buy", at_ - 14), ("P", "sell", at_ - 9)], legs   # ATR 3 × 3 below
    assert o["price_kind"] == "credit"


def test_close_with_21_days_left():
    s, r, clock = setup({**MONTHLY_BULL_PUT, "close_days_left": 21}, limits=AUTO, market=FakeMarket(path=lambda i, o: o))
    clock["t"] = at(10, 5, date(2026, 11, 18))
    r.cycle()
    o = s.tables["paper_orders"][0]
    expiry = date.fromisoformat(str(o["expiry"])[:10])
    assert o["status"] == "filled" and (expiry - date(2026, 11, 18)).days > 21
    d = date(2026, 11, 19)
    while (expiry - d).days > 21 or not calendar_is_trading(d):
        d += timedelta(days=1)
    clock["t"] = at(11, 0, d)
    said = r.cycle()
    assert o["status"] == "closed" and any("21 days left" in x for x in said), (d, said)


def calendar_is_trading(d):
    from stockwizard.zerodte.calendar import is_trading_day
    return is_trading_day(d)


class MidMarket(FakeMarket):
    """Quotes at the model's middle price (no bid-ask spread), so the test is about the rule, not the model's spreads."""

    def chain(self, *a, **kw):
        from dataclasses import replace  # noqa: PLC0415
        return {k: replace(q, bid=round((q.bid + q.ask) / 2, 4), ask=round((q.bid + q.ask) / 2, 4)) for k, q in super().chain(*a, **kw).items()}


def test_take_profit_on_a_debit_spread_is_half_the_most_it_can_make():
    cfg = {"instrument": "XSP", "structure": "bull_call_debit", "entry": "10:00", "short_delta": 0.15, "width": 2.0, "dte": 3, "profit_target": 0.5}
    climb = lambda i, o: o * (1.0003 if i >= 6 else 1.0)  # noqa: E731   # a steady rise of about 2.5 by 13:00
    s, r, clock = setup(cfg, limits=AUTO, market=MidMarket(path=climb))
    clock["t"] = at(10, 5, date(2026, 11, 18))
    r.cycle()
    o = s.tables["paper_orders"][0]
    assert o["price_kind"] == "debit" and o["status"] == "filled"
    clock["t"] = at(13, 0, date(2026, 11, 18))
    said = r.cycle()
    assert o["status"] == "closed" and o["pnl"] > 0 and any("profit target" in x for x in said), said


def test_only_on_signal_days():
    cfg = {**THREE_DAY, "signal_rule": "breakout", "signal_params": {"length": 20}}
    s, r, clock = setup(cfg, market=DailyMarket(_daily(up=False)))
    clock["t"] = at(10, 5, date(2026, 11, 18))
    said = r.cycle()
    assert not s.tables["paper_orders"] and any("wasn't on" in x for x in said), said
    s, r, clock = setup(cfg, market=DailyMarket(_daily(up=True)))
    clock["t"] = at(10, 5, date(2026, 11, 18))
    r.cycle()
    assert s.tables["paper_orders"], "a breakout at the last close: it trades"
