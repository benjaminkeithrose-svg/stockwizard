"""Working an order's price (working.py): from the midpoint towards the worst allowed, then held, then given up."""

from datetime import datetime, timedelta, timezone

from stockwizard import working
from stockwizard.rails import Leg

T0 = datetime(2026, 11, 20, 14, 35, tzinfo=timezone.utc)   # 9:35 am New York
CONDOR = (Leg("P", "buy", 590), Leg("P", "sell", 595), Leg("C", "sell", 610), Leg("C", "buy", 615))
CALL = (Leg("C", "buy", 600),)


def test_the_width_is_the_widest_wing():
    assert working.width(CONDOR) == 5
    assert working.width((Leg("P", "buy", 590), Leg("P", "sell", 595), Leg("C", "sell", 610), Leg("C", "buy", 620))) == 10
    assert working.width(CALL) == 0


def test_the_worst_price_is_the_midpoint_less_a_tenth_of_the_width():
    assert working.worst_price(1.20, "credit", CONDOR) == 0.70      # $5 wide: up to 50c less credit
    assert working.worst_price(2.00, "debit", CALL) == 2.20         # a single option: 10% of its midpoint
    assert working.worst_price(0.30, "credit", CONDOR) == 0.05      # never asks for less than 5c


def test_it_steps_from_the_midpoint_to_the_worst_price_over_30_minutes_then_holds():
    p = working.plan(1.20, "credit", CONDOR, T0)
    assert p.until == T0 + timedelta(minutes=55)                    # 10:30 am New York
    at = lambda m: working.price_now(p, "credit", T0 + timedelta(minutes=m))  # noqa: E731
    assert at(0) == 1.20 and at(15) == 0.95 and at(30) == 0.70 and at(50) == 0.70
    assert all(at(m) >= at(m + 1) for m in range(54)), "never moves back up on its own"


def test_it_follows_a_better_market_but_never_passes_the_worst_price():
    p = working.plan(1.20, "credit", CONDOR, T0)
    assert working.price_now(p, "credit", T0 + timedelta(minutes=15), mid_now=1.50) == 1.25   # the market came our way
    assert working.price_now(p, "credit", T0 + timedelta(minutes=15), mid_now=0.40) == 0.70   # it went against us: held at the worst


def test_a_debit_steps_up_to_its_worst():
    p = working.plan(2.00, "debit", CALL, T0)
    assert working.price_now(p, "debit", T0) == 2.00
    assert working.price_now(p, "debit", T0 + timedelta(minutes=30)) == 2.20


def test_it_gives_up_at_the_end_of_its_window():
    p = working.plan(1.20, "credit", CONDOR, T0)
    assert not working.expired(p, T0 + timedelta(minutes=54))
    assert working.expired(p, T0 + timedelta(minutes=55))
