"""The interface every broker adapter meets. Strategy code and the bot never see more than this.

The Interactive Brokers adapter (ib_async against IB Gateway, paper port) comes
later; the pretend broker stands in until then.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass

from stockwizard.rails import OrderRequest


class LiveTradingDisabled(RuntimeError):
    """Raised whenever anything tries to trade with a live account. There is no setting that lifts it."""


@dataclass
class BrokerOrder:
    broker_id: str
    request: OrderRequest | None   # None: an order or position the bot didn't make (reconcile flags it)
    status: str  # working, filled, cancelled, closed
    fill_price: float | None = None


class Broker(ABC):
    #: True for a real-money account. The bot refuses such a broker outright.
    is_live: bool = False

    @abstractmethod
    def connected(self) -> bool: ...

    @abstractmethod
    def place(self, order: OrderRequest) -> str:
        """Send one combo limit order; return the broker's id for it."""

    @abstractmethod
    def cancel(self, broker_id: str) -> None: ...

    @abstractmethod
    def open_orders(self) -> list[BrokerOrder]: ...

    @abstractmethod
    def close(self, broker_id: str, price: float) -> None:
        """Close a filled structure with one combo limit order at `price` per share."""

    @abstractmethod
    def status(self, broker_id: str) -> BrokerOrder | None:
        """Where one order stands now: working, filled (with its price) or cancelled. None if unknown."""

    @abstractmethod
    def quote(self, order: OrderRequest) -> OrderRequest:
        """The order with a fresh limit price and price time."""

    def remember(self, orders: list[BrokerOrder]) -> None:
        """Orders sent or filled before a restart, from the database."""

    @abstractmethod
    def positions(self) -> list[BrokerOrder]:
        """Filled orders still open (not yet expired or closed)."""
