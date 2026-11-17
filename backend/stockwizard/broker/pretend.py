"""A pretend broker, in memory, for testing the bot and the safety rails. Nothing leaves the machine.

It records every call, so a test can prove an order never reached it. Orders
stay working until `fill` is called; `drop` and `reconnect` act out IB
Gateway's daily restart.
"""

from __future__ import annotations

from itertools import count

from stockwizard.rails import OrderRequest

from .base import Broker, BrokerOrder


class PretendBroker(Broker):
    is_live = False

    def __init__(self):
        self._ids = count(1)
        self.orders: dict[str, BrokerOrder] = {}
        self.calls: list[tuple[str, str]] = []   # (what, broker_id)
        self._up = True

    def connected(self) -> bool:
        return self._up

    def place(self, order: OrderRequest) -> str:
        if not self._up:
            raise ConnectionError("pretend broker is disconnected")
        if order.order_type != "limit":
            raise ValueError("pretend broker takes limit orders only")
        bid = f"P{next(self._ids)}"
        self.orders[bid] = BrokerOrder(bid, order, "working")
        self.calls.append(("place", bid))
        return bid

    def cancel(self, broker_id: str) -> None:
        o = self.orders[broker_id]
        if o.status == "working":
            o.status = "cancelled"
        self.calls.append(("cancel", broker_id))

    def open_orders(self) -> list[BrokerOrder]:
        return [o for o in self.orders.values() if o.status == "working"]

    def positions(self) -> list[BrokerOrder]:
        return [o for o in self.orders.values() if o.status == "filled"]

    # --- for tests ---
    def fill(self, broker_id: str, price: float | None = None) -> None:
        o = self.orders[broker_id]
        o.status, o.fill_price = "filled", price if price is not None else o.request.limit_price

    def drop(self) -> None:
        self._up = False

    def reconnect(self) -> None:
        self._up = True
