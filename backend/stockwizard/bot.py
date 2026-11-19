"""The paper bot's core: the only way an order reaches a broker (SPEC.md, phase 5).

    propose → rails → (approval mode) waits for Ben → approve → rails again → broker
                    → (automatic mode, only if Ben turned it on) → broker

Every proposal, refusal, approval, rejection, send, cancel, kill and
reconnect goes to the audit log through `audit(actor, action, detail)`.
A live (real-money) broker is refused when the bot starts: there is no
setting that allows one. Storage is in memory here; the Supabase tables
(safety_limits, paper_orders) are wired in with the Interactive Brokers
adapter.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field, replace
from datetime import datetime, timezone
from itertools import count
from typing import Callable

from stockwizard.broker.base import Broker, LiveTradingDisabled
from stockwizard.rails import Book, Limits, OrderRequest, Refusal, check, max_loss
from stockwizard import working
from stockwizard.working import Plan

Audit = Callable[[str, str, dict], None]


@dataclass
class Proposal:
    id: int
    request: OrderRequest
    status: str                      # proposed, refused, rejected, sent, filled, cancelled, closed, failed
    max_loss: float | None
    refusals: list[Refusal] = field(default_factory=list)
    broker_id: str | None = None
    pnl: float | None = None
    reason: str | None = None        # why the bot proposed it, in plain words
    fill_price: float | None = None
    close_id: str | None = None      # the close order at the broker while it works; the position stays 'filled' until it fills
    close_price: float | None = None # its limit price per share, in the same credit/debit sense as the opening
    close_why: str | None = None
    work: Plan | None = None         # working the price from the midpoint towards the worst allowed (working.py)
    work_held: bool = False          # a step a rail refused: the price stays where it was
    unfilled: bool = False           # cancelled at the end of its window without filling


def _describe(req: OrderRequest) -> dict:
    d = asdict(req)
    d["expiry"] = req.expiry.isoformat()
    d["prices_as_of"] = req.prices_as_of.isoformat()
    d["signal_as_of"] = req.signal_as_of.isoformat() if req.signal_as_of else None
    d["leg_expiries"] = [e.isoformat() for e in req.leg_expiries]
    return d


class Bot:
    def __init__(self, broker: Broker, limits: Callable[[], Limits], audit: Audit,
                 clock: Callable[[], datetime] = lambda: datetime.now(timezone.utc),
                 on_change: Callable[[Proposal], None] | None = None,
                 requote: Callable[[OrderRequest], OrderRequest] | None = None):
        """`on_change` is told of every change to an order (the runner saves it);
        `requote` refreshes an order's price just before it is sent after approval."""
        if broker.is_live:
            raise LiveTradingDisabled("Live trading is disabled. The bot only runs against a paper or pretend account.")
        self.broker, self._limits, self.audit, self.clock = broker, limits, audit, clock
        self.orders: dict[int, Proposal] = {}
        self._ids = count(1)
        self.killed = False
        self._kill_from_limits = False
        self.on_change, self.requote = on_change, requote
        self.reconciled = True
        self.realised_loss_today = 0.0

    # --- state ---
    def limits(self) -> Limits:
        lim = self._limits()
        return replace(lim, kill_switch=lim.kill_switch or self.killed)

    def book(self, exclude: int | None = None) -> Book:
        live = [p for p in self.orders.values() if p.status in ("sent", "filled") and p.id != exclude]
        return Book(
            realised_loss_today=self.realised_loss_today,
            open_max_losses=[p.max_loss or 0.0 for p in live],
            connected=self.broker.connected(),
            reconciled=self.reconciled,
        )

    def _changed(self, p: Proposal) -> None:
        if self.on_change:
            self.on_change(p)

    def adopt(self, p: Proposal) -> Proposal:
        """Take back an order from storage after a restart."""
        p.id = next(self._ids)
        self.orders[p.id] = p
        return p

    def _refuse(self, p: Proposal, refusals: list[Refusal], when: str) -> Proposal:
        p.status, p.refusals = "refused", refusals
        self._changed(p)
        self.audit("bot", "order_refused", {"order": p.id, "when": when, "refusals": [asdict(r) for r in refusals]})
        return p

    # --- orders ---
    def propose(self, req: OrderRequest, reason: str | None = None) -> Proposal:
        p = Proposal(next(self._ids), req, "proposed", max_loss(req), reason=reason)
        self.orders[p.id] = p
        self._changed(p)
        self.audit("bot", "order_proposed", {"order": p.id, "request": _describe(req), "max_loss": p.max_loss})
        lim = self.limits()
        refusals = check(req, lim, self.book(), self.clock())
        if refusals:
            return self._refuse(p, refusals, "proposed")
        if lim.approval_mode == "automatic":
            return self._send(p, approved_by="automatic")
        return p  # waits for Ben

    def approve(self, order_id: int, recorded: bool = False) -> Proposal:
        """Ben approved. `recorded`: the approval is already in the audit log (made in the app)."""
        p = self.orders[order_id]
        if p.status != "proposed":
            raise ValueError(f"Order {order_id} is {p.status}, not waiting for approval")
        if self.requote:
            # A fresh price first: the one it was proposed at is likely old by now.
            p.request = self.requote(p.request)
            p.max_loss = max_loss(p.request)
            self.audit("bot", "order_requoted", {"order": p.id, "limit_price": p.request.limit_price, "max_loss": p.max_loss})
        # Checked again: prices may have gone stale, or the day's losses grown, since it was proposed.
        refusals = check(p.request, self.limits(), self.book(), self.clock())
        if refusals:
            return self._refuse(p, refusals, "approval")
        if not recorded:
            self.audit("ben", "order_approved", {"order": p.id})
        return self._send(p, approved_by="ben")

    def reject(self, order_id: int, recorded: bool = False) -> Proposal:
        p = self.orders[order_id]
        if p.status != "proposed":
            raise ValueError(f"Order {order_id} is {p.status}, not waiting for approval")
        p.status = "rejected"
        if not recorded:
            self.audit("ben", "order_rejected", {"order": p.id})
        self._changed(p)
        return p

    def _send(self, p: Proposal, approved_by: str) -> Proposal:
        try:
            p.broker_id = self.broker.place(p.request)
        except Exception as e:  # noqa: BLE001 - any broker failure stops this order and is recorded
            p.status = "failed"
            self._changed(p)
            self.audit("bot", "order_failed", {"order": p.id, "error": str(e)})
            return p
        p.status = "sent"
        if p.work is None and p.request.limit_price is not None:
            p.work = working.plan(p.request.limit_price, p.request.price_kind, p.request.legs, self.clock())
        self._changed(p)
        self.audit("bot", "order_sent", {"order": p.id, "broker_id": p.broker_id, "approved_by": approved_by,
                                         **({"worst_price": p.work.worst, "until": p.work.until.isoformat()} if p.work else {})})
        return p

    def work(self) -> list[tuple[Proposal, str]]:
        """Each cycle: move each working opening order's price a step towards its worst price, every rail
        checked again at the new price; cancel it unfilled at the end of its window (working.py)."""
        out: list[tuple[Proposal, str]] = []
        now = self.clock()
        for p in [p for p in self.orders.values() if p.status == "sent" and p.work is not None]:
            if working.expired(p.work, now):
                try:
                    self.broker.cancel(p.broker_id)
                except Exception as e:  # noqa: BLE001 - recorded; the broker cancels a day order at the close anyway
                    self.audit("bot", "cancel_failed", {"order": p.id, "error": str(e)})
                    continue
                p.status, p.unfilled = "cancelled", True
                self._changed(p)
                self.audit("bot", "order_unfilled", {"order": p.id, "last_price": p.request.limit_price, "worst_price": p.work.worst})
                out.append((p, "unfilled"))
                continue
            fresh = None
            if self.requote:
                try:
                    # The pretend broker answers with the price it's given, so it's given the starting midpoint.
                    fresh = self.requote(replace(p.request, limit_price=p.work.start))
                except Exception:  # noqa: BLE001 - no quote this cycle: keep stepping from the starting midpoint
                    fresh = None
            mid_now = fresh.limit_price if fresh is not None and fresh.price_kind == p.request.price_kind else None
            target = working.price_now(p.work, p.request.price_kind, now, mid_now)
            if target == p.request.limit_price:
                continue
            new = replace(p.request, limit_price=target, prices_as_of=fresh.prices_as_of if fresh is not None else p.request.prices_as_of)
            refusals = check(new, self.limits(), self.book(exclude=p.id), now)
            if refusals:
                if not p.work_held:
                    p.work_held = True
                    self.audit("bot", "reprice_refused", {"order": p.id, "price": target, "refusals": [asdict(r) for r in refusals]})
                continue
            try:
                self.broker.modify(p.broker_id, new)
            except Exception as e:  # noqa: BLE001 - the order keeps its old price
                self.audit("bot", "reprice_failed", {"order": p.id, "price": target, "error": str(e)})
                continue
            p.request, p.max_loss, p.work_held = new, max_loss(new), False
            self._changed(p)
            self.audit("bot", "order_repriced", {"order": p.id, "price": target, "worst_price": p.work.worst})
            out.append((p, "repriced"))
        return out

    def record_fill(self, order_id: int, price: float) -> None:
        p = self.orders[order_id]
        p.status, p.fill_price = "filled", price
        self._changed(p)
        self.audit("bot", "order_filled", {"order": p.id, "price": price})

    def record_close(self, order_id: int, pnl: float) -> None:
        """A position closed (or expired) with this profit or loss in dollars."""
        p = self.orders[order_id]
        p.status, p.pnl = "closed", pnl
        if pnl < 0:
            self.realised_loss_today += -pnl
        self._changed(p)
        self.audit("bot", "position_closed", {"order": p.id, "pnl": pnl, "realised_loss_today": self.realised_loss_today})

    def close(self, order_id: int, price: float, by: str = "ben", why: str | None = None) -> Proposal:
        """Send a close for a filled position: one limit order at `price` per share (the same credit/debit sense as when it opened).

        The position stays open (status 'filled') until the broker fills the close; `close_filled`
        then books the profit or loss at the actual fill price. Closing only reduces risk, so it
        isn't held for approval and isn't stopped by the kill switch; it still needs a connected
        broker and is recorded.
        """
        p = self.orders[order_id]
        if p.status != "filled":
            raise ValueError(f"Order {order_id} is {p.status}, not an open position")
        if p.close_id:
            raise ValueError(f"Order {order_id} is already being closed (at ${p.close_price:.2f}); wait for it to fill or expire")
        if not self.broker.connected():
            raise ConnectionError("The broker is disconnected: can't close until it reconnects.")
        p.close_id = self.broker.close(p.broker_id, price)
        p.close_price, p.close_why = price, why or ("by you" if by == "ben" else "by the bot")
        self._changed(p)
        self.audit(by, "close_sent", {"order": p.id, "price": price, "close_id": p.close_id, "why": p.close_why})
        return p

    def pnl_at(self, p: Proposal, price: float) -> float:
        """Dollars made closing `p` at `price` per share."""
        opened = p.fill_price if p.fill_price is not None else p.request.limit_price
        per_share = (opened - price) if p.request.price_kind == "credit" else (price - opened)
        return round(per_share * 100 * p.request.quantity, 2)

    def close_filled(self, order_id: int, price: float) -> Proposal:
        """The broker filled the close at `price`: the position is closed with its real profit or loss."""
        p = self.orders[order_id]
        self.audit("bot", "close_filled", {"order": p.id, "price": price, "close_id": p.close_id})
        p.close_price = price
        self.record_close(p.id, self.pnl_at(p, price))
        return p

    def close_cancelled(self, order_id: int) -> Proposal:
        """The close was cancelled unfilled (the day ended, or the broker refused it): the position is still open."""
        p = self.orders[order_id]
        self.audit("bot", "close_cancelled", {"order": p.id, "close_id": p.close_id, "price": p.close_price})
        p.close_id = p.close_price = None
        self._changed(p)
        return p

    def new_day(self) -> None:
        self.realised_loss_today = 0.0
        self.audit("bot", "new_day", {})

    # --- the kill switch ---
    def kill(self, by: str = "ben", action: str = "kill_switch") -> dict:
        """Cancel every working order, drop every waiting proposal, block new orders. Recorded."""
        self.killed = True
        cancelled = []
        for o in self.broker.open_orders():
            self.broker.cancel(o.broker_id)
            cancelled.append(o.broker_id)
        for p in self.orders.values():
            if p.status == "proposed" or (p.status == "sent" and p.broker_id in cancelled):
                p.status = "cancelled"
                self._changed(p)
        out = {"cancelled_at_broker": cancelled, "proposals_dropped": sum(1 for p in self.orders.values() if p.status == "cancelled")}
        self.audit(by, action, out)
        return out

    def watch(self) -> None:
        """Run each cycle: acts on a kill switch set elsewhere (the app), and stops trading on a disconnect."""
        on = self._limits().kill_switch
        if on and not self.killed:
            self._kill_from_limits = True
            self.kill(by="bot", action="kill_switch_acted")
        elif not on and self.killed and self._kill_from_limits:
            # Ben turned trading back on in the app (that change is audited by the database).
            self.killed = self._kill_from_limits = False
            self.audit("bot", "trading_resumed", {})
        if not self.broker.connected() and self.reconciled:
            self.reconciled = False
            self.audit("bot", "broker_disconnected", {})

    def reconcile(self) -> list[str]:
        """After a reconnect: compare the broker's orders and positions with ours before anything else. Trading resumes only if they match."""
        if not self.broker.connected():
            return ["The broker is still disconnected."]
        ours = {p.broker_id: p for p in self.orders.values() if p.broker_id}
        closes = {p.close_id for p in self.orders.values() if p.close_id}
        problems: list[str] = []
        for o in self.broker.open_orders() + self.broker.positions():
            p = ours.get(o.broker_id)
            if p is None:
                if o.broker_id not in closes:
                    problems.append(f"The broker has {o.status} order {o.broker_id} that the bot didn't send.")
            elif o.status == "filled" and p.status == "sent":
                p.status, p.fill_price = "filled", o.fill_price  # filled while we were away: take the broker's word
                self._changed(p)
        known = {o.broker_id for o in self.broker.open_orders() + self.broker.positions()}
        for bid, p in ours.items():
            if p.status == "filled" and p.close_id and bid not in known:
                # Its close filled while we were away: the position is gone. A limit order fills at its price or better,
                # so booking it at the limit is the worst case.
                self.audit("bot", "closed_while_away", {"order": p.id, "close_id": p.close_id, "price": p.close_price})
                self.record_close(p.id, self.pnl_at(p, p.close_price))
            elif p.status in ("sent", "filled") and bid not in known:
                problems.append(f"Order {p.id} ({bid}) is {p.status} here but unknown at the broker.")
        self.reconciled = not problems
        self.audit("bot", "reconciled" if not problems else "reconcile_mismatch", {"problems": problems})
        return problems
