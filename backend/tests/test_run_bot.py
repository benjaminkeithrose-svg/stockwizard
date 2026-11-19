"""The bot against a stand-in for Supabase: limits read, proposals written, Ben's decisions acted on.

The stand-in understands the few PostgREST filters the runner uses (eq., in.,
gte.). Made-up orders and the pretend broker only.
"""

from datetime import datetime, timedelta, timezone

from stockwizard.run_bot import BotRunner

OWNER = "00000000-0000-0000-0000-00000000000a"
NOW = datetime(2026, 11, 18, 15, 0, tzinfo=timezone.utc)


class FakeStore:
    def __init__(self):
        self.tables: dict[str, list[dict]] = {"paper_orders": [], "audit_log": [], "safety_limits": [], "candles": [], "workspaces": []}
        self.next_id = 1
        self.clock = None   # stamps like the database's now(); tests that move the clock set it

    @staticmethod
    def _match(row, query):
        for k, v in query.items():
            if k in ("select", "order", "limit", "offset"):
                continue
            op, _, arg = v.partition(".")
            val = row.get(k)
            if op == "eq" and (str(val).lower() if isinstance(val, bool) else str(val)) != arg:
                return False
            if op == "in" and str(val) not in arg.strip("()").split(","):
                return False
            if op == "gte" and not (val is not None and str(val) >= arg):
                return False
        return True

    def select(self, table, query):
        rows = [dict(r) for r in self.tables.setdefault(table, []) if self._match(r, query)]
        if "order" in query:
            col, _, way = query["order"].partition(".")
            rows.sort(key=lambda r: r.get(col), reverse=way == "desc")
        return rows[: int(query["limit"])] if "limit" in query else rows

    def insert(self, table, rows, returning=False):
        out = []
        for r in rows:
            r = {**r}
            now = (self.clock() if self.clock else NOW).isoformat()
            if table == "audit_log":
                r.setdefault("at", now)   # the database stamps every entry
            if table in ("paper_orders", "bot_requests"):
                r.setdefault("id", self.next_id)
                r["updated_at"] = now
                r.setdefault("created_at", now)
                self.next_id += 1
            self.tables.setdefault(table, []).append(r)
            out.append(dict(r))
        return out if returning else []

    def upsert(self, table, on_conflict, rows):
        t = self.tables.setdefault(table, [])
        for r in rows:
            t[:] = [x for x in t if x.get(on_conflict) != r[on_conflict]] + [dict(r)]
        return len(rows)

    def update(self, table, match, values):
        changed = []
        for r in self.tables[table]:
            if self._match(r, match):
                r.update(values)
                changed.append(dict(r))
        return changed

    # what the app does (decide_order / kill_switch in the database)
    def decide(self, order_id, approve):
        r = next(r for r in self.tables["paper_orders"] if r["id"] == order_id)
        assert r["status"] == "proposed"
        r["status"] = "approved" if approve else "rejected"

    def set_limits(self, **kw):
        if not self.tables["safety_limits"]:
            self.tables["safety_limits"].append({"owner": OWNER})
        self.tables["safety_limits"][0].update(kw)


LIMITS = dict(max_loss_per_trade=50, max_loss_per_day=100, max_open_positions=2, max_capital_at_risk=100, max_data_age_seconds=120,
              approval_mode="approval", kill_switch=False)


def runner(store, now=NOW):
    clock = {"t": now}
    r = BotRunner(store, OWNER, clock=lambda: clock["t"])
    return r, clock


def order(store, i=0):
    return store.tables["paper_orders"][i]


def actions(store):
    return [a["action"] for a in store.tables["audit_log"]]


def test_with_no_limits_saved_the_practice_order_is_refused_and_says_why():
    s = FakeStore()
    r, _ = runner(s)
    p = r.practice()
    assert p.status == "refused"
    o = order(s)
    assert o["status"] == "refused" and o["owner"] == OWNER
    assert any(x["rail"] == "per_day" for x in o["refusals"])
    assert o["max_loss"] == 40.0 and o["prices_as_of"]
    assert "order_refused" in actions(s)


def test_an_approval_in_the_app_is_requoted_checked_sent_and_filled():
    s = FakeStore()
    s.set_limits(**LIMITS)
    r, clock = runner(s)
    r.practice()
    assert order(s)["status"] == "proposed"
    assert r.cycle() == []                       # nothing decided yet: nothing happens
    assert not r.broker.calls
    s.decide(order(s)["id"], True)
    clock["t"] = NOW + timedelta(minutes=10)     # Ben approves ten minutes later: the bot re-quotes first
    said = r.cycle()
    assert order(s)["status"] == "filled" and order(s)["broker_id"].startswith("P-")
    assert any("approved by Ben, then sent" in x for x in said)
    assert "order_requoted" in actions(s) and "order_sent" in actions(s) and "order_filled" in actions(s)
    assert "order_approved" not in actions(s), "the app already recorded the approval"


def test_a_rejection_in_the_app_is_never_sent():
    s = FakeStore()
    s.set_limits(**LIMITS)
    r, _ = runner(s)
    r.practice()
    s.decide(order(s)["id"], False)
    r.cycle()
    assert order(s)["status"] == "rejected" and not r.broker.calls


def test_an_approval_the_rails_now_refuse_is_not_sent():
    s = FakeStore()
    s.set_limits(**LIMITS)
    r, _ = runner(s)
    r.practice()
    s.set_limits(max_loss_per_trade=30)          # Ben lowered the limit after it was proposed
    s.decide(order(s)["id"], True)
    r.cycle()
    assert order(s)["status"] == "refused" and not r.broker.calls
    assert any(x["rail"] == "per_trade" for x in order(s)["refusals"])


def test_the_kill_switch_in_the_app_cancels_at_the_broker_and_turning_it_off_resumes():
    s = FakeStore()
    s.set_limits(**{**LIMITS, "approval_mode": "automatic"})
    r, _ = runner(s)
    r.broker.step = lambda: []                   # the pretend market holds the order unfilled
    r.practice()
    assert order(s)["status"] == "sent"
    s.set_limits(kill_switch=True)
    r.cycle()
    assert order(s)["status"] == "cancelled" and r.broker.orders[order(s)["broker_id"]].status == "cancelled"
    assert "kill_switch_acted" in actions(s)
    assert r.practice().status == "refused"
    s.set_limits(kill_switch=False)
    r.cycle()
    assert "trading_resumed" in actions(s)
    assert r.practice().status == "sent"


def test_a_restart_takes_back_open_orders_and_counts_them():
    s = FakeStore()
    s.set_limits(**{**LIMITS, "approval_mode": "automatic", "max_open_positions": 1})
    r, _ = runner(s)
    r.practice()
    r.cycle()
    assert order(s)["status"] == "filled"
    r2, _ = runner(s)                            # the bot restarts
    assert r2.bot.reconciled, "the remembered order should match the broker"
    assert "reconciled" in actions(s)
    p = r2.practice()
    assert p.status == "refused" and any(x.rail == "positions" for x in p.refusals)


def test_a_restart_counts_todays_losses():
    s = FakeStore()
    s.set_limits(**LIMITS)
    s.tables["paper_orders"].append({"id": 99, "owner": OWNER, "status": "closed", "pnl": -100, "updated_at": NOW.isoformat()})
    r, _ = runner(s)
    assert r.bot.realised_loss_today == 100
    p = r.practice()
    assert any(x.rail == "per_day" for x in p.refusals)


def test_an_approval_waiting_through_a_restart_is_still_acted_on():
    s = FakeStore()
    s.set_limits(**LIMITS)
    r, _ = runner(s)
    r.practice()
    s.decide(order(s)["id"], True)
    r2, _ = runner(s)
    r2.cycle()
    assert order(s)["status"] == "filled"


POSITION = {"id": "pos-1", "owner": OWNER, "symbol": "SPY", "structure": "iron_condor", "expiry": "2026-11-27", "status": "planned",
            "legs": [{"right": "P", "side": "buy", "strike": 589, "qty": 1}, {"right": "P", "side": "sell", "strike": 590, "qty": 1},
                     {"right": "C", "side": "sell", "strike": 610, "qty": 1}, {"right": "C", "side": "buy", "strike": 611, "qty": 1}]}


def market(store, spy=600.0, vix=15.0):
    store.tables["candles"] += [
        {"symbol": "SPY", "timeframe": "1d", "ts": "2026-11-17T05:00:00+00:00", "close": spy},
        {"symbol": "^VIX", "timeframe": "1d", "ts": "2026-11-17T06:00:00+00:00", "close": vix},
    ]
    store.tables.setdefault("option_positions", []).append(dict(POSITION))


def request(store, **kw):
    store.tables.setdefault("bot_requests", []).append({"id": 500 + len(store.tables.get("bot_requests", [])), "owner": OWNER, "status": "waiting", **kw})
    return store.tables["bot_requests"][-1]


def test_a_structure_from_the_chart_is_priced_checked_and_waits_for_approval():
    s = FakeStore()
    s.set_limits(**{**LIMITS, "max_loss_per_trade": 100})
    market(s)
    q = request(s, kind="open", position_id="pos-1", quantity=1)
    r, _ = runner(s)
    said = r.cycle()
    assert q["status"] == "done" and "waiting for your approval" in q["result"], said
    o = order(s)
    assert o["status"] == "proposed" and o["price_kind"] == "credit" and o["symbol"] == "SPY"
    assert 0 < o["limit_price"] < 1 and o["max_loss"] <= 100
    assert "Theoretical" in o["reason"] and "the VIX" in o["reason"]
    assert not r.broker.calls, "nothing is sent before Ben approves"


def test_a_request_the_rails_refuse_says_why():
    s = FakeStore()
    s.set_limits(**{**LIMITS, "max_loss_per_trade": 10})
    market(s)
    q = request(s, kind="open", position_id="pos-1", quantity=1)
    r, _ = runner(s)
    r.cycle()
    assert q["status"] == "done" and "refused" in q["result"] and "limit per trade" in q["result"]


def test_a_joint_partners_structure_can_be_ordered_but_no_one_elses():
    s = FakeStore()
    s.set_limits(**{**LIMITS, "max_loss_per_trade": 100})
    market(s)
    mine = next(p for p in s.tables["option_positions"] if p["id"] == "pos-1")
    s.tables["option_positions"].append({**mine, "id": "partners", "owner": "partner-1"})
    s.tables["option_positions"].append({**mine, "id": "strangers", "owner": "stranger"})
    s.tables["trading_partners"] = [{"partner": "partner-1", "owner": OWNER, "owner_email": "owner@example.test"}]
    ok = request(s, kind="open", position_id="partners", quantity=1)
    no = request(s, kind="open", position_id="strangers", quantity=1)
    r, _ = runner(s)
    r.cycle()
    assert ok["status"] == "done" and "waiting for your approval" in ok["result"]
    assert no["status"] == "failed"


def test_a_partners_pc_does_not_trade(monkeypatch):
    s = FakeStore()
    s.tables["trading_partners"] = [{"partner": OWNER, "owner": "owner-1", "owner_email": "owner@example.test"}]
    from stockwizard import run_bot
    assert run_bot.joint_owner(s, OWNER)["owner_email"] == "owner@example.test"
    monkeypatch.setattr(run_bot, "SupabaseStore", lambda: s)
    monkeypatch.setattr(run_bot, "BotRunner", lambda *a, **k: (_ for _ in ()).throw(AssertionError("a partner's PC must not trade")))
    assert run_bot.main(["--owner", OWNER]) == 0


def test_a_request_for_a_deleted_structure_fails_plainly():
    s = FakeStore()
    s.set_limits(**LIMITS)
    q = request(s, kind="open", position_id="gone", quantity=1)
    r, _ = runner(s)
    r.cycle()
    assert q["status"] == "failed" and "deleted" in q["result"]


def test_closing_a_filled_position_counts_its_loss_today():
    s = FakeStore()
    s.set_limits(**{**LIMITS, "approval_mode": "automatic", "max_loss_per_trade": 100})
    market(s)
    request(s, kind="open", position_id="pos-1", quantity=1)
    r, _ = runner(s)
    r.cycle()
    o = order(s)
    assert o["status"] == "filled"
    s.tables["candles"].append({"symbol": "SPY", "timeframe": "1d", "ts": "2026-11-18T05:00:00+00:00", "close": 612.0})  # through the call side
    q = request(s, kind="close", order_id=o["id"], quantity=1)
    r.cycle()
    assert q["status"] == "done" and "close sent" in q["result"], q["result"]
    assert o["status"] == "closed" and o["pnl"] < 0          # the pretend market filled the close in the same cycle
    assert r.bot.realised_loss_today == -o["pnl"]
    assert "close_sent" in actions(s) and "position_closed" in actions(s)


def test_closing_something_that_isnt_open_fails():
    s = FakeStore()
    s.set_limits(**LIMITS)
    q = request(s, kind="close", order_id=12345, quantity=1)
    r, _ = runner(s)
    r.cycle()
    assert q["status"] == "failed"


class QuotingBroker:
    """The pretend broker plus the IBKR broker's snapshot, to test when the runner records quotes."""

    def __new__(cls, clock):
        from stockwizard.broker import PretendBroker
        b = PretendBroker(clock=clock)
        b.snapshots = 0

        def chain_snapshot(symbol="SPY"):
            b.snapshots += 1
            return [{"taken_at": clock().isoformat(), "symbol": symbol, "expiry": "2026-11-20", "strike": 600.0, "right": "C",
                     "bid": 1.0, "ask": 1.1, "last": None, "iv": 0.15, "underlying": 600.0, "source": "ibkr"}]
        b.chain_snapshot = chain_snapshot
        return b


def test_quotes_are_recorded_every_30_minutes_in_us_hours_only():
    from datetime import timedelta
    s = FakeStore()
    s.set_limits(**LIMITS)
    clock = {"t": datetime(2026, 11, 18, 15, 0, tzinfo=timezone.utc)}     # 10:00 New York, Wednesday
    b = QuotingBroker(lambda: clock["t"])
    r = BotRunner(s, OWNER, clock=lambda: clock["t"], broker=b)
    assert "Recorded 1 SPY option quotes" in r.cycle()
    clock["t"] += timedelta(minutes=10)
    r.cycle()
    assert b.snapshots == 1, "not again within 30 minutes"
    clock["t"] += timedelta(minutes=25)
    r.cycle()
    assert b.snapshots == 2
    clock["t"] = datetime(2026, 11, 18, 22, 0, tzinfo=timezone.utc)      # 17:00 New York: closed
    r.cycle()
    clock["t"] = datetime(2026, 11, 21, 15, 0, tzinfo=timezone.utc)      # Saturday
    r.cycle()
    assert b.snapshots == 2
    assert len(s.tables["option_quotes"]) == 2


def test_the_pretend_broker_records_nothing():
    s = FakeStore()
    s.set_limits(**LIMITS)
    r, _ = runner(s)
    r.cycle()
    assert not s.tables.get("option_quotes")


def test_when_tws_goes_away_the_bot_exits_so_start_bot_restarts_it(monkeypatch, capsys):
    """ib_async doesn't reconnect by itself: the bot exits, and start-bot.bat starts a fresh one that reconnects and reconciles."""
    import stockwizard.broker.ibkr as ibkr
    import stockwizard.run_bot as rb
    import stockwizard.strategy_runner as sr

    class Broker:
        account = "DU0000001"
        up = [True, False]          # connected after the first cycle, gone after the second sleep
        def __init__(self, **kw):
            pass
        def connected(self):
            return self.up.pop(0) if self.up else False

    cycles = []
    class Runner:
        def __init__(self, *a, **kw):
            pass
        def cycle(self):
            cycles.append(1)
            return []

    monkeypatch.setattr(ibkr, "IBKRBroker", Broker)
    monkeypatch.setattr(sr, "IBKRMarket", lambda broker, store: None)
    monkeypatch.setattr(rb, "SupabaseStore", FakeStore)   # no joint account
    monkeypatch.setattr(rb, "BotRunner", Runner)
    monkeypatch.setattr(rb.Notifier, "from_env", staticmethod(lambda: None))
    monkeypatch.setattr(rb.time, "sleep", lambda s: None)
    assert rb.main(["--broker", "ibkr", "--port", "7497", "--loop", "30", "--owner", OWNER]) == 1
    assert len(cycles) == 2, "one cycle while connected, then it stops instead of looping on"
    assert "Restarting to reconnect" in capsys.readouterr().out


# --- prices from the market, and closes booked when they fill (Ben, 18 Nov 2026) ---

from dataclasses import replace as _replace  # noqa: E402

from stockwizard.broker import PretendBroker  # noqa: E402


class SlowBroker(PretendBroker):
    """The pretend broker, but nothing fills until the test says so."""

    def step(self):
        return []


class MarketBroker(SlowBroker):
    """Stands in for IBKR's real quotes: the chart order and the close are priced from 'the market'."""

    real_quotes = True

    def __init__(self, credit=0.85, to_close=0.40, fail=False, **kw):
        super().__init__(**kw)
        self.credit, self.to_close, self.fail = credit, to_close, fail

    def quote(self, order):
        if self.fail:
            raise ValueError("No bid and ask for the 590 put: is the market open and the data subscribed?")
        return _replace(order, limit_price=self.credit, price_kind="credit", prices_as_of=getattr(self, "as_of", NOW))

    def close_quote(self, order):
        return self.to_close


def opened(broker, **limits):
    """An iron condor ordered from the chart in automatic mode and filled at its limit."""
    s = FakeStore()
    s.set_limits(**{**LIMITS, "approval_mode": "automatic", "max_loss_per_trade": 100, **limits})
    market(s)
    request(s, kind="open", position_id="pos-1", quantity=1)
    r = BotRunner(s, OWNER, clock=lambda: NOW, broker=broker)
    r.cycle()
    p = next(iter(r.bot.orders.values()))
    broker.fill(p.broker_id)
    r.cycle()
    assert order(s)["status"] == "filled"
    return s, r, p


def test_with_ibkr_a_chart_order_is_priced_from_the_market_not_the_model():
    s, r, p = opened(MarketBroker(credit=0.85))
    o = order(s)
    assert o["limit_price"] == 0.85 and o["price_kind"] == "credit"
    assert "bid/ask midpoints" in o["reason"] and "Theoretical" not in o["reason"]


def test_with_no_market_quote_a_chart_order_fails_with_the_reason_and_nothing_is_sent():
    s = FakeStore()
    s.set_limits(**{**LIMITS, "approval_mode": "automatic", "max_loss_per_trade": 100})
    market(s)
    q = request(s, kind="open", position_id="pos-1", quantity=1)
    b = MarketBroker(fail=True)
    BotRunner(s, OWNER, clock=lambda: NOW, broker=b).cycle()
    assert q["status"] == "failed" and "No bid and ask" in q["result"]
    assert not s.tables["paper_orders"] and not b.calls, "a model price is never sent instead"


def test_a_close_keeps_the_position_open_until_it_fills_then_books_the_fill_price():
    b = MarketBroker(credit=0.85, to_close=0.40)
    s, r, p = opened(b)
    q = request(s, kind="close", order_id=order(s)["id"], quantity=1)
    r.cycle()
    o = order(s)
    assert "close sent at $0.40" in q["result"]
    assert o["status"] == "filled" and o["pnl"] is None and o["close_price"] == 0.40 and o["close_reason"] == "by you"
    again = request(s, kind="close", order_id=o["id"], quantity=1)
    r.cycle()
    assert again["status"] == "failed" and "already being closed" in again["result"]
    b.fill(o["close_broker_id"], 0.35)                 # filled better than its limit
    r.cycle()
    assert o["status"] == "closed" and o["pnl"] == 50.0  # (0.85 - 0.35) × 100: the real fill, not the limit
    assert "close_filled" in actions(s)


def test_a_close_cancelled_unfilled_leaves_the_position_open():
    b = SlowBroker()
    s, r, p = opened(b)
    request(s, kind="close", order_id=order(s)["id"], quantity=1)
    r.cycle()
    cid = order(s)["close_broker_id"]
    b.orders[cid].status = "cancelled"                  # the day ended unfilled
    said = r.cycle()
    o = order(s)
    assert o["status"] == "filled" and o["close_broker_id"] is None and o["pnl"] is None
    assert any("wasn't filled" in x for x in said) and "close_cancelled" in actions(s)
    assert r.bot.realised_loss_today == 0


def test_a_restart_keeps_the_fill_price_and_a_close_still_working():
    b = SlowBroker()
    s, r, p = opened(b)
    request(s, kind="close", order_id=order(s)["id"], quantity=1)
    r.cycle()
    cid = order(s)["close_broker_id"]
    order(s)["fill_price"] = 0.80                        # as IBKR reported it: filled 5c better than the model's 0.50
    b2 = SlowBroker(remembered=[])                       # the bot restarts with a fresh broker connection
    r2 = BotRunner(s, OWNER, clock=lambda: NOW, broker=b2)
    assert r2.bot.reconciled
    p2 = next(iter(r2.bot.orders.values()))
    assert p2.fill_price == 0.80 and p2.close_id == cid
    b2.fill(cid, 0.30)
    r2.cycle()
    assert order(s)["status"] == "closed" and order(s)["pnl"] == 50.0   # (0.80 - 0.30) × 100, from the remembered fill


def test_the_kill_switch_leaves_a_working_close_alone():
    b = SlowBroker()
    s, r, p = opened(b)
    request(s, kind="close", order_id=order(s)["id"], quantity=1)
    r.cycle()
    cid = order(s)["close_broker_id"]
    s.set_limits(kill_switch=True)
    r.cycle()
    assert b.orders[cid].status == "working", "closing only reduces risk"


class GoneBroker(SlowBroker):
    """After a restart the broker no longer holds the position: its close filled while the bot was away."""

    def positions(self):
        return []


def test_a_close_that_filled_while_the_bot_was_away_is_booked_at_its_limit():
    b = SlowBroker()
    s, r, p = opened(b)
    request(s, kind="close", order_id=order(s)["id"], quantity=1)
    r.cycle()
    r2 = BotRunner(s, OWNER, clock=lambda: NOW, broker=GoneBroker())
    o = order(s)
    assert r2.bot.reconciled and o["status"] == "closed"
    assert o["pnl"] == round((o["limit_price"] - o["close_price"]) * 100, 2)
    assert "closed_while_away" in actions(s)


# --- requests sent while the market is shut wait for the open (Ben, 19 Nov 2026) ---

def test_a_request_sent_overnight_waits_for_the_open_then_goes_through():
    s = FakeStore()
    s.set_limits(**{**LIMITS, "max_loss_per_trade": 100})
    market(s)
    q = request(s, kind="open", position_id="pos-1", quantity=1)
    clock = {"t": datetime(2026, 11, 19, 9, 30, tzinfo=timezone.utc)}      # 4:30 am New York, Thursday
    r = BotRunner(s, OWNER, clock=lambda: clock["t"], broker=MarketBroker(credit=0.85))
    r.cycle()
    assert q["status"] == "waiting" and "Waiting for the market to open" in q["result"]
    assert "9:35 am New York on Thu 19 Nov" in q["result"] and "1:35 am Sydney, Fri 20 Nov" in q["result"]
    assert not r.bot.orders, "nothing is priced or sent while the market is shut"
    clock["t"] = datetime(2026, 11, 19, 14, 36, tzinfo=timezone.utc)         # 9:36 am New York
    r.broker.as_of = clock["t"]                                               # the market's quotes, fresh at the open
    r.cycle()
    assert q["status"] == "done" and "waiting for your approval" in q["result"]


def test_a_request_whose_structure_expires_before_the_open_fails():
    s = FakeStore()
    s.set_limits(**LIMITS)
    market(s)
    s.tables["option_positions"][0]["expiry"] = "2026-11-20"
    q = request(s, kind="open", position_id="pos-1", quantity=1)
    r = BotRunner(s, OWNER, clock=lambda: datetime(2026, 11, 20, 22, 0, tzinfo=timezone.utc), broker=MarketBroker())   # Friday after the close
    r.cycle()
    assert q["status"] == "failed" and "expires before the market opens" in q["result"]


def test_the_next_open_skips_weekends_and_holidays():
    from stockwizard.run_bot import next_open
    assert next_open(datetime(2026, 11, 18, 15, 0, tzinfo=timezone.utc)) is None                       # Wed 10:00 New York: open
    assert next_open(datetime(2026, 11, 20, 22, 0, tzinfo=timezone.utc)).date().isoformat() == "2026-11-23"   # Fri evening → Mon
    assert next_open(datetime(2026, 11, 25, 22, 0, tzinfo=timezone.utc)).date().isoformat() == "2026-11-27"   # Thanksgiving skipped
