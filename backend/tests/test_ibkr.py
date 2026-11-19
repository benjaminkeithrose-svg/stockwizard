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
    def Stock(symbol, exchange, currency):
        return SimpleNamespace(symbol=symbol, secType="STK", conId=0)

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
    modified: list = field(default_factory=list)
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
            c.conId = 756733 if c.secType == "STK" else int(c.strike * 10) + (1 if c.right == "C" else 0)
        return list(cs)

    def reqSecDefOptParams(self, symbol, exchange, sec_type, con_id):
        assert con_id == 756733
        # As TWS returns it: an adjusted chain (2SPY, few strikes) listed before the standard one.
        return [SimpleNamespace(exchange="SMART", tradingClass="2SPY", expirations=["20261120", "20261127"], strikes=[596.0, 597.0]),
                SimpleNamespace(exchange="SMART", tradingClass="SPY", expirations=["20261117", "20261118", "20261119", "20261120", "20261123", "20261124"],
                                strikes=[float(k) for k in range(580, 621)])]

    def placeOrder(self, contract, order):
        mine = next((t for t in self.placed if t.order is order and getattr(order, "orderId", 0)), None)
        if mine is not None:   # as IBKR does: the same order id placed again changes that order
            self.modified.append(order.orderId)
            return mine
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
        out = []
        for c in cs:
            if c.secType == "STK":
                out.append(SimpleNamespace(marketPrice=lambda: 600.0))
            else:
                m = self.mids.get((c.strike, c.right), 1.0)
                out.append(SimpleNamespace(midpoint=lambda m=m: m, bid=m - 0.05, ask=m + 0.05, last=float("nan"),
                                           modelGreeks=SimpleNamespace(impliedVol=0.16)))
        self.ticker_batches = getattr(self, "ticker_batches", []) + [len(cs)]
        return out

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


def test_working_the_price_changes_the_same_order_not_a_new_one():
    from dataclasses import replace as _replace
    b, ib = broker()
    bid = b.place(req())
    b.modify(bid, _replace(req(), limit_price=4.40))
    assert len(ib.placed) == 1 and ib.modified == [101]
    assert ib.placed[0].order.lmtPrice == -4.4, "still a credit: a negative price"


def test_a_debit_is_a_positive_price():
    b, ib = broker()
    b.place(req(structure="call", legs=(Leg("C", "buy", 600),), limit_price=2.35, price_kind="debit"))
    assert ib.placed[0].order.lmtPrice == 2.35


def test_closing_reverses_the_legs_and_pays_for_a_credit_structure():
    b, ib = broker()
    bid = b.place(req())
    cid = b.close(bid, 1.2)
    t = ib.placed[1]
    assert [l.action for l in t.contract.comboLegs] == ["SELL", "BUY", "BUY", "SELL"]
    assert t.order.lmtPrice == 1.2
    assert cid == "IB-102"


def test_a_close_is_its_own_order_its_fill_is_reported_and_it_isnt_a_new_position():
    b, ib = broker()
    bid = b.place(req())
    ib.fill(ib.placed[0], -4.55)
    cid = b.close(bid, 1.2)
    assert b.status(cid).status == "working"
    assert cid not in [o.broker_id for o in b.open_orders()], "the kill switch leaves a close working"
    ib.fill(ib.placed[1], 1.15)
    o = b.status(cid)
    assert o.status == "filled" and o.fill_price == 1.15
    assert cid not in [o.broker_id for o in b.positions()]


def test_closing_is_quoted_on_the_tick_towards_a_fill():
    b, ib = broker()
    ib.mids = {(589.0, "P"): 0.80, (594.0, "P"): 1.55, (606.0, "C"): 1.40, (611.0, "C"): 0.62}
    assert b.close_quote(req()) == 1.55                            # buying back a 1.53 credit: pay up to the tick
    one_call = req(structure="call", legs=(Leg("C", "buy", 606),), price_kind="debit")
    assert b.close_quote(one_call) == 1.40                         # selling a 1.40 call: exactly on the tick
    ib.mids[(606.0, "C")] = 1.43
    assert b.close_quote(one_call) == 1.40                         # 1.43: collect down to the tick


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
    b, ib = broker()
    ib.mids = {(589.0, "P"): float("nan")}
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


# --- recording quotes ---

def test_a_snapshot_covers_the_next_4_expiries_within_2_percent():
    b, ib = broker()
    rows = b.chain_snapshot("SPY")
    expiries = sorted({r["expiry"] for r in rows})
    assert expiries == ["2026-11-18", "2026-11-19", "2026-11-20", "2026-11-23"]   # from today (New York), the next 4
    strikes = sorted({r["strike"] for r in rows})
    assert strikes[0] == 588 and strikes[-1] == 612                               # 600 ± 2%
    assert len(rows) == 4 * 25 * 2
    r = rows[0]
    assert r["bid"] == 0.95 and r["ask"] == 1.05 and r["last"] is None and r["iv"] == 0.16 and r["underlying"] == 600.0
    assert max(ib.ticker_batches) <= 50, "stays inside IBKR's market-data line limit"


def test_a_snapshot_uses_the_standard_chain_not_an_adjusted_one():
    b, ib = broker()
    rows = b.chain_snapshot("SPY")
    assert "2026-11-27" not in {r["expiry"] for r in rows}, "2SPY's expiry, not SPY's"
    assert len({r["strike"] for r in rows}) == 25, "SPY's strikes within 2%, not 2SPY's two"
