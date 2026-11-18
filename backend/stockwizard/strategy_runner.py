"""The bot's own strategies (bot_strategies): propose at the entry time, manage the exits, settle at the close.

Each strategy is a 0DTE research configuration (zerodte.strategy.Config), so
what the bot trades follows the same rules the research tests. Each cycle:

1. Propose: in the 15 minutes after a switched-on strategy's entry time, once
   a day, read today's bars, work out the signals, choose the strikes by delta,
   price the trade at the natural side (sell at the bid, buy at the ask), and
   hand it to the bot. The safety rails decide; in approval mode it waits for
   Ben. A day with no setup is recorded once, with the reason.
2. Manage: for each filled strategy trade, check its exits (profit target,
   stop, short strike breached, delta, time) against fresh quotes; close it
   at the natural price when one triggers.
3. Settle: after 16:00 New York on the expiry day, a position still open
   settles at its intrinsic value from the last price.

Multi-day strategies (`dte` above 1; Ben, 18 Nov 2026) follow the option
backtests: one position at a time, expiring at the close `dte` trading days
into the trade, shorts placed by delta or by daily ranges (`short_atr`),
priced with the VIX rather than VIX1D. They differ from the backtests in
two ways: entry is at the strategy's entry time, not the open, and the
profit target is checked every cycle, not only at each day's close.

The market comes from a MarketView: the free source's 5-minute candles and
the model's quotes with the pretend broker (prices are made up), or
Interactive Brokers' bars and real quotes with the IBKR broker.
"""

from __future__ import annotations

import math
from datetime import date, datetime, time, timedelta
from typing import Protocol
from zoneinfo import ZoneInfo

import pandas as pd

from stockwizard.data.base import select_preferred
from stockwizard.rails import Leg as RailLeg
from stockwizard.rails import OrderRequest
from stockwizard.zerodte import calendar, signals
from stockwizard.zerodte.engine import _close_price, _intrinsic, _mid_value, _open_price
from stockwizard.zerodte.instruments import INSTRUMENTS
from stockwizard.zerodte.quotes import ModelQuotes
from stockwizard.zerodte.strategy import Config, Leg, legs_for, resolve

NY = ZoneInfo("America/New_York")
WINDOW = timedelta(minutes=15)
UNDERLYING = {"SPY": "SPY", "XSP": "SPY", "SPX": "SPY", "QQQ": "QQQ"}   # whose bars the pretend market reads


class MarketView(Protocol):
    bar_minutes: int

    def bars_today(self, instrument: str, now: datetime) -> pd.DataFrame | None:
        """Today's finished bars for the instrument's underlying (New York index), scaled to the instrument."""

    def chain(self, instrument: str, now: datetime, spot: float, only: list | None = None, expiry: date | None = None) -> dict:
        """Quotes for an expiry, today's by default (or just `only`)."""

    def atr(self, instrument: str, day: date) -> float | None:
        """ATR(14) of the daily candles before `day`, scaled to the instrument."""

    def daily(self, instrument: str, day: date) -> pd.DataFrame | None:
        """The underlying's daily candles before `day` (UTC index, as the scans read them)."""

    def vix_prev(self, day: date) -> float | None:
        """The VIX's close before `day`."""


class PretendMarket:
    """Today's 5-minute candles from the free source and the model's quotes. Prices are made up; nothing here is real."""

    bar_minutes = 5

    def __init__(self, store, source=None, quotes=None):
        from stockwizard.data.yahoo import YahooSource  # noqa: PLC0415
        self.store, self.source, self.quotes = store, source or YahooSource(), quotes or ModelQuotes()
        self._bars: dict[tuple[str, date], pd.DataFrame] = {}

    def bars_today(self, instrument, now):
        sym = UNDERLYING[instrument]
        day = now.astimezone(NY).date()
        key = (sym, day)
        try:
            df = self.source.fetch(sym, "5m", start=day, end=day + timedelta(days=1))
        except Exception:  # noqa: BLE001 - no bars is a reason not to trade, recorded by the caller
            return None
        df = df.copy()
        df.index = df.index.tz_convert(NY)
        df[["open", "high", "low", "close"]] *= INSTRUMENTS[instrument].scale
        self._bars[key] = df
        return df[df.index.date == day]

    def vol_now(self, now):
        return self._vol(now)

    def _vol(self, now):
        try:
            v = self.source.fetch("^VIX1D", "5m", start=now.astimezone(NY).date(), end=now.astimezone(NY).date() + timedelta(days=1))
            if len(v):
                return float(v["close"].iloc[-1]) / 100
        except Exception:  # noqa: BLE001
            pass
        prev = self.vix_prev(now.astimezone(NY).date() + timedelta(days=1))
        return prev / 100 if prev else 0.2

    def chain(self, instrument, now, spot, only=None, expiry=None):
        today = now.astimezone(NY).date()
        expiry = expiry or today
        left = _seconds_to_expiry(now, expiry)
        if expiry > today:   # multi-day: the VIX (30 days), as the option backtests price it
            prev = self.vix_prev(today + timedelta(days=1))
            vol = prev / 100 if prev else 0.2
        else:
            vol = self._vol(now)
        vol *= 1.2 if instrument == "QQQ" else 1.0
        return self.quotes.chain(INSTRUMENTS[instrument], now, spot, left, vol, only=only)

    def daily(self, instrument, day):
        rows = select_preferred(self.store, "candles", {"select": "ts,open,high,low,close,volume", "symbol": f"eq.{UNDERLYING[instrument]}",
                                                         "timeframe": "eq.1d", "order": "ts.desc", "limit": "400"})
        rows = [r for r in rows if pd.Timestamp(r["ts"]).tz_convert(NY).date() < day]
        if not rows:
            return None
        df = pd.DataFrame([{k: float(r[k] or 0) for k in ("open", "high", "low", "close", "volume")} for r in reversed(rows)],
                          index=pd.DatetimeIndex([pd.Timestamp(r["ts"]).tz_convert("UTC") for r in reversed(rows)], name="ts"))
        return df[~df.index.duplicated(keep="last")]

    def atr(self, instrument, day):
        df = self.daily(instrument, day)
        if df is None or len(df) < 14:
            return None
        from stockwizard.option_backtest import atr14  # noqa: PLC0415
        return float(atr14(df.reset_index(drop=True)).iloc[-1]) * INSTRUMENTS[instrument].scale

    def vix_prev(self, day):
        rows = select_preferred(self.store, "candles", {"select": "ts,close", "symbol": "eq.^VIX", "timeframe": "eq.1d", "order": "ts.desc", "limit": "10"})
        for r in rows:
            if pd.Timestamp(r["ts"]).tz_convert(NY).date() < day:
                return float(r["close"])
        return None


def _seconds_to_expiry(now: datetime, expiry: date) -> float:
    """Trading seconds from now to the expiry's close: what's left of today's session plus 6.5 hours a session after it."""
    ny = now.astimezone(NY)
    today = max((datetime.combine(ny.date(), time(16, 0), NY) - max(ny, datetime.combine(ny.date(), time(9, 30), NY))).total_seconds(), 0)
    return today + calendar.sessions_between(ny.date(), expiry) * 6.5 * 3600


def _rail_legs(legs: tuple[Leg, ...]) -> tuple[RailLeg, ...]:
    return tuple(RailLeg(l.right, l.side, float(l.strike), 1) for l in legs)


def _tick(x: float, tick: float, down: bool) -> float:
    return round((math.floor(x / tick + 1e-9) if down else math.ceil(x / tick - 1e-9)) * tick, 2)


ATR_PLACED = ("iron_condor", "bull_put", "bear_call")


def _atr_legs(cfg: Config, structure: str, chain: dict, spot: float, atr: float, step: float) -> tuple[Leg, ...] | None:
    """Shorts `short_atr` daily ranges from the price, on the strike grid, wings beyond: as the option backtests place them."""
    r = max(step, round(atr * cfg.short_atr / step) * step)
    at = round(spot / step) * step
    cw = cfg.call_width if cfg.call_width is not None else cfg.width
    put = (Leg("P", "buy", round(at - r - cfg.width, 2)), Leg("P", "sell", round(at - r, 2)))
    call = (Leg("C", "sell", round(at + r, 2)), Leg("C", "buy", round(at + r + cw, 2)))
    legs = {"iron_condor": put + call, "bull_put": put, "bear_call": call}[structure]
    return legs if all((l.right, l.strike) in chain for l in legs) else None


def _best(legs: tuple[Leg, ...], opened: float, credit: bool) -> float:
    """The most the position can make per share at expiry, given what it opened at."""
    from stockwizard.option_backtest import payoff_range  # noqa: PLC0415
    best, _ = payoff_range(_rail_legs(legs), opened if credit else -opened)
    return best


class StrategyRunner:
    def __init__(self, runner, market: MarketView):
        self.r, self.market = runner, market       # runner: run_bot.BotRunner (store, bot, db ids, audit)

    def strategies(self) -> list[dict]:
        return self.r.store.select("bot_strategies", {"select": "*", "owner": f"eq.{self.r.owner}", "enabled": "eq.true"})

    def _already_today(self, sid: str, day: date) -> bool:
        start = datetime.combine(day, time(0, 0), NY).astimezone(ZoneInfo("UTC")).isoformat()
        if self.r.store.select("paper_orders", {"select": "id", "strategy_id": f"eq.{sid}", "created_at": f"gte.{start}"}):
            return True   # one proposed today
        skips = self.r.store.select("audit_log", {"select": "detail", "action": "eq.strategy_no_trade", "at": f"gte.{start}"})
        return any((s.get("detail") or {}).get("strategy") == sid for s in skips)

    def _no_trade(self, st: dict, why: str) -> str:
        self.r.audit("bot", "strategy_no_trade", {"strategy": st["id"], "label": st["label"], "why": why})
        return f"{st['label']}: no trade today ({why})"

    # 0. what the Today screen shows
    def snapshot(self, now: datetime, symbol: str = "SPY") -> list[str]:
        """During the session, save what the bot sees (price, VIX, VIX1D, expected move, opening range, VWAP, direction)."""
        ny = now.astimezone(NY)
        if ny.weekday() >= 5 or not (time(9, 35) <= ny.time() <= time(16, 5)):
            return []
        bars = self.market.bars_today(symbol, ny)
        if bars is None or bars.empty:
            return []
        sig = signals.at_entry(bars, min(ny.time(), time(16, 0)), self.market.bar_minutes)
        if sig is None:
            return []
        vol = self.market.vol_now(ny)
        left = max((datetime.combine(ny.date(), time(16, 0), NY) - ny).total_seconds(), 0)
        em = sig.price * vol * math.sqrt(left / (252 * 6.5 * 3600)) if vol else None
        r = lambda v, d=2: None if v is None else round(float(v), d)  # noqa: E731
        row = {"symbol": symbol, "taken_at": now.astimezone(ZoneInfo("UTC")).isoformat(), "session_date": ny.date().isoformat(),
               "price": r(sig.price), "vix": r(self.market.vix_prev(ny.date() + timedelta(days=1))), "vix1d": r(vol * 100 if vol else None),
               "expected_move": r(em), "or_high": r(sig.or_high), "or_low": r(sig.or_low), "vwap": r(sig.vwap),
               "direction": sig.direction, "source": "ibkr" if isinstance(self.market, IBKRMarket) else "pretend"}
        self.r.store.upsert("market_snapshots", "symbol", [row])
        return []

    # 1. propose
    def propose_due(self, now: datetime) -> list[str]:
        said = []
        ny = now.astimezone(NY)
        if not calendar.is_trading_day(ny.date()):
            return said
        for st in self.strategies():
            cfg = Config.from_dict(st["config"])
            at = datetime.combine(ny.date(), cfg.entry_time(), NY)
            if not (at <= ny <= at + WINDOW) or self._already_today(st["id"], ny.date()):
                continue
            said.append(self._propose(st, cfg, ny))
        return said

    def _open_position(self, sid: str) -> int | None:
        for pid, p in self.r.bot.orders.items():
            if self.r.strategy_of.get(pid, {}).get("id") == sid and p.status in ("proposed", "sent", "filled"):
                return self.r.db_ids.get(pid)
        return None

    def _propose(self, st: dict, cfg: Config, ny: datetime) -> str:
        day = ny.date()
        expiry = calendar.trading_day_ahead(day, max(cfg.dte - 1, 0))
        if expiry > day and (held := self._open_position(st["id"])) is not None:
            return self._no_trade(st, f"order {held} is still open (one at a time)")
        if any(t in cfg.skip_tags for t in calendar.tags(day)):
            return self._no_trade(st, "a day the strategy skips")
        vix = self.market.vix_prev(day)
        if vix is None:
            return self._no_trade(st, "no VIX")
        if (cfg.vix_min is not None and vix < cfg.vix_min) or (cfg.vix_max is not None and vix > cfg.vix_max):
            return self._no_trade(st, f"the VIX ({vix:.1f}) is outside the strategy's range")
        if cfg.signal_rule:
            from stockwizard.scans import evaluate  # noqa: PLC0415
            daily = self.market.daily(cfg.instrument, day)
            if daily is None or len(daily) < 60:
                return self._no_trade(st, "not enough daily candles for its signal")
            if not bool(evaluate(cfg.signal_rule, daily, **cfg.signal_params)["hit"].iloc[-1]):
                return self._no_trade(st, f"its signal ({cfg.signal_rule.replace('_', ' ')}) wasn't on at the last close")
        bars = self.market.bars_today(cfg.instrument, ny)
        if bars is None or bars.empty:
            return self._no_trade(st, "no price bars for today yet")
        sig = signals.at_entry(bars, cfg.entry_time(), self.market.bar_minutes)
        if sig is None:
            return self._no_trade(st, "no finished bars by the entry time")
        if cfg.require_inside_range and sig.inside_range is False:
            return self._no_trade(st, "the price has left the opening range")
        structure = resolve(cfg, sig.direction)
        if structure is None:
            return self._no_trade(st, f"no setup ({sig.direction} day)")
        inst = INSTRUMENTS[cfg.instrument]
        chain = self.market.chain(cfg.instrument, ny, sig.price, expiry=expiry)
        if cfg.short_atr is not None and structure in ATR_PLACED:
            atr = self.market.atr(cfg.instrument, day)
            if atr is None:
                return self._no_trade(st, "no daily range (ATR) to place the shorts")
            legs = _atr_legs(cfg, structure, chain, sig.price, atr, inst.step) if chain else None
        else:
            legs = legs_for(cfg, structure, chain, sig.price, inst.step) if chain else None
        if legs is None:
            return self._no_trade(st, "the strikes it needs aren't quoted")
        paid = _open_price(legs, chain, cfg.slippage)
        credit = -paid
        if structure in ("bull_call_debit", "bear_put_debit"):
            price, kind = _tick(paid, inst.tick, down=False), "debit"
        else:
            if credit <= 0 or credit < cfg.min_credit:
                return self._no_trade(st, f"the credit (${credit:.2f}) is too small")
            price, kind = _tick(credit, inst.tick, down=True), "credit"
        req = OrderRequest(symbol=cfg.instrument, structure=structure, expiry=expiry, legs=_rail_legs(legs), quantity=1,
                           limit_price=price, price_kind=kind, prices_as_of=ny.astimezone(ZoneInfo("UTC")))
        held = f", expires {expiry:%a %d %b}" if expiry > day else ""
        p = self.r.bot.propose(req, reason=f"{st['label']}: {sig.direction} at {cfg.entry}{held}, {structure.replace('_', ' ')} "
                                            f"{'/'.join(f'{l.strike:g}' for l in legs)}, {kind} ${price:.2f}")
        self.r.store.update("paper_orders", {"id": f"eq.{self.r.db_ids[p.id]}"}, {"strategy_id": st["id"]})
        self.r.strategy_of[p.id] = st
        outcome = "refused: " + "; ".join(x.why for x in p.refusals) if p.refusals else p.status
        return f"{st['label']}: proposed order {self.r.db_ids[p.id]} ({outcome})"

    # 2. manage exits
    def manage(self, now: datetime) -> list[str]:
        said = []
        ny = now.astimezone(NY)
        for pid, p in list(self.r.bot.orders.items()):
            st = self.r.strategy_of.get(pid)
            if st is None or p.status != "filled" or p.close_id or p.request.expiry < ny.date() or not calendar.is_trading_day(ny.date()):
                continue
            cfg = Config.from_dict(st["config"])
            legs = tuple(Leg(l.right, l.side, l.strike) for l in p.request.legs)
            bars = self.market.bars_today(cfg.instrument, ny)
            if bars is None or bars.empty:
                continue
            spot = float(bars["close"].iloc[-1])
            only = [(l.right, l.strike) for l in legs]
            ch = self.market.chain(cfg.instrument, ny, spot, only=only, expiry=p.request.expiry)
            mid = _mid_value(legs, ch)
            cost = _close_price(legs, ch, cfg.slippage)
            if mid is None or cost is None:
                continue
            credit = p.fill_price if p.fill_price is not None else p.request.limit_price
            is_credit = p.request.price_kind == "credit"
            entry_mid = -credit if is_credit else credit
            loss = entry_mid - mid
            shorts = [l for l in legs if l.side == "sell"]
            why = None
            made = (credit - cost) if is_credit else (-cost - credit)   # per share, if closed now
            if cfg.profit_target is not None and made >= cfg.profit_target * _best(legs, credit, is_credit) > 0:
                why = "profit target"
            elif cfg.close_days_left is not None and (p.request.expiry - ny.date()).days <= cfg.close_days_left:
                why = f"{cfg.close_days_left} days left"
            elif is_credit and cfg.stop_mult is not None and loss >= cfg.stop_mult * credit:
                why = "stop"
            elif cfg.stop_breach and any((spot >= l.strike) if l.right == "C" else (spot <= l.strike) for l in shorts):
                why = "short strike reached"
            elif cfg.stop_delta is not None and any(abs(ch[(l.right, round(l.strike, 2))].delta) >= cfg.stop_delta for l in shorts):
                why = "delta"
            elif cfg.exit_at() is not None and p.request.expiry == ny.date() and ny.time() >= cfg.exit_at():
                why = "time"
            if why:
                close_px = abs(cost)
                self.r.close_why[pid] = why
                self.r.bot.close(pid, close_px, by="bot", why=why)
                said.append(f"Order {self.r.db_ids[pid]}: close sent ({why}) at ${close_px:.2f}; booked when it fills")
        return said

    # 3. settle at the close
    def settle(self, now: datetime) -> list[str]:
        said = []
        ny = now.astimezone(NY)
        if ny.time() < time(16, 0) and ny.weekday() < 5:
            return said
        for pid, p in list(self.r.bot.orders.items()):
            if p.status != "filled" or p.close_id or p.request.expiry > ny.date():
                continue   # a close still working is left to fill or be cancelled at the day's end first
            bars = self.market.bars_today(p.request.symbol, ny) if p.request.symbol in INSTRUMENTS else None
            if bars is None or bars.empty:
                continue
            last = float(bars["close"].iloc[-1])
            legs = tuple(Leg(l.right, l.side, l.strike) for l in p.request.legs)
            value = _intrinsic(legs, last)                       # per share, long legs plus
            opened = p.fill_price if p.fill_price is not None else p.request.limit_price
            per_share = (opened + value) if p.request.price_kind == "credit" else (value - opened)
            fees = INSTRUMENTS[p.request.symbol].per_leg_cost * len(legs) if p.request.symbol in INSTRUMENTS else 0.0
            pnl = round(per_share * 100 * p.request.quantity - fees, 2)
            self.r.broker.settle(p.broker_id)
            self.r.close_why[pid] = "settled at the close"
            self.r.bot.record_close(pid, pnl)
            said.append(f"Order {self.r.db_ids[pid]}: settled at the close ({p.request.symbol} {last:.2f}), {pnl:+.2f}")
        return said


class IBKRMarket:
    """Today's 5-minute bars and real option quotes from Interactive Brokers (paper). Untested until Ben's account runs."""

    bar_minutes = 5
    CLASSES = {"SPX": "SPXW", "XSP": "XSP", "SPY": "SPY", "QQQ": "QQQ"}

    def __init__(self, broker, store):
        self.b, self.store = broker, store

    def _underlying(self, instrument):
        lib = self.b.lib
        if instrument in ("SPX", "XSP"):
            return self.b.ib.qualifyContracts(lib.Index(instrument, "CBOE", "USD"))[0]
        return self.b.ib.qualifyContracts(lib.Stock(instrument, "SMART", "USD"))[0]

    def bars_today(self, instrument, now):
        bars = self.b.ib.reqHistoricalData(self._underlying(instrument), endDateTime="", durationStr="1 D", barSizeSetting="5 mins",
                                           whatToShow="TRADES", useRTH=True, formatDate=2)
        if not bars:
            return None
        df = pd.DataFrame([{"ts": pd.Timestamp(x.date), "open": x.open, "high": x.high, "low": x.low, "close": x.close,
                            "volume": max(float(getattr(x, "volume", 0) or 0), 0.0)} for x in bars]).set_index("ts")
        df.index = (df.index.tz_localize("UTC") if df.index.tz is None else df.index).tz_convert(NY)
        done = df[df.index + pd.Timedelta(minutes=5) <= now.astimezone(NY)]
        return done[done.index.date == now.astimezone(NY).date()]

    def chain(self, instrument, now, spot, only=None, expiry=None):
        from stockwizard.zerodte.quotes import OptionQuote, bs  # noqa: PLC0415
        inst = INSTRUMENTS[instrument]
        day = expiry or now.astimezone(NY).date()
        if only is None:
            lo, hi = math.floor(spot * 0.96 / inst.step) * inst.step, math.ceil(spot * 1.04 / inst.step) * inst.step
            ks = [round(lo + i * inst.step, 2) for i in range(int((hi - lo) / inst.step) + 1)]
            only = [(r, k) for k in ks for r in ("C", "P")]
        opts = [self.b.lib.Option(instrument, day.strftime("%Y%m%d"), k, r, "SMART", tradingClass=self.CLASSES[instrument], currency="USD")
                for r, k in only]
        out = {}
        for i in range(0, len(opts), 50):
            part = [c for c in self.b.ib.qualifyContracts(*opts[i : i + 50]) if getattr(c, "conId", 0)]
            for c, t in zip(part, self.b.ib.reqTickers(*part)):
                if not (t.bid and t.ask) or math.isnan(t.bid) or math.isnan(t.ask) or t.bid < 0:
                    continue
                g = getattr(t, "modelGreeks", None)
                iv = getattr(g, "impliedVol", None) or 0.2
                delta = getattr(g, "delta", None)
                if delta is None or (isinstance(delta, float) and math.isnan(delta)):
                    left = _seconds_to_expiry(now, day) / (252 * 6.5 * 3600)
                    delta = bs(c.right, spot, float(c.strike), left, iv)[1]
                out[(c.right, round(float(c.strike), 2))] = OptionQuote(c.right, float(c.strike), float(t.bid), float(t.ask), iv, float(delta))
        return out

    def vix_prev(self, day):
        return PretendMarket.vix_prev(self, day)

    def atr(self, instrument, day):
        return PretendMarket.atr(self, instrument, day)

    def daily(self, instrument, day):
        return PretendMarket.daily(self, instrument, day)

    def vol_now(self, now):
        """VIX1D from IBKR when the data is subscribed; otherwise the VIX's last close."""
        try:
            t = self.b.ib.reqTickers(self.b.ib.qualifyContracts(self.b.lib.Index("VIX1D", "CBOE", "USD"))[0])[0]
            v = t.marketPrice()
            if v and not math.isnan(v):
                return float(v) / 100
        except Exception:  # noqa: BLE001
            pass
        prev = self.vix_prev(now.astimezone(NY).date() + timedelta(days=1))
        return prev / 100 if prev else None
