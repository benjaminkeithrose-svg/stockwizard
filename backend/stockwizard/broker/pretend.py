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

    def close(self, broker_id: str, price: float) -> None:
        if not self._up:
            raise ConnectionError("pretend broker is disconnected")
        o = self.orders[broker_id]
        if o.status != "filled":
            raise ValueError(f"{broker_id} is {o.status}, not an open position")
        o.status = "closed"
        self.calls.append(("close", broker_id))

    def remember(self, orders: list[BrokerOrder]) -> None:
        for o in orders:
            self.orders[o.broker_id] = o

    def status(self, broker_id: str) -> BrokerOrder | None:
        return self.orders.get(broker_id)

    def open_orders(self) -> list[BrokerOrder]:
        return [o for o in self.orders.values() if o.status == "working"]

    def positions(self) -> list[BrokerOrder]:
        return [o for o in self.orders.values() if o.status == "filled"]

    def quote(self, order: OrderRequest) -> OrderRequest:
        """A pretend quote: the same price, stamped now. The real adapter asks the market."""
        return replace(order, prices_as_of=self.clock())

    def step(self) -> list[str]:
        """Pretend the market moved: every working order fills at its limit price."""
        done = []
        for o in self.open_orders():
            self.fill(o.broker_id)
            done.append(o.broker_id)
        return done

    # --- for tests ---
    def fill(self, broker_id: str, price: float | None = None) -> None:
        o = self.orders[broker_id]
        o.status, o.fill_price = "filled", price if price is not None else o.request.limit_price

    def drop(self) -> None:
        self._up = False

    def reconnect(self) -> None:
        self._up = True
