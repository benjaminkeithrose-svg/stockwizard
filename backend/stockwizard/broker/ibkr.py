"""Interactive Brokers, through IB Gateway (or TWS) on Ben's PC, with ib_async. Paper only.

Two guards make sure this can never trade real money:
- the live ports (IB Gateway 4001, TWS 7496) are refused before connecting;
- after connecting, every account must be a paper account (IBKR paper
  account numbers start "DU"), or it disconnects and refuses.

Orders follow the spec: one combo ("BAG") limit order per structure, never at
market, a day order. IBKR prices combos with the sign of the cash: a credit is
a negative limit price on a BUY of the combo, a debit a positive one. Check
this on the first paper orders.

Quotes are the midpoint of each leg's bid and ask. With delayed market data
(no subscription), prices are stamped 15 minutes old, so the stale-data rail
refuses them, as it should.

Written against IBKR's and ib_async's documentation; it can only be tested
once Ben's paper account and IB Gateway are running. The tests use a stand-in.
"""

from __future__ import annotations

import math
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from stockwizard.rails import OrderRequest

from .base import Broker, BrokerOrder, LiveTradingDisabled

LIVE_PORTS = {4001, 7496}         # IB Gateway live, TWS live
PAPER_PORT = 4002                 # IB Gateway paper (TWS paper is 7497)
CLIENT_ID = 17                    # a fixed id, so order numbers carry over between runs
WORKING = {"PendingSubmit", "ApiPending", "PreSubmitted", "Submitted", "PendingCancel"}
CANCELLED = {"Cancelled", "ApiCancelled", "Inactive"}
DELAY = timedelta(minutes=15)
NY = ZoneInfo("America/New_York")


def _ib_module():
    try:
        import ib_async  # noqa: PLC0415 - only needed on the PC that runs IB Gateway
    except ImportError as e:  # pragma: no cover
        raise SystemExit("Install the Interactive Brokers library first: pip install -e \".[ibkr]\"") from e
    return ib_async


class IBKRBroker(Broker):
    is_live = False
    real_quotes = True

    def __init__(self, host: str = "127.0.0.1", port: int = PAPER_PORT, client_id: int = CLIENT_ID,
                 delayed: bool = False, ib=None, lib=None, clock=lambda: datetime.now(timezone.utc)):
        if port in LIVE_PORTS:
            raise LiveTradingDisabled(f"Port {port} is a live-trading port. The bot only connects to a paper account.")
        self.lib = lib or _ib_module()
        self.ib = ib or self.lib.IB()
        self.clock, self.delayed = clock, delayed
        self.ib.connect(host, port, clientId=client_id)
        accounts = list(self.ib.managedAccounts())
        if not accounts or any(not a.upper().startswith("DU") for a in accounts):
            self.ib.disconnect()
            raise LiveTradingDisabled(f"Account {', '.join(accounts) or '(none)'} isn't a paper account (paper accounts start DU). Disconnected.")
        self.account = accounts[0]
        self.ib.reqMarketDataType(3 if delayed else 1)
        self._trades: dict[str, object] = {}            # broker id → ib_async Trade, this session
        self._requests: dict[str, OrderRequest] = {}    # broker id → what it was, including remembered ones
        self._filled: dict[str, float | None] = {}      # remembered fills from the database
        self._closes: dict[str, str] = {}               # close order id → the position it closes

    # --- contracts ---
    def _legs(self, req: OrderRequest):
        opts = [self.lib.Option(req.symbol, req.expiry.strftime("%Y%m%d"), l.strike, l.right, "SMART", multiplier="100", currency="USD")
                for l in req.legs]
        qualified = self.ib.qualifyContracts(*opts)
        if len(qualified) != len(opts) or any(not getattr(c, "conId", 0) for c in qualified):
            raise ValueError(f"IBKR doesn't list every leg of the {req.symbol} {req.expiry} structure: check the expiry and strikes")
        return qualified

    def _bag(self, req: OrderRequest, legs, closing: bool = False):
        flip = {"buy": "SELL", "sell": "BUY"} if closing else {"buy": "BUY", "sell": "SELL"}
        combo = [self.lib.ComboLeg(conId=c.conId, ratio=l.qty, action=flip[l.side], exchange="SMART") for c, l in zip(legs, req.legs)]
        return self.lib.Bag(symbol=req.symbol, exchange="SMART", currency="USD", comboLegs=combo)

    def _limit(self, price: float, cash_in: bool):
        """A BUY of the combo; a negative limit price means cash comes in (a credit)."""
        return self.lib.LimitOrder("BUY", 0, round(-price if cash_in else price, 2), tif="DAY", account=self.account)

    # --- the Broker interface ---
    def connected(self) -> bool:
        return bool(self.ib.isConnected())

    def place(self, order: OrderRequest) -> str:
        if order.order_type != "limit" or order.limit_price is None:
            raise ValueError("Options go as limit orders only")
        legs = self._legs(order)
        lim = self._limit(order.limit_price, cash_in=order.price_kind == "credit")
        lim.totalQuantity = order.quantity
        trade = self.ib.placeOrder(self._bag(order, legs), lim)
        bid = f"IB-{trade.order.orderId}"
        self._trades[bid], self._requests[bid] = trade, order
        return bid

    def cancel(self, broker_id: str) -> None:
        trade = self._trades.get(broker_id)
        if trade is None:
            raise ValueError(f"{broker_id} wasn't placed in this session; cancel it in IB Gateway")
        self.ib.cancelOrder(trade.order)

    def modify(self, broker_id: str, order: OrderRequest) -> None:
        """A new limit price on the same order (IBKR changes an order placed again with its own order id)."""
        trade = self._find(broker_id)
        if trade is None:
            raise ValueError(f"{broker_id} wasn't placed in this session")
        trade.order.lmtPrice = self._limit(order.limit_price, cash_in=order.price_kind == "credit").lmtPrice
        self.ib.placeOrder(trade.contract, trade.order)
        self._requests[broker_id] = order

    def close(self, broker_id: str, price: float) -> str:
        req = self._requests.get(broker_id)
        if req is None:
            raise ValueError(f"No record of {broker_id}")
        legs = self._legs(req)
        # Closing a credit structure costs money (cash out); closing a debit structure brings money in.
        lim = self._limit(price, cash_in=req.price_kind == "debit")
        lim.totalQuantity = req.quantity
        trade = self.ib.placeOrder(self._bag(req, legs, closing=True), lim)
        cid = f"IB-{trade.order.orderId}"
        self._trades[cid], self._closes[cid] = trade, broker_id
        return cid

    def remember_close(self, close_id: str, broker_id: str, price: float) -> None:
        self._closes[close_id] = broker_id

    def _find(self, broker_id: str):
        """This session's trade, or one from before a restart (same client id, so the same order number)."""
        trade = self._trades.get(broker_id)
        if trade is None and broker_id.startswith("IB-") and broker_id[3:].isdigit():
            trade = next((t for t in getattr(self.ib, "trades", list)() if t.order.orderId == int(broker_id[3:])), None)
            if trade is not None:
                self._trades[broker_id] = trade
        return trade

    def close_quote(self, order: OrderRequest) -> float:
        """The structure's value now from leg midpoints, rounded on a 5c tick towards getting filled:
        paying to close a credit is rounded up, collecting on a debit rounded down."""
        legs = self._legs(order)
        net = 0.0
        for t, l in zip(self.ib.reqTickers(*legs), order.legs):
            mid = t.midpoint()
            if mid is None or (isinstance(mid, float) and math.isnan(mid)):
                raise ValueError(f"No bid and ask for the {l.strike:g} {'call' if l.right == 'C' else 'put'}: is the market open and the data subscribed?")
            net += (1 if l.side == "buy" else -1) * l.qty * mid
        if order.price_kind == "credit":   # buying back: pay what the shorts are worth over the longs
            return round(max(0.05, math.ceil(round(-net / 0.05, 6)) * 0.05), 2)
        return round(max(0.05, math.floor(round(net / 0.05, 6)) * 0.05), 2)

    def status(self, broker_id: str) -> BrokerOrder | None:
        trade = self._find(broker_id)
        if trade is None:
            return None
        st = trade.orderStatus.status
        req = self._requests.get(broker_id)
        if st == "Filled":
            return BrokerOrder(broker_id, req, "filled", abs(trade.orderStatus.avgFillPrice))
        if st in CANCELLED:
            return BrokerOrder(broker_id, req, "cancelled")
        return BrokerOrder(broker_id, req, "working")

    def open_orders(self) -> list[BrokerOrder]:
        mine = {id(t) for t in self._trades.values()}
        out = [o for bid in self._trades if bid not in self._closes and (o := self.status(bid)) and o.status == "working"]
        for t in self.ib.openTrades():
            if id(t) not in mine and f"IB-{t.order.orderId}" not in self._closes and t.orderStatus.status in WORKING:
                out.append(BrokerOrder(f"IB-{t.order.orderId}", None, "working"))   # placed by someone else: reconcile flags it
        return out

    def positions(self) -> list[BrokerOrder]:
        """Filled structures, checked leg by leg against the account's actual option positions.

        A structure whose legs aren't all there is left out (reconcile then says it's unknown at the
        broker); option positions no structure accounts for come back as unknown orders.
        """
        held: dict[tuple, float] = {}
        for p in self.ib.positions(self.account):
            c = p.contract
            if getattr(c, "secType", "") == "OPT" and p.position:
                key = (c.symbol, str(c.lastTradeDateOrContractMonth)[:8], float(c.strike), c.right)
                held[key] = held.get(key, 0) + p.position
        filled = {bid: price for bid, price in self._filled.items()}
        for bid in self._trades:
            o = self.status(bid)
            if o and o.status == "filled" and bid not in self._closes:
                filled[bid] = o.fill_price
        out: list[BrokerOrder] = []
        for bid, price in filled.items():
            req = self._requests[bid]
            need = {(req.symbol, req.expiry.strftime("%Y%m%d"), float(l.strike), l.right): (1 if l.side == "buy" else -1) * l.qty * req.quantity
                    for l in req.legs}
            if all(math.copysign(1, held.get(k, 0)) == math.copysign(1, q) and abs(held.get(k, 0)) >= abs(q) for k, q in need.items()):
                for k, q in need.items():
                    held[k] -= q
                out.append(BrokerOrder(bid, req, "filled", price))
        for k, q in held.items():
            if abs(q) > 1e-9:
                out.append(BrokerOrder(f"IB-position-{k[0]}-{k[1]}-{k[2]:g}{k[3]}", None, "filled"))
        return out

    def settle(self, broker_id: str) -> None:
        self._filled.pop(broker_id, None)   # IBKR settles cash-settled options itself; stop expecting the legs

    def remember(self, orders: list[BrokerOrder]) -> None:
        for o in orders:
            self._requests[o.broker_id] = o.request
            if o.status == "filled":
                self._filled[o.broker_id] = o.fill_price

    def quote(self, order: OrderRequest) -> OrderRequest:
        """The structure's price from the legs' bid/ask midpoints, on a 5c tick (a credit rounded down, a debit up)."""
        legs = self._legs(order)
        tickers = self.ib.reqTickers(*legs)
        net = 0.0
        for t, l in zip(tickers, order.legs):
            mid = t.midpoint()
            if mid is None or (isinstance(mid, float) and math.isnan(mid)):
                raise ValueError(f"No bid and ask for the {l.strike:g} {'call' if l.right == 'C' else 'put'}: is the market open and the data subscribed?")
            net += (1 if l.side == "buy" else -1) * l.qty * mid
        if net < 0:
            price, kind = max(0.05, math.floor(-net / 0.05) * 0.05), "credit"
        else:
            price, kind = max(0.05, math.ceil(net / 0.05) * 0.05), "debit"
        when = self.clock() - (DELAY if self.delayed else timedelta(0))
        return replace(order, limit_price=round(price, 2), price_kind=kind, prices_as_of=when)

    def chain_snapshot(self, symbol: str = "SPY", expiries: int = 4, width: float = 0.02, batch: int = 50) -> list[dict]:
        """Bid, ask, last and implied volatility for the next `expiries` expiries, strikes within `width` of the price.

        For recording our own price history. Requested in batches, to stay inside IBKR's market-data line limit.
        """
        stock = self.ib.qualifyContracts(self.lib.Stock(symbol, "SMART", "USD"))[0]
        under = self.ib.reqTickers(stock)[0]
        spot = under.marketPrice()
        if spot is None or (isinstance(spot, float) and math.isnan(spot)):
            raise ValueError(f"No price for {symbol}: is the market open and the data subscribed?")
        chains = self.ib.reqSecDefOptParams(symbol, "", "STK", stock.conId)
        # IBKR lists several SMART chains: the standard one (trading class = the symbol) and adjusted
        # ones after corporate actions (SPY's "2SPY", a handful of strikes). Seen on TWS paper, 18 Nov 2026.
        smart = [c for c in chains if c.exchange == "SMART"]
        chain = next((c for c in smart if getattr(c, "tradingClass", "") == symbol), None)
        if chain is None:
            chain = max(smart or chains, key=lambda c: len(c.strikes), default=None)
        if chain is None:
            raise ValueError(f"IBKR lists no options for {symbol}")
        today = self.clock().astimezone(NY).strftime("%Y%m%d")
        dates = sorted(e for e in chain.expirations if e >= today)[:expiries]
        strikes = sorted(k for k in chain.strikes if abs(k - spot) <= spot * width)
        contracts = [self.lib.Option(symbol, e, k, r, "SMART", multiplier="100", currency="USD") for e in dates for k in strikes for r in ("C", "P")]
        taken = self.clock().replace(second=0, microsecond=0).isoformat()
        num = lambda v: None if v is None or (isinstance(v, float) and (math.isnan(v) or v <= 0)) else round(float(v), 4)  # noqa: E731
        rows: list[dict] = []
        for i in range(0, len(contracts), batch):
            part = [c for c in self.ib.qualifyContracts(*contracts[i : i + batch]) if getattr(c, "conId", 0)]
            for c, t in zip(part, self.ib.reqTickers(*part)):
                greeks = getattr(t, "modelGreeks", None)
                rows.append({
                    "taken_at": taken, "symbol": symbol,
                    "expiry": f"{c.lastTradeDateOrContractMonth[:4]}-{c.lastTradeDateOrContractMonth[4:6]}-{c.lastTradeDateOrContractMonth[6:8]}",
                    "strike": float(c.strike), "right": c.right, "bid": num(t.bid), "ask": num(t.ask), "last": num(t.last),
                    "iv": num(getattr(greeks, "impliedVol", None)) if greeks else None, "underlying": round(float(spot), 4), "source": "ibkr",
                })
        return rows

    def disconnect(self) -> None:
        self.ib.disconnect()
