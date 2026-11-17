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
    request: OrderRequest
    status: str  # working, filled, cancelled
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
    def positions(self) -> list[BrokerOrder]:
        """Filled orders still open (not yet expired or closed)."""
