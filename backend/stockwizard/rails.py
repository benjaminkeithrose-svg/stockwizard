"""The safety rails (SPEC.md, Broker adapter and safety rails). Pure: no broker, no database.

Every order the bot could send passes `check` first, and again when Ben
approves it, because prices can go stale in between. A refusal names the rail
and says why in plain words; the bot writes each one to the audit log.

1. Defined-risk structures only: no naked short options, ever.
2. Maximum loss per trade (a stored limit, $50 to start).
3. Maximum loss per day. It starts unset, and while it is unset every order is
   refused: Ben sets it once real spread prices are known.
4. Caps on open positions and on total capital at risk.
5. Stale-data stop: no order on prices or a signal older than a set age.
6. Kill switch: blocks every new order (the bot also cancels open ones).
7. Approval mode by default (handled by the bot: a proposal waits for Ben).
8. The audit log (handled by the bot: every check, approval and refusal).

Also enforced here: options go as one limit order (no market orders), all legs
on one expiry, whole contracts, and a broker that is connected and reconciled.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Literal

MULTIPLIER = 100  # shares per US equity option contract


@dataclass(frozen=True)
class Leg:
    right: Literal["C", "P"]
    side: Literal["buy", "sell"]
    strike: float
    qty: int = 1  # contracts per structure


@dataclass(frozen=True)
class OrderRequest:
    """One structure, sent as one combo limit order."""

    symbol: str
    structure: str
    expiry: date
    legs: tuple[Leg, ...]
    quantity: int                      # how many of the structure
    limit_price: float | None          # per share, net, always positive
    price_kind: Literal["credit", "debit"]
    prices_as_of: datetime             # the quote the limit price came from
    signal_as_of: datetime | None = None
    order_type: Literal["limit", "market"] = "limit"
    leg_expiries: tuple[date, ...] = ()  # filled in when legs come from different expiries (refused)


@dataclass(frozen=True)
class Limits:
    max_loss_per_trade: float = 50.0
    max_loss_per_day: float | None = None      # unset: every order refused
    max_open_positions: int = 1
    max_capital_at_risk: float = 100.0
    max_data_age_seconds: int = 120
    approval_mode: Literal["approval", "automatic"] = "approval"
    kill_switch: bool = False

    @classmethod
    def from_row(cls, row: dict) -> "Limits":
        """From a safety_limits row; anything missing keeps its safe default."""
        keep = {k: row[k] for k in cls.__dataclass_fields__ if k in row and row[k] is not None}
        for k in ("max_loss_per_trade", "max_loss_per_day", "max_capital_at_risk"):
            if k in keep:
                keep[k] = float(keep[k])
        if "max_loss_per_day" not in keep:
            keep["max_loss_per_day"] = None
        return cls(**keep)


@dataclass
class Book:
    """Where things stand today, as the bot sees it after reconciling with the broker."""

    realised_loss_today: float = 0.0           # dollars lost on trades closed today (a gain counts as 0 here)
    open_max_losses: list[float] = field(default_factory=list)  # the max loss of each open position and working order
    connected: bool = True
    reconciled: bool = True                    # after a reconnect, False until positions and orders are checked


@dataclass(frozen=True)
class Refusal:
    rail: str
    why: str


def payoff_at(legs: tuple[Leg, ...], price: float) -> float:
    """The legs' value per share at expiry at this underlying price, before the premium (long +, short -)."""
    total = 0.0
    for leg in legs:
        intrinsic = max(price - leg.strike, 0.0) if leg.right == "C" else max(leg.strike - price, 0.0)
        total += intrinsic * leg.qty * (1 if leg.side == "buy" else -1)
    return total


def uncovered(legs: tuple[Leg, ...]) -> list[str]:
    """Short options not covered by a long option of the same right (rail 1)."""
    out = []
    for right, name in (("C", "call"), ("P", "put")):
        short = sum(l.qty for l in legs if l.right == right and l.side == "sell")
        long = sum(l.qty for l in legs if l.right == right and l.side == "buy")
        if short > long:
            out.append(f"{short - long} short {name}{'s' if short - long > 1 else ''} with no long {name} to cover")
    return out


def max_loss(order: OrderRequest) -> float | None:
    """The most the order can lose at expiry, in dollars, premium included. None when it is unbounded.

    The payoff is straight between strikes, so its lowest point is at a strike,
    at zero, or (if calls are net short) without limit as the price rises.
    """
    legs = order.legs
    net_calls = sum(l.qty * (1 if l.side == "buy" else -1) for l in legs if l.right == "C")
    if net_calls < 0:
        return None
    if order.limit_price is None:
        return None
    premium = order.limit_price if order.price_kind == "credit" else -order.limit_price
    points = [0.0] + sorted({l.strike for l in legs}) + [max(l.strike for l in legs) * 2 + 1]
    worst = min(payoff_at(legs, p) + premium for p in points)
    return round(max(0.0, -worst) * MULTIPLIER * order.quantity, 2)


def check(order: OrderRequest, limits: Limits, book: Book, now: datetime) -> list[Refusal]:
    """Every rail the order fails. Empty means it may go (to Ben for approval, or to the broker in automatic mode)."""
    r: list[Refusal] = []

    # 6. Kill switch first: nothing else matters while it is on.
    if limits.kill_switch:
        r.append(Refusal("kill_switch", "The kill switch is on: no new orders."))

    # The broker: connected, and checked against after any reconnect.
    if not book.connected:
        r.append(Refusal("broker", "The broker is disconnected: trading is stopped until it reconnects."))
    elif not book.reconciled:
        r.append(Refusal("broker", "The broker reconnected but positions and orders haven't been checked against it yet."))

    # Order form: one limit order, whole contracts, one expiry.
    if order.order_type != "limit" or order.limit_price is None or order.limit_price <= 0:
        r.append(Refusal("order_form", "Options go as limit orders with a price above zero; never at market."))
    if order.quantity < 1 or any(l.qty < 1 for l in order.legs) or not order.legs:
        r.append(Refusal("order_form", "Every leg needs at least one whole contract."))
    if order.leg_expiries and len(set(order.leg_expiries) | {order.expiry}) > 1:
        r.append(Refusal("order_form", "All legs must share one expiry."))

    # 1. Defined risk.
    naked = uncovered(order.legs)
    if naked:
        r.append(Refusal("defined_risk", "Not defined risk: " + "; ".join(naked) + "."))

    # 2. Per trade.
    loss = max_loss(order)
    if loss is None:
        if not naked:
            r.append(Refusal("per_trade", "The most this order could lose can't be worked out, so it can't be checked against the limit."))
    elif loss > limits.max_loss_per_trade:
        r.append(Refusal("per_trade", f"It could lose ${loss:,.2f}; the limit per trade is ${limits.max_loss_per_trade:,.2f}."))

    # 3. Per day.
    if limits.max_loss_per_day is None:
        r.append(Refusal("per_day", "The daily loss limit isn't set yet: every order is refused until Ben sets it."))
    else:
        if book.realised_loss_today >= limits.max_loss_per_day:
            r.append(Refusal("per_day", f"Today's losses (${book.realised_loss_today:,.2f}) have reached the daily limit: trading is halted for today."))
        elif loss is not None:
            worst_day = book.realised_loss_today + sum(book.open_max_losses) + loss
            if worst_day > limits.max_loss_per_day:
                r.append(Refusal("per_day", f"If this and everything open lost the most it can, today would lose ${worst_day:,.2f}; the daily limit is ${limits.max_loss_per_day:,.2f}."))

    # 4. Positions and capital at risk.
    if len(book.open_max_losses) + 1 > limits.max_open_positions:
        r.append(Refusal("positions", f"{len(book.open_max_losses)} open already; the cap is {limits.max_open_positions}."))
    if loss is not None and sum(book.open_max_losses) + loss > limits.max_capital_at_risk:
        r.append(Refusal("capital_at_risk", f"Capital at risk would be ${sum(book.open_max_losses) + loss:,.2f}; the cap is ${limits.max_capital_at_risk:,.2f}."))

    # 5. Stale data.
    age = (now - order.prices_as_of).total_seconds()
    if age > limits.max_data_age_seconds:
        r.append(Refusal("stale_data", f"The prices are {age:.0f} seconds old; the limit is {limits.max_data_age_seconds}."))
    if order.signal_as_of is not None:
        sage = (now - order.signal_as_of).total_seconds()
        if sage > limits.max_data_age_seconds:
            r.append(Refusal("stale_data", f"The signal is {sage:.0f} seconds old; the limit is {limits.max_data_age_seconds}."))
    return r
