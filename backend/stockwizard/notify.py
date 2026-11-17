"""Phone notifications through ntfy (Ben, 18 Nov 2026): an order waiting for approval, filled, closed or stopped,
and the daily loss limit reached.

ntfy is a free notification app. Ben subscribes to a private topic name, and the bot posts to
https://ntfy.sh/<topic>. The topic name works like a password, so it is never in the repository: it comes from
the NTFY_TOPIC environment variable (pc/stockwizard.env on the PC, the NTFY_TOPIC secret in GitHub). With no
topic set, nothing is sent. What leaves: the message text below (symbol, structure, strikes, prices, profit or
loss). A failed notification is reported and never stops trading.
"""

from __future__ import annotations

import os
import urllib.request
from typing import Callable

SERVER = "https://ntfy.sh"


def _post(url: str, body: bytes, headers: dict) -> None:
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=10) as r:  # noqa: S310 - fixed https address
        r.read()


class Notifier:
    def __init__(self, topic: str, post: Callable[[str, bytes, dict], None] = _post):
        self.topic, self.post = topic, post

    @classmethod
    def from_env(cls) -> "Notifier | None":
        topic = os.environ.get("NTFY_TOPIC", "").strip()
        return cls(topic) if topic else None

    def send(self, title: str, body: str, priority: str = "default", tags: str = "") -> str | None:
        """Sends one notification. Returns a problem to report, or None."""
        headers = {"Title": title.encode("ascii", "replace").decode(), "Priority": priority}
        if tags:
            headers["Tags"] = tags
        try:
            self.post(f"{SERVER}/{self.topic}", body.encode("utf-8"), headers)
            return None
        except Exception as e:  # noqa: BLE001 - a notification never stops the bot
            return f"Couldn't send the phone notification ({title}): {e}"


def describe(p) -> str:
    """'XSP iron condor 590/595/605/610, expires 18 Nov'."""
    r = p.request
    strikes = "/".join(f"{l.strike:g}" for l in sorted(r.legs, key=lambda l: l.strike))
    qty = f"{r.quantity} × " if r.quantity != 1 else ""
    return f"{qty}{r.symbol} {r.structure.replace('_', ' ')} {strikes}, expires {r.expiry.day} {r.expiry.strftime('%b')}"


def message(status: str, p, why: str | None = None) -> tuple[str, str, str, str] | None:
    """(title, body, priority, tags) for an order that reached `status`, or None for statuses that don't notify."""
    what = describe(p)
    price = f"${p.request.limit_price:.2f} {p.request.price_kind}"
    if status == "proposed":
        risk = f", most it can lose ${p.max_loss:,.0f}" if p.max_loss is not None else ""
        return "Order waiting for you", f"{what} at {price}{risk}. Approve or reject in Safety and orders.", "high", "bell"
    if status == "filled":
        fill = f"${p.fill_price:.2f}" if p.fill_price is not None else price
        return "Order filled", f"{what} at {fill}.", "default", "white_check_mark"
    if status == "closed":
        pnl = p.pnl or 0.0
        money = f"{'+' if pnl >= 0 else '−'}${abs(pnl):,.2f}"
        stopped = why in ("stop", "short strike reached", "delta")
        title = f"Stopped out ({why})" if stopped else f"Closed{f' ({why})' if why else ''}"
        return f"{title}: {money}", what + ".", "high" if stopped else "default", "warning" if stopped else ("chart_with_upwards_trend" if pnl >= 0 else "chart_with_downwards_trend")
    return None


def limit_message(lost: float, limit: float) -> tuple[str, str, str, str]:
    return ("Daily loss limit reached",
            f"${lost:,.0f} lost today of the ${limit:,.0f} limit. Every new order is refused until tomorrow.", "urgent", "no_entry")
