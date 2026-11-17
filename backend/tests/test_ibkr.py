"""The Interactive Brokers broker against a stand-in for IB Gateway (the real one runs only on Ben's PC).

Proves the guards (live ports and live accounts refused), the combo order's
shape and price sign, quotes from midpoints, and reconciling leg by leg.
"""

from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from types import SimpleNamespace

import pytest

from stockwizard.bot import Bot
from stockwizard.broker import LiveTradingDisabled
from stockwizard.broker.ibkr import IBKRBroker
from stockwizard.rails import Leg, Limits, OrderRequest

NOW = datetime(2026, 11, 18, 15, 0, tzinfo=timezone.utc)
CONDOR = (Leg("P", "buy", 589), Leg("P", "sell", 594), Leg("C", "sell", 606), Leg("C", "buy", 611))


def req(**kw):
    base = dict(symbol="SPY", structure="iron_condor", expiry=date(2026, 11, 20), legs=CONDOR, quantity=1,
                limit_price=4.6, price_kind="credit", prices_as_of=NOW)
    return OrderRequest(**{**base, **kw})


# --- a stand-in for ib_async and IB Gateway ---

class Lib:
    @staticmethod
    def Option(symbol, expiry, strike, right, exchange, multiplier="", currency=""):
        return SimpleNamespace(symbol=symbol, lastTradeDateOrContractMonth=expiry, strike=strike, right=right, conId=0, secType="OPT")

    @staticmethod
    def ComboLeg(**kw):
        return SimpleNamespace(**kw)

    @staticmethod
    def Bag(**kw):
        return SimpleNamespace(secType="BAG", **kw)

    @staticmethod
    def LimitOrder(action, qty, price, **kw):
        return SimpleNamespace(action=action, totalQuantity=qty, lmtPrice=price, orderType="LMT", orderId=0, **kw)


@dataclass
class FakeIB:
    accounts: list = field(default_factory=lambda: ["DU1234567"])
    up: bool = True
    placed: list = field(default_factory=list)
    cancelled: list = field(default_factory=list)
    held: list = field(default_factory=list)
    mids: dict = field(default_factory=dict)
    others: list = field(default_factory=list)
    next_id: int = 100
    data_type: int | None = None

    def connect(self, host, port, clientId):
        self.port = port

    def managedAccounts(self):
        return self.accounts

    def disconnect(self):
        self.up = False

    def isConnected(self):
        return self.up

    def reqMarketDataType(self, t):
        self.data_type = t

    def qualifyContracts(self, *cs):
        for c in cs:
            c.conId = int(c.strike * 10) + (1 if c.right == "C" else 0)
        return list(cs)

    def placeOrder(self, contract, order):
        self.next_id += 1
        order.orderId = self.next_id
        t = SimpleNamespace(contract=contract, order=order, orderStatus=SimpleNamespace(status="Submitted", avgFillPrice=0.0))
        self.placed.append(t)
        return t

    def cancelOrder(self, order):
        self.cancelled.append(order.orderId)
        for t in self.placed:
            if t.order is order:
                t.orderStatus.status = "Cancelled"

    def openTrades(self):
        return [t for t in self.placed + self.others if t.orderStatus.status in ("Submitted", "PreSubmitted")]

    def positions(self, account=""):
        return self.held

    def reqTickers(self, *cs):
        return [SimpleNamespace(midpoint=lambda c=c: self.mids.get((c.strike, c.right), float("nan"))) for c in cs]

    # test helpers
    def fill(self, t, price):
        t.orderStatus.status, t.orderStatus.avgFillPrice = "Filled", price
        sign = {"BUY": 1, "SELL": -1}
        for leg in t.contract.comboLegs:
            strike, right = leg.conId // 10, "C" if leg.conId % 10 else "P"
            self.held.append(SimpleNamespace(contract=SimpleNamespace(secType="OPT", symbol="SPY", lastTradeDateOrContractMonth="20261120",
                                                                      strike=float(strike), right=right),
                                             position=sign[leg.action] * leg.ratio * t.order.totalQuantity))


def broker(**kw):
    ib = FakeIB(**{k: v for k, v in kw.items() if k in FakeIB.__dataclass_fields__})
    return IBKRBroker(ib=ib, lib=Lib, clock=lambda: NOW, **{k: v for k, v in kw.items() if k in ("port", "delayed")}), ib


# --- guards ---

@pytest.mark.parametrize("port", [4001, 7496])
def test_live_ports_are_refused_before_connecting(port):
    with pytest.raises(LiveTradingDisabled):
        IBKRBroker(port=port, ib=FakeIB(), lib=Lib)


def test_a_live_account_is_refused_and_disconnected():
    ib = FakeIB(accounts=["U7654321"])
    with pytest.raises(LiveTradingDisabled):
        IBKRBroker(ib=ib, lib=Lib)
    assert not ib.up


def test_a_mix_of_paper_and_live_accounts_is_refused():
    with pytest.raises(LiveTradingDisabled):
        IBKRBroker(ib=FakeIB(accounts=["DU1", "U2"]), lib=Lib)


def test_the_bot_accepts_a_paper_ibkr_broker():
    b, _ = broker()
    Bot(b, lambda: Limits(), lambda *a: None)   # doesn't raise
    assert b.account == "DU1234567"


# --- orders ---

def test_a_condor_goes_as_one_combo_limit_order_with_a_negative_price_for_a_credit():
    b, ib = broker()
    bid = b.place(req())
    t = ib.placed[0]
    assert bid == "IB-101"
    assert t.contract.secType == "BAG" and len(t.contract.comboLegs) == 4
    assert [l.action for l in t.contract.comboLegs] == ["BUY", "SELL", "SELL", "BUY"]
    assert t.order.orderType == "LMT" and t.order.action == "BUY" and t.order.lmtPrice == -4.6 and t.order.tif == "DAY"
    assert t.order.account == "DU1234567"


def test_a_debit_is_a_positive_price():
    b, ib = broker()
    b.place(req(structure="call", legs=(Leg("C", "buy", 600),), limit_price=2.35, price_kind="debit"))
    assert ib.placed[0].order.lmtPrice == 2.35


def test_closing_reverses_the_legs_and_pays_for_a_credit_structure():
    b, ib = broker()
    bid = b.place(req())
    b.close(bid, 1.2)
    t = ib.placed[1]
    assert [l.action for l in t.contract.comboLegs] == ["SELL", "BUY", "BUY", "SELL"]
    assert t.order.lmtPrice == 1.2


def test_status_follows_the_broker():
    b, ib = broker()
    bid = b.place(req())
    assert b.status(bid).status == "working"
    ib.fill(ib.placed[0], -4.55)
    o = b.status(bid)
    assert o.status == "filled" and o.fill_price == 4.55
    bid2 = b.place(req())
    b.cancel(bid2)
    assert b.status(bid2).status == "cancelled"


def test_market_orders_never_go():
    b, _ = broker()
    with pytest.raises(ValueError):
        b.place(req(order_type="market"))


# --- quotes ---

def test_a_quote_is_the_midpoints_on_the_tick():
    b, ib = broker()
    ib.mids = {(589.0, "P"): 0.80, (594.0, "P"): 1.55, (606.0, "C"): 1.40, (611.0, "C"): 0.62}
    q = b.quote(req(limit_price=9.99))
    assert q.price_kind == "credit" and q.limit_price == 1.50   # 1.53 rounded down to the tick
    assert q.prices_as_of == NOW


def test_delayed_data_is_stamped_old_so_the_stale_rail_refuses_it():
    b, ib = broker(delayed=True)
    assert ib.data_type == 3
    ib.mids = {(589.0, "P"): 0.80, (594.0, "P"): 1.55, (606.0, "C"): 1.40, (611.0, "C"): 0.62}
    q = b.quote(req())
    assert (NOW - q.prices_as_of).total_seconds() == 900


def test_no_quote_says_so():
    b, _ = broker()
    with pytest.raises(ValueError, match="No bid and ask"):
        b.quote(req())


# --- reconciling ---

def test_a_filled_structure_reconciles_leg_by_leg():
    b, ib = broker()
    bot = Bot(b, lambda: Limits(max_loss_per_day=1000, max_capital_at_risk=1000, approval_mode="automatic"), lambda *a: None, clock=lambda: NOW)
    p = bot.propose(req(limit_price=4.6))
    assert p.status == "sent"
    ib.fill(ib.placed[0], -4.6)
    assert [o.broker_id for o in b.positions()] == [p.broker_id]
    bot.record_fill(p.id, 4.6)
    assert bot.reconcile() == []


def test_a_position_nobody_placed_stops_trading():
    b, ib = broker()
    ib.held.append(SimpleNamespace(contract=SimpleNamespace(secType="OPT", symbol="SPY", lastTradeDateOrContractMonth="20261120", strike=600.0, right="C"),
                                   position=-1))
    bot = Bot(b, lambda: Limits(), lambda *a: None, clock=lambda: NOW)
    problems = bot.reconcile()
    assert problems and "didn't send" in problems[0] and bot.reconciled is False


def test_a_remembered_structure_missing_at_the_broker_stops_trading():
    from stockwizard.broker.base import BrokerOrder
    b, _ = broker()
    b.remember([BrokerOrder("IB-55", req(), "filled", 4.6)])
    assert b.positions() == []    # its legs aren't in the account
