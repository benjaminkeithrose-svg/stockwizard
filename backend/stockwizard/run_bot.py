"""Runs the paper bot against Supabase: Ben's limits in, proposals out, his decisions acted on.

    python -m stockwizard.run_bot                 # one cycle with the pretend broker
    python -m stockwizard.run_bot --practice      # also propose one made-up practice order
    python -m stockwizard.run_bot --loop 30       # a cycle every 30 seconds until stopped
    python -m stockwizard.run_bot --broker ibkr --loop 30   # on Ben's PC, with IB Gateway (paper) running

Each cycle:
1. Reads safety_limits (the defaults while Ben hasn't saved any: the daily
   limit empty, so every order is refused).
2. Acts on the kill switch: cancels working orders at the broker; resumes when
   Ben turns trading back on.
3. Acts on Ben's decisions in paper_orders: an approval gets a fresh quote and
   every rail checked again before it is sent; a rejection is closed.
4. Acts on Ben's requests from the app (bot_requests): a structure from the
   chart is priced and proposed (in approval mode it then waits for him); a
   close request sends a close for a filled position. With Interactive
   Brokers both are priced from the legs' real bid/ask midpoints; with the
   pretend broker, from Black-Scholes (made up).
5. Records fills from the broker, opening orders and closes alike. A position
   stays open until its close fills; its profit or loss is booked at the
   close's actual fill price. A close cancelled unfilled leaves it open.

Every order the bot makes or changes is written to paper_orders, and every
step to the audit log. On start it takes back its open orders (and any close
still working) from the database and reconciles them with the broker before
doing anything else. Needs SUPABASE_URL and SUPABASE_SECRET_KEY, like the loaders.
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from dataclasses import asdict
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pandas as pd

QUOTE_EVERY = timedelta(minutes=30)

from stockwizard.bot import Bot, Proposal
from stockwizard.broker import BrokerOrder, PretendBroker
from stockwizard.data.base import select_preferred
from stockwizard.data.store import SupabaseStore
from stockwizard.pricing import historical_vol, limit_price, net_value, years_left
from stockwizard.notify import Notifier, limit_message, message
from stockwizard.zerodte import calendar
from stockwizard.rails import Leg, Limits, OrderRequest, request_from_dict, request_to_dict

NY = ZoneInfo("America/New_York")
OPEN_STATUSES = ("proposed", "approved", "sent", "filled")


def find_owner(store: SupabaseStore) -> str:
    """The person the bot works for: its bot account's (a bot key), or on Ben's PC whoever has saved limits or chart tabs."""
    bot = getattr(store, "bot", None)
    if bot is not None:
        rows = store.select("bot_accounts", {"select": "owner", "bot_user": f"eq.{bot.user_id}"})
        if not rows:
            raise SystemExit("This access key isn't linked to anyone any more: make a new one in the app (Menu, then Access key)")
        return rows[0]["owner"]
    if os.environ.get("STOCKWIZARD_OWNER"):   # Ben's PC: his user id, now that others have accounts too
        return os.environ["STOCKWIZARD_OWNER"]
    owners = {r["owner"] for r in store.select("safety_limits", {"select": "owner"})}
    owners |= {r["owner"] for r in store.select("workspaces", {"select": "owner"})}
    if len(owners) != 1:
        raise SystemExit(f"Found {len(owners)} people using Stock Wizard: add STOCKWIZARD_OWNER=<your user id> to stockwizard.env (or pass --owner)")
    return owners.pop()


def joint_owner(store, owner: str) -> dict | None:
    """The account this person is a partner on (Ben, 19 Nov 2026: joint accounts), or None: then their PC doesn't trade."""
    rows = store.select("trading_partners", {"select": "owner,owner_email", "partner": f"eq.{owner}"})
    return rows[0] if rows else None


SYDNEY = ZoneInfo("Australia/Sydney")
OPEN_AFTER = (9, 35)    # New York: five minutes into the session, once option quotes have settled
CLOSE_AT = (16, 0)


def clock_time(d: datetime) -> str:
    return f"{d.hour % 12 or 12}:{d.minute:02d} {'am' if d.hour < 12 else 'pm'}"


def day_name(d: datetime) -> str:
    return f"{d:%a} {d.day} {d:%b}"


def next_open(now: datetime) -> datetime | None:
    """None while the session is on (from 9:35 to 16:00 New York on a trading day); otherwise when the next one starts."""
    ny = now.astimezone(NY)
    t = (ny.hour, ny.minute)
    if calendar.is_trading_day(ny.date()) and OPEN_AFTER <= t < CLOSE_AT:
        return None
    day = ny.date() if calendar.is_trading_day(ny.date()) and t < OPEN_AFTER else calendar.trading_day_ahead(ny.date(), 1)
    return datetime(day.year, day.month, day.day, *OPEN_AFTER, tzinfo=NY)


class BotRunner:
    def __init__(self, store, owner: str, clock=lambda: datetime.now(timezone.utc), broker=None, market=None, notifier: Notifier | None = None):
        self.store, self.owner, self.clock = store, owner, clock
        self.notifier = notifier
        self.last_status: dict[int, str] = {}     # paper_orders.id → the status Ben last heard about (or started with)
        self.changed: dict[int, Proposal] = {}    # orders changed this cycle, told once at its end
        self.close_why: dict[int, str] = {}       # the bot's order number → why it was closed
        self.db_ids: dict[int, int] = {}   # the bot's order number → paper_orders.id
        self.strategy_of: dict[int, dict] = {}   # the bot's order number → the bot_strategies row that proposed it
        rows = store.select("paper_orders", {"select": "*", "owner": f"eq.{owner}", "status": f"in.({','.join(OPEN_STATUSES)})", "order": "id"})
        remembered = [BrokerOrder(r["broker_id"], request_from_dict(r), "working" if r["status"] == "sent" else "filled", r.get("fill_price"))
                      for r in rows if r.get("broker_id") and r["status"] in ("sent", "filled")]
        self.broker = broker or PretendBroker(clock=clock)
        self.last_quotes: datetime | None = None
        self.broker.remember(remembered)
        self.bot = Bot(self.broker, self.limits, self.audit, clock=clock, on_change=self.save, requote=self.broker.quote)
        for r in rows:
            num = lambda v: None if v is None else float(v)  # noqa: E731
            p = Proposal(0, request_from_dict(r), "proposed" if r["status"] == "approved" else r["status"],
                         num(r.get("max_loss")), broker_id=r.get("broker_id"), reason=r.get("reason"),
                         fill_price=num(r.get("fill_price")), close_id=r.get("close_broker_id"),
                         close_price=num(r.get("close_price")), close_why=r.get("close_reason"))
            if p.close_id:
                self.broker.remember_close(p.close_id, p.broker_id, p.close_price)
            self.bot.adopt(p)
            self.db_ids[p.id] = r["id"]
            self.last_status[r["id"]] = r["status"]
            if r.get("strategy_id"):
                st = store.select("bot_strategies", {"select": "*", "id": f"eq.{r['strategy_id']}"})
                if st:
                    self.strategy_of[p.id] = st[0]
        self.bot.realised_loss_today = self.losses_today()
        from stockwizard.strategy_runner import StrategyRunner  # noqa: PLC0415
        self.strategies = StrategyRunner(self, market) if market is not None else None
        # Back from a restart: check against the broker before anything else.
        self.bot.reconciled = False
        self.bot.reconcile()

    # --- what the bot reads and writes ---
    def limits(self) -> Limits:
        rows = self.store.select("safety_limits", {"select": "*", "owner": f"eq.{self.owner}"})
        return Limits.from_row(rows[0]) if rows else Limits()

    def losses_today(self) -> float:
        today = self.clock().astimezone(NY).date()
        start = datetime.combine(today, datetime.min.time(), NY).astimezone(timezone.utc)
        rows = self.store.select("paper_orders", {"select": "pnl", "owner": f"eq.{self.owner}", "status": "eq.closed",
                                                  "updated_at": f"gte.{start.isoformat()}"})
        return sum(-float(r["pnl"]) for r in rows if r.get("pnl") is not None and float(r["pnl"]) < 0)

    def audit(self, actor: str, action: str, detail: dict) -> None:
        if "order" in detail and detail["order"] in self.db_ids:
            detail = {**detail, "order": self.db_ids[detail["order"]]}
        self.store.insert("audit_log", [{"actor": actor, "user_id": self.owner, "action": action, "detail": detail}])

    def save(self, p: Proposal) -> None:
        req = request_to_dict(p.request)
        row = {**req, "max_loss": p.max_loss, "status": p.status, "refusals": [asdict(r) for r in p.refusals],
               "reason": p.reason, "broker_id": p.broker_id, "fill_price": p.fill_price, "pnl": p.pnl,
               "close_broker_id": p.close_id, "close_price": p.close_price, "close_reason": p.close_why}
        if p.id in self.db_ids:
            self.store.update("paper_orders", {"id": f"eq.{self.db_ids[p.id]}"}, row)
        else:
            self.db_ids[p.id] = self.store.insert("paper_orders", [{**row, "owner": self.owner}], returning=True)[0]["id"]
        self.changed[self.db_ids[p.id]] = p

    # --- phone notifications: each order's state at the end of the cycle, once ---
    def notify(self, lost_before: float) -> list[str]:
        if self.notifier is None:
            self.changed.clear()
            return []
        out = []
        bids = {db: bid for bid, db in self.db_ids.items()}
        for db, p in self.changed.items():
            if self.last_status.get(db) == p.status:
                continue
            self.last_status[db] = p.status
            m = message(p.status, p, self.close_why.get(bids.get(db)))
            if m:
                out.append(self.notifier.send(*m))
        self.changed.clear()
        lim = self.limits().max_loss_per_day
        lost = self.bot.realised_loss_today
        if lim and lost_before < lim <= lost:
            out.append(self.notifier.send(*limit_message(lost, lim)))
        return [x for x in out if x]

    # --- prices (theoretical until Interactive Brokers supplies quotes) ---
    def market(self, symbol: str) -> tuple[float, str, float, str]:
        """(price, when, volatility, where the volatility came from) from the latest stored candles."""
        latest = None
        for tf in ("5m", "1d"):
            rows = select_preferred(self.store, "candles", {"select": "ts,close", "symbol": f"eq.{symbol}", "timeframe": f"eq.{tf}", "order": "ts.desc", "limit": "1"})
            if rows and (latest is None or pd.Timestamp(rows[0]["ts"]) > pd.Timestamp(latest["ts"])):
                latest = rows[0]
        if latest is None:
            raise ValueError(f"No candles for {symbol}")
        if symbol == "SPY":
            vix = select_preferred(self.store, "candles", {"select": "close", "symbol": "eq.^VIX", "timeframe": "eq.1d", "order": "ts.desc", "limit": "1"})
            if vix:
                return float(latest["close"]), latest["ts"], float(vix[0]["close"]) / 100, "the VIX"
        daily = select_preferred(self.store, "candles", {"select": "close", "symbol": f"eq.{symbol}", "timeframe": "eq.1d", "order": "ts.desc", "limit": "21"})
        hv = historical_vol([float(r["close"]) for r in reversed(daily)])
        return float(latest["close"]), latest["ts"], hv or 0.2, "the last 20 days' moves" if hv else "a default 20%"

    def requests(self) -> list[str]:
        said: list[str] = []
        waiting = self.store.select("bot_requests", {"select": "*", "owner": f"eq.{self.owner}", "status": "eq.waiting", "order": "id"})
        opens_at = None if not self.broker.real_quotes else next_open(self.clock())
        for q in waiting:
            if opens_at is not None:
                # Real prices need the market open (Ben, 19 Nov 2026): a request sent while it's shut waits for
                # the next session, a few minutes in, instead of failing; one whose structure expires first fails.
                said += self._hold(q, opens_at)
                continue
            try:
                result = self._open(q) if q["kind"] == "open" else self._close(q)
                status = "done"
            except Exception as e:  # noqa: BLE001 - a bad request is marked failed with the reason, never retried blindly
                result, status = f"Couldn't: {e}", "failed"
            self.store.update("bot_requests", {"id": f"eq.{q['id']}"}, {"status": status, "result": result, "done_at": self.clock().isoformat()})
            said.append(f"Request {q['id']} ({q['kind']}): {result}")
        return said

    def _hold(self, q: dict, opens_at: datetime) -> list[str]:
        ny_open = opens_at.astimezone(NY)
        if q["kind"] == "open":
            pos = self.store.select("option_positions", {"select": "expiry", "id": f"eq.{q['position_id']}"})
            if pos and datetime.fromisoformat(str(pos[0]["expiry"])[:10]).date() < ny_open.date():
                self.store.update("bot_requests", {"id": f"eq.{q['id']}"}, {"status": "failed", "done_at": self.clock().isoformat(),
                                  "result": "Couldn't: the structure expires before the market opens again."})
                return [f"Request {q['id']}: expires before the open"]
        sydney = opens_at.astimezone(SYDNEY)
        note = (f"Waiting for the market to open: sent at {clock_time(ny_open)} New York on {day_name(ny_open)} "
                f"({clock_time(sydney)} Sydney, {day_name(sydney)}), a few minutes after the open so prices have settled.")
        if q.get("result") != note:
            self.store.update("bot_requests", {"id": f"eq.{q['id']}"}, {"result": note})
            return [f"Request {q['id']}: {note}"]
        return []

    def _open(self, q: dict) -> str:
        # A joint account's partner orders from their own chart: their structures count as the account's.
        owners = [self.owner] + [r["partner"] for r in self.store.select("trading_partners", {"select": "partner", "owner": f"eq.{self.owner}"})]
        rows = self.store.select("option_positions", {"select": "*", "id": f"eq.{q['position_id']}", "owner": f"in.({','.join(owners)})"})
        if not rows:
            raise ValueError("that structure has been deleted")
        pos = rows[0]
        legs = tuple(Leg(l["right"], l["side"], float(l["strike"]), int(l.get("qty", 1))) for l in pos["legs"])
        expiry = datetime.fromisoformat(str(pos["expiry"])[:10]).date()
        name = pos["structure"].replace("_", " ")
        if self.broker.real_quotes:
            # The market's price: the legs' bid/ask midpoints. No quote (market shut, data not subscribed) fails the
            # request with the reason; a model price is never sent to a real market.
            req = self.broker.quote(OrderRequest(symbol=pos["symbol"], structure=pos["structure"], expiry=expiry, legs=legs,
                                                 quantity=int(q["quantity"]), limit_price=None, price_kind="debit", prices_as_of=self.clock()))
            reason = (f"From your {name} on the chart. {req.price_kind.title()} of ${req.limit_price:.2f} from the legs' bid/ask "
                      f"midpoints at {req.prices_as_of:%H:%M} UTC.")
        else:
            spot, when, vol, source = self.market(pos["symbol"])
            price, kind = limit_price(legs, spot, years_left(expiry, self.clock()), vol)
            req = OrderRequest(symbol=pos["symbol"], structure=pos["structure"], expiry=expiry, legs=legs, quantity=int(q["quantity"]),
                               limit_price=round(price, 2), price_kind=kind, prices_as_of=self.clock())
            reason = (f"From your {name} on the chart. Theoretical {kind} of ${price:.2f} "
                      f"(Black-Scholes from {pos['symbol']} {spot:.2f} at {when[:16]} UTC, volatility {vol * 100:.0f}% from {source}); "
                      f"the pretend broker treats it as a quote.")
        p = self.bot.propose(req, reason=reason)
        if p.status == "refused":
            return f"order {self.db_ids[p.id]} refused: " + "; ".join(r.why for r in p.refusals)
        return f"order {self.db_ids[p.id]} {'sent (automatic mode)' if p.status in ('sent', 'filled') else 'waiting for your approval'}"

    def _close(self, q: dict) -> str:
        by_db = {db: bid for bid, db in self.db_ids.items()}
        bid = by_db.get(q["order_id"])
        if bid is None or self.bot.orders[bid].status != "filled":
            raise ValueError(f"order {q['order_id']} isn't an open position")
        p = self.bot.orders[bid]
        if self.broker.real_quotes:
            price, how = self.broker.close_quote(p.request), "from the legs' bid/ask midpoints"
        else:
            spot, when, vol, source = self.market(p.request.symbol)
            v = net_value(p.request.legs, spot, years_left(p.request.expiry, self.clock()), vol)
            price, how = round(round(abs(v) / 0.05) * 0.05, 2), "at a theoretical price"
        self.close_why[bid] = "by you"
        self.bot.close(bid, price, why="by you")
        return f"order {q['order_id']}: close sent at ${price:.2f} {how}; the result is booked when it fills"

    def check_closes(self) -> list[str]:
        """Closes working at the broker: a fill books the real result; a cancellation leaves the position open."""
        said = []
        for p in [p for p in self.bot.orders.values() if p.status == "filled" and p.close_id]:
            o = self.broker.status(p.close_id)
            if o is None:
                continue
            if o.status == "filled":
                self.close_why[p.id] = p.close_why or self.close_why.get(p.id) or "closed"
                self.bot.close_filled(p.id, o.fill_price)
                said.append(f"Order {self.db_ids[p.id]}: close filled at ${o.fill_price:.2f}, {p.pnl:+,.2f}")
            elif o.status == "cancelled":
                price = p.close_price
                self.bot.close_cancelled(p.id)
                said.append(f"Order {self.db_ids[p.id]}: the close at ${price:.2f} wasn't filled and was cancelled; the position is still open")
        return said

    # --- recording real quotes (our own option-price history) ---
    def record_quotes(self) -> list[str]:
        """Every 30 minutes through the US session, when the broker can give real quotes (Interactive Brokers only)."""
        if not hasattr(self.broker, "chain_snapshot") or not self.broker.connected() or not getattr(self.store, "is_service", True):
            return []   # shared data: recorded only by Ben's bot (the secret key), not by people's own bots
        now = self.clock()
        ny = now.astimezone(NY)
        if ny.weekday() >= 5 or not (ny.replace(hour=9, minute=30, second=0, microsecond=0) <= ny <= ny.replace(hour=16, minute=0, second=0, microsecond=0)):
            return []
        if self.last_quotes is not None and now - self.last_quotes < QUOTE_EVERY:
            return []
        self.last_quotes = now
        try:
            rows = self.broker.chain_snapshot("SPY")
        except Exception as e:  # noqa: BLE001 - quotes are a record, never a reason to stop trading
            return [f"Couldn't record quotes: {e}"]
        for i in range(0, len(rows), 500):
            self.store.insert("option_quotes", rows[i : i + 500])
        return [f"Recorded {len(rows)} SPY option quotes"]

    # --- one cycle ---
    def cycle(self) -> list[str]:
        said: list[str] = []
        lost_before = self.bot.realised_loss_today
        self.bot.watch()
        if not self.bot.reconciled and self.broker.connected():
            problems = self.bot.reconcile()
            said += problems
        by_db = {db: bid for bid, db in self.db_ids.items()}
        waiting = [bid for bid, p in self.bot.orders.items() if p.status == "proposed"]
        if waiting:
            ids = ",".join(str(self.db_ids[b]) for b in waiting)
            for r in self.store.select("paper_orders", {"select": "id,status", "id": f"in.({ids})"}):
                bid = by_db[r["id"]]
                if r["status"] == "approved":
                    p = self.bot.approve(bid, recorded=True)
                    said.append(f"Order {r['id']}: approved by Ben, then {p.status}" + (f" ({'; '.join(x.why for x in p.refusals)})" if p.refusals else ""))
                elif r["status"] == "rejected":
                    self.bot.reject(bid, recorded=True)
                    said.append(f"Order {r['id']}: rejected by Ben")
                elif r["status"] == "cancelled":
                    self.bot.orders[bid].status = "cancelled"   # the app's kill switch dropped it (already recorded)
                    said.append(f"Order {r['id']}: cancelled by the kill switch")
        said += self.requests()
        said += self.record_quotes()
        if self.strategies is not None:
            now = self.clock()
            try:
                if getattr(self.store, "is_service", True):   # the shared snapshot: Ben's bot only
                    said += self.strategies.snapshot(now)
            except Exception as e:  # noqa: BLE001 - the snapshot is a display, never a reason to stop trading
                said.append(f"Couldn't save the market snapshot: {e}")
            said += self.strategies.propose_due(now)
        if isinstance(self.broker, PretendBroker):
            self.broker.step()   # the pretend market: working orders fill straight away, at their limit price
        pretend = " (pretend)" if isinstance(self.broker, PretendBroker) else ""
        for p in [p for p in self.bot.orders.values() if p.status == "sent"]:
            o = self.broker.status(p.broker_id)
            if o is None:
                continue
            if o.status == "filled":
                self.bot.record_fill(p.id, o.fill_price)
                said.append(f"Order {self.db_ids[p.id]}: filled{pretend} at {o.fill_price}")
            elif o.status == "cancelled":
                p.status = "cancelled"
                self.save(p)
                self.audit("bot", "order_cancelled_at_broker", {"order": p.id, "broker_id": p.broker_id})
                said.append(f"Order {self.db_ids[p.id]}: cancelled at the broker (rejected, or the day ended unfilled)")
        said += self.check_closes()
        if self.strategies is not None:
            said += self.strategies.manage(self.clock())
            if isinstance(self.broker, PretendBroker):
                self.broker.step()   # the pretend market fills the closes just sent
            said += self.check_closes()
            said += self.strategies.settle(self.clock())
        said += self.notify(lost_before)
        return said

    # --- practice ---
    def practice(self) -> Proposal:
        """A made-up iron condor on SPY with $1 wings, proposed so Ben can try approving one. The price is made up."""
        rows = select_preferred(self.store, "candles", {"select": "close", "symbol": "eq.SPY", "timeframe": "eq.1d", "order": "ts.desc", "limit": "1"})
        price = round(float(rows[0]["close"])) if rows else 600
        expiry = self.clock().astimezone(NY).date() + timedelta(days=1)
        while expiry.weekday() >= 5:
            expiry += timedelta(days=1)
        legs = (Leg("P", "buy", price - 7), Leg("P", "sell", price - 6), Leg("C", "sell", price + 6), Leg("C", "buy", price + 7))
        req = OrderRequest(symbol="SPY", structure="iron_condor", expiry=expiry, legs=legs, quantity=1, limit_price=0.6,
                           price_kind="credit", prices_as_of=self.clock())
        return self.bot.propose(req, reason="Practice: a made-up price on the pretend broker. Nothing reaches a market.")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--owner", help="the person's user id (found automatically when there is one)")
    ap.add_argument("--practice", action="store_true", help="propose one made-up practice order")
    ap.add_argument("--loop", type=int, metavar="SECONDS", help="run a cycle every SECONDS until stopped")
    ap.add_argument("--broker", choices=["pretend", "ibkr"], default="pretend")
    ap.add_argument("--port", type=int, default=4002, help="IB Gateway's paper port (4002; TWS paper is 7497). Live ports are refused")
    ap.add_argument("--delayed", action="store_true", help="delayed market data (no subscription): quotes count as 15 minutes old")
    a = ap.parse_args(argv)
    store = SupabaseStore()
    owner = a.owner or find_owner(store)
    joint = joint_owner(store, owner)
    if joint:
        # Only one PC trades a joint account (one TWS login): the owner's. This one waits, and starts
        # trading again (through the supervisor's restart) if the joint account ends.
        print(f"Joint account: trading runs on {joint['owner_email']}'s PC. This PC shows and approves only.")
        while joint_owner(store, owner):
            if not a.loop:
                return 0
            time.sleep(60)
        print("The joint account has ended: restarting to trade your own account.")
        return 1
    broker = None
    if a.broker == "ibkr":
        from stockwizard.broker.ibkr import IBKRBroker  # noqa: PLC0415 - needs ib_async, only on the PC
        broker = IBKRBroker(port=a.port, delayed=a.delayed)
        print(f"Connected to Interactive Brokers, paper account {broker.account}.")
    from stockwizard.strategy_runner import IBKRMarket, PretendMarket  # noqa: PLC0415
    market = IBKRMarket(broker, store) if broker is not None else PretendMarket(store)
    runner = BotRunner(store, owner, broker=broker, market=market, notifier=Notifier.from_env())
    if a.practice:
        p = runner.practice()
        print(f"Practice order {runner.db_ids[p.id]}: {p.status}" + (f" ({'; '.join(r.why for r in p.refusals)})" if p.refusals else " — waiting for Ben"))
    while True:
        for line in runner.cycle():
            print(line)
        if not a.loop:
            return 0
        time.sleep(a.loop)
        if broker is not None and not broker.connected():
            # ib_async doesn't reconnect by itself. Exit, so start-bot.bat starts a fresh bot a minute later:
            # that connects again and reconciles orders and positions with IBKR before anything else.
            print("Interactive Brokers disconnected (TWS or IB Gateway closed or restarted): trading stopped. Restarting to reconnect.")
            return 1


if __name__ == "__main__":
    sys.exit(main())
