"""The bot's theoretical prices: textbook Black-Scholes values, and limit prices on the tick."""

from datetime import date, datetime, timezone

from stockwizard.pricing import black_scholes, historical_vol, limit_price, net_value, years_left
from stockwizard.rails import Leg

CONDOR = (Leg("P", "buy", 589), Leg("P", "sell", 594), Leg("C", "sell", 606), Leg("C", "buy", 611))


def test_textbook_values():
    assert abs(black_scholes("C", 100, 100, 1, 0.2, 0.05) - 10.4506) < 1e-3
    assert abs(black_scholes("P", 100, 100, 1, 0.2, 0.05) - 5.5735) < 1e-3


def test_put_call_parity():
    import math
    c, p = black_scholes("C", 600, 590, 0.1, 0.18), black_scholes("P", 600, 590, 0.1, 0.18)
    assert abs((c - p) - (600 - 590 * math.exp(-0.04 * 0.1))) < 1e-9


def test_a_condor_is_a_credit_rounded_down_to_the_tick():
    price, kind = limit_price(CONDOR, 600, 30 / 365, 0.15)
    assert kind == "credit"
    assert abs(price * 20 - round(price * 20)) < 1e-9          # on a 5c tick
    assert price <= -net_value(CONDOR, 600, 30 / 365, 0.15)    # never more than the model's value
    assert 0 < price < 5


def test_a_long_call_is_a_debit_rounded_up():
    price, kind = limit_price((Leg("C", "buy", 600),), 600, 30 / 365, 0.15)
    assert kind == "debit" and price >= net_value((Leg("C", "buy", 600),), 600, 30 / 365, 0.15)


def test_expiry_is_the_new_york_close():
    now = datetime(2026, 11, 20, 20, 0, tzinfo=timezone.utc)   # 15:00 New York, Friday
    assert abs(years_left(date(2026, 11, 20), now) * 365 * 24 - 1) < 1e-6
    assert years_left(date(2026, 11, 19), now) == 0


def test_historical_vol():
    closes = [100 * (1.01 if i % 2 else 0.99) for i in range(30)]
    assert 0.2 < historical_vol(closes) < 0.4
    assert historical_vol(closes[:10]) is None
