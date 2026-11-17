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
   chart is priced and proposed (it then waits for his approval like any
   other); a close request closes a filled position at the current price.
5. Records fills from the broker.

Every order the bot makes or changes is written to paper_orders, and every
step to the audit log. On start it takes back its open orders from the
database and reconciles them with the broker before doing anything else.

Only the pretend broker exists so far (Interactive Brokers comes later), so
every price here is made up and nothing reaches a market. Needs SUPABASE_URL
and SUPABASE_SECRET_KEY, like the loaders.
"""

from __future__ import annotations

import argparse
import sys
import time
from dataclasses import asdict
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

QUOTE_EVERY = timedelta(minutes=30)

from stockwizard.bot import Bot, Proposal
from stockwizard.broker import BrokerOrder, PretendBroker
from stockwizard.data.store import SupabaseStore
from stockwizard.pricing import historical_vol, limit_price, net_value, years_left
from stockwizard.rails import Leg, Limits, OrderRequest, request_from_dict, request_to_dict

NY = ZoneInfo("America/New_York")
OPEN_STATUSES = ("proposed", "approved", "sent", "filled")


def find_owner(store: SupabaseStore) -> str:
    """The one person the bot works for: whoever has saved limits or chart tabs."""
    owners = {r["owner"] for r in store.select("safety_limits", {"select": "owner"})}
    owners |= {r["owner"] for r in store.select("workspaces", {"select": "owner"})}
    if len(owners) != 1:
        raise SystemExit(f"Expected one person using Stock Wizard, found {len(owners)}: pass --owner")
    return owners.pop()


class BotRunner:
    def __init__(self, store, owner: str, clock=lambda: datetime.now(timezone.utc), broker=None, market=None):
        self.store, self.owner, self.clock = store, owner, clock
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
            p = Proposal(0, request_from_dict(r), "proposed" if r["status"] == "approved" else r["status"],
                         None if r.get("max_loss") is None else float(r["max_loss"]), broker_id=r.get("broker_id"), reason=r.get("reason"))
            self.bot.adopt(p)
            self.db_ids[p.id] = r["id"]
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
               "reason": p.reason, "broker_id": p.broker_id, "fill_price": p.fill_price, "pnl": p.pnl}
        if p.id in self.db_ids:
            self.store.update("paper_orders", {"id": f"eq.{self.db_ids[p.id]}"}, row)
        else:
            self.db_ids[p.id] = self.store.insert("paper_orders", [{**row, "owner": self.owner}], returning=True)[0]["id"]

    # --- prices (theoretical until Interactive Brokers supplies quotes) ---
    def market(self, symbol: str) -> tuple[float, str, float, str]:
        """(price, when, volatility, where the volatility came from) from the latest stored candles."""
        latest = None
        for tf in ("5m", "1d"):
            rows = self.store.select("candles", {"select": "ts,close", "symbol": f"eq.{symbol}", "timeframe": f"eq.{tf}", "order": "ts.desc", "limit": "1"})
            if rows and (latest is None or rows[0]["ts"] > latest["ts"]):
                latest = rows[0]
        if latest is None:
            raise ValueError(f"No candles for {symbol}")
        if symbol == "SPY":
            vix = self.store.select("candles", {"select": "close", "symbol": "eq.^VIX", "timeframe": "eq.1d", "order": "ts.desc", "limit": "1"})
            if vix:
                return float(latest["close"]), latest["ts"], float(vix[0]["close"]) / 100, "the VIX"
        daily = self.store.select("candles", {"select": "close", "symbol": f"eq.{symbol}", "timeframe": "eq.1d", "order": "ts.desc", "limit": "21"})
        hv = historical_vol([float(r["close"]) for r in reversed(daily)])
        return float(latest["close"]), latest["ts"], hv or 0.2, "the last 20 days' moves" if hv else "a default 20%"

    def requests(self) -> list[str]:
        said: list[str] = []
        waiting = self.store.select("bot_requests", {"select": "*", "owner": f"eq.{self.owner}", "status": "eq.waiting", "order": "id"})
        for q in waiting:
            try:
                result = self._open(q) if q["kind"] == "open" else self._close(q)
                status = "done"
            except Exception as e:  # noqa: BLE001 - a bad request is marked failed with the reason, never retried blindly
                result, status = f"Couldn't: {e}", "failed"
            self.store.update("bot_requests", {"id": f"eq.{q['id']}"}, {"status": status, "result": result, "done_at": self.clock().isoformat()})
            said.append(f"Request {q['id']} ({q['kind']}): {result}")
        return said

    def _open(self, q: dict) -> str:
        rows = self.store.select("option_positions", {"select": "*", "id": f"eq.{q['position_id']}", "owner": f"eq.{self.owner}"})
        if not rows:
            raise ValueError("that structure has been deleted")
        pos = rows[0]
        legs = tuple(Leg(l["right"], l["side"], float(l["strike"]), int(l.get("qty", 1))) for l in pos["legs"])
        expiry = datetime.fromisoformat(str(pos["expiry"])[:10]).date()
        spot, when, vol, source = self.market(pos["symbol"])
        price, kind = limit_price(legs, spot, years_left(expiry, self.clock()), vol)
        req = OrderRequest(symbol=pos["symbol"], structure=pos["structure"], expiry=expiry, legs=legs, quantity=int(q["quantity"]),
                           limit_price=round(price, 2), price_kind=kind, prices_as_of=self.clock())
        p = self.bot.propose(req, reason=(f"From your {pos['structure'].replace('_', ' ')} on the chart. Theoretical {kind} of ${price:.2f} "
                                          f"(Black-Scholes from {pos['symbol']} {spot:.2f} at {when[:16]} UTC, volatility {vol * 100:.0f}% from {source}); "
                                          f"the pretend broker treats it as a quote."))
        if p.status == "refused":
            return f"order {self.db_ids[p.id]} refused: " + "; ".join(r.why for r in p.refusals)
        return f"order {self.db_ids[p.id]} {'sent (automatic mode)' if p.status in ('sent', 'filled') else 'waiting for your approval'}"

    def _close(self, q: dict) -> str:
        by_db = {db: bid for bid, db in self.db_ids.items()}
        bid = by_db.get(q["order_id"])
        if bid is None or self.bot.orders[bid].status != "filled":
            raise ValueError(f"order {q['order_id']} isn't an open position")
        p = self.bot.orders[bid]
        spot, when, vol, source = self.market(p.request.symbol)
        v = net_value(p.request.legs, spot, years_left(p.request.expiry, self.clock()), vol)
        price = round(round(abs(v) / 0.05) * 0.05, 2)
        self.bot.close(bid, price)
        return f"order {q['order_id']} closed at a theoretical ${price:.2f} for ${p.pnl:+,.2f}"

    # --- recording real quotes (our own option-price history) ---
    def record_quotes(self) -> list[str]:
        """Every 30 minutes through the US session, when the broker can give real quotes (Interactive Brokers only)."""
        if not hasattr(self.broker, "chain_snapshot") or not self.broker.connected():
            return []
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
        if self.strategies is not None:
            said += self.strategies.manage(self.clock())
            said += self.strategies.settle(self.clock())
        return said

    # --- practice ---
    def practice(self) -> Proposal:
        """A made-up iron condor on SPY with $1 wings, proposed so Ben can try approving one. The price is made up."""
        rows = self.store.select("candles", {"select": "close", "symbol": "eq.SPY", "timeframe": "eq.1d", "order": "ts.desc", "limit": "1"})
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
    broker = None
    if a.broker == "ibkr":
        from stockwizard.broker.ibkr import IBKRBroker  # noqa: PLC0415 - needs ib_async, only on the PC
        broker = IBKRBroker(port=a.port, delayed=a.delayed)
        print(f"Connected to Interactive Brokers, paper account {broker.account}.")
    from stockwizard.strategy_runner import IBKRMarket, PretendMarket  # noqa: PLC0415
    market = IBKRMarket(broker, store) if broker is not None else PretendMarket(store)
    runner = BotRunner(store, a.owner or find_owner(store), broker=broker, market=market)
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
            print("IB Gateway disconnected: trading stopped. Waiting for it to come back...")


if __name__ == "__main__":
    sys.exit(main())
