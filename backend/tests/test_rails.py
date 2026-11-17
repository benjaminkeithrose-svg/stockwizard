"""Every safety rail has a test that proves it blocks (SPEC.md, phase 5's done-when).

Each test sends an order through the bot to the pretend broker and checks it
never arrived, and that the refusal was written to the audit log. Made-up
orders only.
"""

from dataclasses import replace
from datetime import date, datetime, timedelta, timezone

import pytest

from stockwizard.bot import Bot
from stockwizard.broker import Broker, LiveTradingDisabled, PretendBroker
from stockwizard.rails import Book, Leg, Limits, OrderRequest, check, max_loss, uncovered

NOW = datetime(2026, 11, 18, 15, 0, tzinfo=timezone.utc)
SET = Limits(max_loss_per_trade=50, max_loss_per_day=100, max_open_positions=2, max_capital_at_risk=100, max_data_age_seconds=60)


def condor(credit=4.6, qty=1, wing=5, **kw) -> OrderRequest:
    """A $5-wide iron condor for a $4.60 credit: it can lose $40."""
    legs = (Leg("P", "buy", 589 - (wing - 5)), Leg("P", "sell", 594), Leg("C", "sell", 606), Leg("C", "buy", 611 + (wing - 5)))
    base = dict(symbol="SPY", structure="iron_condor", expiry=date(2026, 11, 18), legs=legs, quantity=qty,
                limit_price=credit, price_kind="credit", prices_as_of=NOW - timedelta(seconds=5))
    return OrderRequest(**{**base, **kw})


class Run:
    def __init__(self, limits: Limits = SET):
        self.limits = limits
        self.broker = PretendBroker()
        self.log: list[tuple[str, str, dict]] = []
        self.now = NOW
        self.bot = Bot(self.broker, lambda: self.limits, lambda a, k, d: self.log.append((a, k, d)), clock=lambda: self.now)

    def actions(self):
        return [k for _, k, _ in self.log]

    def refused(self, rail: str) -> bool:
        return any(k == "order_refused" and any(r["rail"] == rail for r in d["refusals"]) for _, k, d in self.log)

    def sent(self) -> int:
        return sum(1 for what, _ in self.broker.calls if what == "place")


def blocked(run: Run, order: OrderRequest, rail: str):
    p = run.bot.propose(order)
    assert p.status == "refused", p
    assert any(r.rail == rail for r in p.refusals), p.refusals
    assert run.sent() == 0, "the order reached the broker"
    assert run.refused(rail), "the refusal wasn't written to the audit log"


# --- the payoff maths the rails rely on ---

def test_max_loss_of_a_credit_condor_is_the_wing_less_the_credit():
    assert max_loss(condor()) == 40.0
    assert max_loss(condor(qty=2)) == 80.0
    assert max_loss(condor(wing=10)) == 540.0


def test_max_loss_of_a_debit_spread_is_what_was_paid():
    o = condor(structure="bull_call", legs=(Leg("C", "buy", 600), Leg("C", "sell", 605)), limit_price=0.45, price_kind="debit")
    assert max_loss(o) == 45.0


def test_a_naked_short_call_has_no_maximum():
    o = condor(legs=(Leg("C", "sell", 606),), limit_price=1.0)
    assert max_loss(o) is None
    assert uncovered(o.legs) == ["1 short call with no long call to cover"]


# --- 1. defined risk ---

def test_rail_1_blocks_a_naked_short_put():
    blocked(Run(), condor(structure="put", legs=(Leg("P", "sell", 594),), limit_price=0.3), "defined_risk")


def test_rail_1_blocks_a_condor_missing_its_call_wing():
    o = condor(legs=(Leg("P", "buy", 589), Leg("P", "sell", 594), Leg("C", "sell", 606)), limit_price=0.8)
    blocked(Run(), o, "defined_risk")


def test_rail_1_blocks_more_short_contracts_than_long():
    o = condor(legs=(Leg("P", "buy", 589), Leg("P", "sell", 594, qty=2)), limit_price=0.5)
    blocked(Run(), o, "defined_risk")


# --- 2. per trade ---

def test_rail_2_blocks_a_trade_that_could_lose_more_than_50():
    blocked(Run(), condor(credit=4.4), "per_trade")  # can lose $60


def test_rail_2_allows_one_at_the_limit():
    assert check(condor(credit=4.5), SET, Book(), NOW) == []  # can lose exactly $50


def test_rail_2_counts_every_contract():
    blocked(Run(), condor(qty=2), "per_trade")  # $40 each, $80 together


# --- 3. per day ---

def test_rail_3_blocks_everything_while_the_daily_limit_is_unset():
    run = Run(replace(SET, max_loss_per_day=None))
    blocked(run, condor(), "per_day")
    assert Limits().max_loss_per_day is None, "the daily limit must start unset"


def test_rail_3_halts_trading_once_the_day_has_lost_the_limit():
    run = Run()
    run.bot.realised_loss_today = 100
    blocked(run, condor(), "per_day")


def test_rail_3_blocks_a_trade_that_could_take_the_day_past_the_limit():
    run = Run()
    run.bot.realised_loss_today = 70
    blocked(run, condor(), "per_day")  # 70 lost + 40 at risk > 100


def test_rail_3_counts_losses_as_positions_close():
    run = Run(replace(SET, approval_mode="automatic"))
    p = run.bot.propose(condor())
    assert p.status == "sent"
    run.bot.record_fill(p.id, 4.6)
    run.bot.record_close(p.id, -95)
    q = run.bot.propose(condor())
    assert any(r.rail == "per_day" for r in q.refusals) and run.sent() == 1


# --- 4. positions and capital at risk ---

def test_rail_4_blocks_more_open_positions_than_the_cap():
    run = Run(replace(SET, approval_mode="automatic", max_loss_per_day=1000, max_capital_at_risk=1000, max_open_positions=1))
    assert run.bot.propose(condor()).status == "sent"
    p = run.bot.propose(condor())
    assert p.status == "refused" and any(r.rail == "positions" for r in p.refusals)
    assert run.sent() == 1


def test_rail_4_blocks_more_capital_at_risk_than_the_cap():
    run = Run(replace(SET, approval_mode="automatic", max_loss_per_day=1000, max_capital_at_risk=70, max_open_positions=5))
    assert run.bot.propose(condor()).status == "sent"   # $40 at risk
    p = run.bot.propose(condor())                        # would make $80
    assert any(r.rail == "capital_at_risk" for r in p.refusals) and run.sent() == 1


# --- 5. stale data ---

def test_rail_5_blocks_old_prices():
    blocked(Run(), condor(prices_as_of=NOW - timedelta(seconds=61)), "stale_data")


def test_rail_5_blocks_an_old_signal():
    blocked(Run(), condor(signal_as_of=NOW - timedelta(minutes=10)), "stale_data")


def test_rail_5_rechecks_at_approval():
    run = Run()
    p = run.bot.propose(condor())
    assert p.status == "proposed" and run.sent() == 0
    run.now = NOW + timedelta(minutes=5)  # Ben approves five minutes later: the quote is stale
    p = run.bot.approve(p.id)
    assert p.status == "refused" and any(r.rail == "stale_data" for r in p.refusals)
    assert run.sent() == 0


# --- 6. kill switch ---

def test_rail_6_kill_switch_cancels_working_orders_and_blocks_new_ones():
    run = Run(replace(SET, approval_mode="automatic", max_open_positions=5, max_capital_at_risk=1000, max_loss_per_day=1000))
    sent = run.bot.propose(condor())
    out = run.bot.kill()
    assert out["cancelled_at_broker"] == [sent.broker_id]
    assert run.broker.orders[sent.broker_id].status == "cancelled"
    assert ("ben", "kill_switch") in [(a, k) for a, k, _ in run.log]
    blocked_p = run.bot.propose(condor())
    assert any(r.rail == "kill_switch" for r in blocked_p.refusals)
    assert run.sent() == 1


def test_rail_6_kill_switch_drops_proposals_waiting_for_approval():
    run = Run()
    p = run.bot.propose(condor())
    run.bot.kill()
    assert p.status == "cancelled"
    with pytest.raises(ValueError):
        run.bot.approve(p.id)
    assert run.sent() == 0


def test_rail_6_kill_switch_set_in_the_app_is_acted_on():
    run = Run(replace(SET, approval_mode="automatic"))
    sent = run.bot.propose(condor())
    run.limits = replace(run.limits, kill_switch=True)
    run.bot.watch()
    assert run.broker.orders[sent.broker_id].status == "cancelled"
    assert "kill_switch_acted" in run.actions()
    blocked(Run(run.limits), condor(), "kill_switch")


def test_rail_6_turning_the_kill_switch_off_in_the_app_resumes_trading():
    run = Run(replace(SET, kill_switch=True))
    run.bot.watch()
    assert run.bot.propose(condor()).status == "refused"
    run.limits = replace(run.limits, kill_switch=False)
    run.bot.watch()
    assert "trading_resumed" in run.actions()
    assert run.bot.propose(condor()).status == "proposed"


def test_rail_6_a_kill_from_the_bot_itself_is_not_lifted_by_the_app():
    run = Run()
    run.bot.kill()
    run.bot.watch()  # the app's switch is off, but the bot's own kill stands
    assert any(r.rail == "kill_switch" for r in run.bot.propose(condor()).refusals)


# --- 7. approval mode ---

def test_rail_7_approval_is_the_default():
    assert Limits().approval_mode == "approval"


def test_rail_7_nothing_is_sent_until_ben_approves():
    run = Run()
    p = run.bot.propose(condor())
    assert p.status == "proposed" and run.sent() == 0
    run.bot.approve(p.id)
    assert p.status == "sent" and run.sent() == 1
    assert run.actions() == ["order_proposed", "order_approved", "order_sent"]


def test_rail_7_approval_requotes_then_checks_again():
    run = Run()
    p = run.bot.propose(condor())
    run.now = NOW + timedelta(minutes=5)
    # A fresh quote at approval: still $40 at risk, so it goes.
    run.bot.requote = lambda req: replace(req, prices_as_of=run.now)
    assert run.bot.approve(p.id).status == "sent"
    # A fresh quote that has moved: now $60 at risk, so it's refused.
    q = run.bot.propose(condor(prices_as_of=run.now))
    run.bot.requote = lambda req: replace(req, limit_price=4.4, prices_as_of=run.now)
    q = run.bot.approve(q.id)
    assert q.status == "refused" and any(r.rail == "per_trade" for r in q.refusals) and run.sent() == 1


def test_rail_7_a_rejected_proposal_is_never_sent():
    run = Run()
    p = run.bot.propose(condor())
    run.bot.reject(p.id)
    with pytest.raises(ValueError):
        run.bot.approve(p.id)
    assert run.sent() == 0 and "order_rejected" in run.actions()


# --- 8. audit log ---

def test_rail_8_every_step_is_audited():
    run = Run()
    a = run.bot.propose(condor())
    run.bot.approve(a.id)
    b = run.bot.propose(condor(credit=4.0))  # refused
    c = run.bot.propose(condor())
    run.bot.reject(c.id)
    run.bot.kill()
    assert run.actions() == ["order_proposed", "order_approved", "order_sent", "order_proposed", "order_refused",
                             "order_proposed", "order_rejected", "kill_switch"]
    assert b.status == "refused"


# --- order form, the broker, live trading ---

def test_market_orders_are_refused():
    blocked(Run(), condor(order_type="market"), "order_form")


def test_a_missing_or_zero_limit_price_is_refused():
    blocked(Run(), condor(limit_price=None), "order_form")
    blocked(Run(), condor(limit_price=0), "order_form")


def test_legs_on_different_expiries_are_refused():
    blocked(Run(), condor(leg_expiries=(date(2026, 11, 18), date(2026, 11, 20))), "order_form")


def test_a_disconnected_broker_stops_trading_until_reconciled():
    run = Run()
    run.broker.drop()
    run.bot.watch()
    blocked(run, condor(), "broker")
    run.broker.reconnect()
    p = run.bot.propose(condor())
    assert any(r.rail == "broker" for r in p.refusals), "traded before reconciling"
    assert run.bot.reconcile() == []
    p = run.bot.propose(condor())
    assert p.status == "proposed"


def test_reconcile_refuses_to_resume_on_an_order_the_bot_didnt_send():
    run = Run()
    run.broker.drop()
    run.bot.watch()
    run.broker.reconnect()
    run.broker.place(condor())  # appeared at the broker while we were away
    problems = run.bot.reconcile()
    assert problems and "didn't send" in problems[0]
    assert run.bot.reconciled is False
    assert "reconcile_mismatch" in run.actions()


def test_a_live_broker_is_refused_outright():
    class Live(PretendBroker):
        is_live = True

    with pytest.raises(LiveTradingDisabled):
        Bot(Live(), lambda: SET, lambda *a: None)


def test_limits_from_a_database_row_keep_safe_defaults():
    lim = Limits.from_row({"max_loss_per_trade": "50", "max_loss_per_day": None, "approval_mode": "approval", "kill_switch": False})
    assert lim.max_loss_per_day is None and lim.max_loss_per_trade == 50.0 and lim.approval_mode == "approval"


def test_the_broker_interface_has_no_way_to_go_live():
    assert not hasattr(Broker, "enable_live") and Broker.is_live is False
