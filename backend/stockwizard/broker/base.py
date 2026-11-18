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
    def close(self, broker_id: str, price: float) -> str:
        """Send one combo limit order closing a filled structure at `price` per share; return the close order's id.

        `status(close_id)` then says when it fills (and at what price) or is cancelled."""

    #: True when `quote` and `close_quote` ask a real market; False for made-up prices.
    real_quotes: bool = False

    def close_quote(self, order: OrderRequest) -> float:
        """What closing this structure costs (or brings in) per share now, in the opening's credit/debit sense."""
        raise NotImplementedError("This broker has no market to quote")

    @abstractmethod
    def status(self, broker_id: str) -> BrokerOrder | None:
        """Where one order stands now: working, filled (with its price) or cancelled. None if unknown."""

    @abstractmethod
    def quote(self, order: OrderRequest) -> OrderRequest:
        """The order with a fresh limit price and price time."""

    def remember(self, orders: list[BrokerOrder]) -> None:
        """Orders sent or filled before a restart, from the database."""

    def remember_close(self, close_id: str, broker_id: str, price: float) -> None:
        """A close that was working before a restart, from the database."""

    def settle(self, broker_id: str) -> None:
        """A position settled at expiry (cash-settled options need no order)."""

    @abstractmethod
    def positions(self) -> list[BrokerOrder]:
        """Filled orders still open (not yet expired or closed)."""
