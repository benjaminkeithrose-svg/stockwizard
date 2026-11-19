"""Same-day (0DTE) option backtests on SPY's hourly candles, priced by model (Ben, 18 Nov 2026).

Tests the choices practitioners argue about (see SPEC.md):
- entry at the open (09:30) or at 10:00 (Ben, 19 Nov 2026: IBKR's hourly candles run 09:30-10:00,
  then on the hour to 16:00, so the second entry moved from 10:30 to 10:00; the strategies changed,
  so their held-back years count as seen);
- volatility from the VIX (previous close) or VIX1D (the one-day VIX, its
  value at the entry candle's open);
- short strikes from the daily range (ATR) or from the expected move to the
  close (price × volatility × √time), times a multiple;
- a stop-loss at 1× or 2× the credit, checked at each candle's high and low (priced at that
  candle's end, the next candle's start, so a little pessimistic), or none.

Time is counted in trading hours (6.5 a session, 252 sessions a year), as
volatility builds up while the market is open. Stops trigger on the mid
price and pay slippage on the way out.

Everything at entry uses only what was known then. Prices are Black-Scholes;
volatility stays at its entry value through the day. Costs: $0.65 a leg on
opening and on a stop exit, nothing at expiry; 5c a leg slippage each way.
Short days (closing early) are skipped. Settlement at the 16:00 close.
"""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass
from datetime import date, datetime, time, timezone

import pandas as pd

from stockwizard.option_backtest import atr14, intrinsic, legs_for
from stockwizard.pricing import net_value
from stockwizard.rails import Leg

NY = "America/New_York"
TRADING_YEAR = 252 * 6.5 * 3600   # seconds of trading in a year: time counts only while the market is open


@dataclass(frozen=True)
class IntradayStrategy:
    structure: str = "iron_condor"
    entry: str = "open"            # open (09:30) or 10:00 (10:30 for runs on the old half-hour candles)
    vol_source: str = "vix"        # vix or vix1d
    strikes: str = "atr"           # atr or expected_move
    short_atr: float = 1.0
    em_mult: float = 1.2
    wing: float = 5.0
    stop_mult: float | None = None
    commission: float = 0.65
    slippage: float = 0.05
    max_loss_cap: float | None = None

    @classmethod
    def from_config(cls, cfg: dict) -> "IntradayStrategy":
        return cls(**{k: v for k, v in cfg.items() if k in cls.__dataclass_fields__})


@dataclass
class IntradayTrade:
    signal_day: date
    entry_day: date
    expiry_day: date
    exit_day: date
    entry_time: str
    exit_time: str
    spot_in: float
    spot_out: float
    legs: list
    vol: float
    credit: float
    exit_cost: float
    pnl: float
    max_loss: float
    exit_reason: str               # expiry or stop

    def row(self) -> dict:
        d = asdict(self)
        for k in ("signal_day", "entry_day", "expiry_day", "exit_day"):
            d[k] = d[k].isoformat()
        return d


def _ny(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    out.index = df.index.tz_convert(NY)
    return out


def _close_at(day: date) -> datetime:
    return pd.Timestamp(datetime.combine(day, time(16, 0)), tz=NY).to_pydatetime()


def run(s: IntradayStrategy, spy_1h: pd.DataFrame, spy_1d: pd.DataFrame, vix_1d: pd.DataFrame,
        vix1d_1h: pd.DataFrame | None, start: date) -> dict:
    h = _ny(spy_1h)
    days = sorted({t.date() for t in h.index})
    daily = spy_1d.copy()
    daily.index = daily.index.tz_convert(NY).date
    daily = daily[~daily.index.duplicated(keep="last")]
    atr = atr14(daily)
    vix = vix_1d.copy()
    vix.index = vix.index.tz_convert(NY).date
    vix = vix[~vix.index.duplicated(keep="last")]["close"]
    v1 = _ny(vix1d_1h) if vix1d_1h is not None else None
    n_legs = 4
    trades: list[IntradayTrade] = []
    skipped = {"short_day": 0, "no_vol": 0, "no_history": 0, "over_risk_limit": 0, "no_credit": 0, "no_entry_candle": 0}
    want = time(9, 30) if s.entry == "open" else time(*map(int, s.entry.split(":")))
    for d in days:
        if d < start:
            continue
        bars = h[[t.date() == d for t in h.index]]
        # A full session: from 09:30 to the 16:00 close (IBKR's last hourly candle starts at 15:00; the old ones at 15:30).
        if len(bars) < 6 or bars.index[0].time() != time(9, 30) or bars.index[-1].time() not in (time(15, 0), time(15, 30)):
            skipped["short_day"] += 1
            continue
        starts = [t.time() for t in bars.index]
        if want not in starts:
            skipped["no_entry_candle"] += 1
            continue
        e = starts.index(want)
        t_in = bars.index[e]
        spot = float(bars["open"].iloc[e])
        prior = [x for x in daily.index if x < d]
        if not prior or pd.isna(atr.get(prior[-1], float("nan"))):
            skipped["no_history"] += 1
            continue
        if s.vol_source == "vix1d":
            row = v1.loc[v1.index == t_in] if v1 is not None else None
            if row is None or row.empty:
                skipped["no_vol"] += 1
                continue
            vol = float(row["open"].iloc[0]) / 100
        else:
            prev_vix = [x for x in vix.index if x < d]
            if not prev_vix:
                skipped["no_vol"] += 1
                continue
            vol = float(vix[prev_vix[-1]]) / 100
        close = _close_at(d)
        t0 = max((close - t_in.to_pydatetime()).total_seconds(), 60) / TRADING_YEAR
        if s.strikes == "expected_move" and s.structure == "iron_condor":
            em = spot * vol * math.sqrt(t0)
            r = max(1, round(em * s.em_mult))
            at, w = round(spot), max(1, round(s.wing))
            legs = (Leg("P", "buy", at - r - w), Leg("P", "sell", at - r), Leg("C", "sell", at + r), Leg("C", "buy", at + r + w))
        else:
            legs = legs_for(s.structure, spot, float(atr[prior[-1]]), s.wing, s.short_atr)
        mid_credit = -net_value(legs, spot, t0, vol)
        credit = mid_credit - s.slippage * n_legs
        if credit <= 0:
            skipped["no_credit"] += 1   # nobody pays to open a short structure
            continue
        widest = max(legs[1].strike - legs[0].strike, legs[3].strike - legs[2].strike)
        max_loss = (widest - credit) * 100 + s.commission * n_legs
        if s.max_loss_cap is not None and max_loss > s.max_loss_cap:
            skipped["over_risk_limit"] += 1
            continue
        exit_cost, reason, exit_t, spot_out = None, "expiry", bars.index[-1], float(bars["close"].iloc[-1])
        if s.stop_mult is not None and credit > 0:
            for j in range(e, len(bars)):
                end = bars.index[j + 1] if j < len(bars) - 1 else pd.Timestamp(close)   # IBKR's first candle is half an hour
                tj = max((close - end.to_pydatetime()).total_seconds(), 0) / TRADING_YEAR
                for px in (float(bars["high"].iloc[j]), float(bars["low"].iloc[j])):
                    # The stop triggers on the mid price, as a broker's would; slippage applies to the exit.
                    mid = -intrinsic(legs, px) if tj == 0 else -net_value(legs, px, tj, vol)
                    if mid - mid_credit >= s.stop_mult * mid_credit:
                        exit_cost, reason, exit_t, spot_out = mid + s.slippage * n_legs, "stop", bars.index[j], px
                        break
                if exit_cost is not None:
                    break
        if exit_cost is None:
            exit_cost = -intrinsic(legs, spot_out)
            commission = s.commission * n_legs
        else:
            commission = 2 * s.commission * n_legs
        pnl = round((credit - exit_cost) * 100 - commission, 2)
        trades.append(IntradayTrade(d, d, d, d, t_in.strftime("%H:%M"), exit_t.strftime("%H:%M"), spot, spot_out,
                                    [asdict(l) for l in legs], round(vol, 4), round(credit, 4), round(exit_cost, 4), pnl,
                                    round(max_loss, 2), reason))
    return {"trades": trades, "skipped": skipped}


__all__ = ["IntradayStrategy", "IntradayTrade", "run"]
