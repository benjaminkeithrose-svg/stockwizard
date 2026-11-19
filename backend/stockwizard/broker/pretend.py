"""A pretend broker, in memory, for testing the bot and the safety rails. Nothing leaves the machine.

It records every call, so a test can prove an order never reached it. Orders
stay working until `fill` is called; `drop` and `reconnect` act out IB
Gateway's daily restart.
"""

from __future__ import annotations

import secrets
from dataclasses import replace
from datetime import datetime, timezone

from stockwizard.rails import OrderRequest

from .base import Broker, BrokerOrder


class PretendBroker(Broker):
    is_live = False

    def __init__(self, remembered: list[BrokerOrder] | None = None, clock=lambda: datetime.now(timezone.utc)):
        """`remembered`: orders it already holds. A pretend broker has no memory of its own between runs,
        so the runner hands it the paper orders the database says were sent or filled."""
        self.orders: dict[str, BrokerOrder] = {}
        self._closes: dict[str, tuple[str, float]] = {}   # close id → (the position it closes, its limit price)
        self.remember(remembered or [])
        self.clock = clock
        self.calls: list[tuple[str, str]] = []   # (what, broker_id)
        self._up = True

    def connected(self) -> bool:
        return self._up

    def place(self, order: OrderRequest) -> str:
        if not self._up:
            raise ConnectionError("pretend broker is disconnected")
        if order.order_type != "limit":
            raise ValueError("pretend broker takes limit orders only")
        bid = f"P-{secrets.token_hex(4)}"
        self.orders[bid] = BrokerOrder(bid, order, "working")
        self.calls.append(("place", bid))
        return bid

    def cancel(self, broker_id: str) -> None:
        o = self.orders[broker_id]
        if o.status == "working":
            o.status = "cancelled"
        self.calls.append(("cancel", broker_id))

    def modify(self, broker_id: str, order: OrderRequest) -> None:
        o = self.orders[broker_id]
        if o.status != "working":
            raise ValueError(f"{broker_id} is {o.status}, not working")
        o.request = order
        self.calls.append(("modify", broker_id))

    def close(self, broker_id: str, price: float) -> str:
        """A working close order; it fills at `price` on the next `step` (or `fill`), and the position goes."""
        if not self._up:
            raise ConnectionError("pretend broker is disconnected")
        o = self.orders[broker_id]
        if o.status != "filled":
            raise ValueError(f"{broker_id} is {o.status}, not an open position")
        cid = f"{broker_id}-close"
        self.orders[cid] = BrokerOrder(cid, None, "working")
        self._closes[cid] = (broker_id, price)
        self.calls.append(("close", broker_id))
        return cid

    def remember(self, orders: list[BrokerOrder]) -> None:
        for o in orders:
            self.orders[o.broker_id] = o

    def remember_close(self, close_id: str, broker_id: str, price: float) -> None:
        self.orders[close_id] = BrokerOrder(close_id, None, "working")
        self._closes[close_id] = (broker_id, price)

    def settle(self, broker_id: str) -> None:
        if broker_id in self.orders:
            self.orders[broker_id].status = "closed"
        self.calls.append(("settle", broker_id))

    def status(self, broker_id: str) -> BrokerOrder | None:
        return self.orders.get(broker_id)

    def open_orders(self) -> list[BrokerOrder]:
        """Working opening orders. Closes aren't listed: they only reduce risk, and the kill switch leaves them working."""
        return [o for o in self.orders.values() if o.status == "working" and o.broker_id not in self._closes]

    def positions(self) -> list[BrokerOrder]:
        return [o for o in self.orders.values() if o.status == "filled" and o.broker_id not in self._closes]

    def quote(self, order: OrderRequest) -> OrderRequest:
        """A pretend quote: the same price, stamped now. The real adapter asks the market."""
        return replace(order, prices_as_of=self.clock())

    def step(self) -> list[str]:
        """Pretend the market moved: every working order fills at its limit price."""
        done = []
        for o in [o for o in self.orders.values() if o.status == "working"]:
            self.fill(o.broker_id)
            done.append(o.broker_id)
        return done

    # --- for tests ---
    def fill(self, broker_id: str, price: float | None = None) -> None:
        o = self.orders[broker_id]
        if broker_id in self._closes:
            position, limit = self._closes[broker_id]
            o.status, o.fill_price = "filled", price if price is not None else limit
            self.orders[position].status = "closed"
            return
        o.status, o.fill_price = "filled", price if price is not None else o.request.limit_price

    def drop(self) -> None:
        self._up = False

    def reconnect(self) -> None:
        self._up = True
