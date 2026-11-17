"""The instruments in the brief, as the engine needs them.

Fees and typical bid-ask spreads are from blogs and broker pages, not exchange
schedules (see docs/research/0DTE-RESEARCH.md): every figure here is an
estimate to check before trusting results. Commission is IBKR's usual US
option rate per contract.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Instrument:
    symbol: str
    step: float              # strike spacing near the money
    scale: float             # price relative to SPY (the model's underlying until real data)
    settlement: str          # cash or shares
    exercise: str            # european or american
    commission: float        # per contract per leg, each way
    exchange_fee: float      # per contract per leg, each way (estimate)
    min_half_spread: float   # the narrowest half of the bid-ask, in dollars (estimate)
    spread_pct: float        # half-spread as a share of the option's price, above the minimum (estimate)
    tick: float              # price tick for limit orders

    @property
    def per_leg_cost(self) -> float:
        return self.commission + self.exchange_fee


INSTRUMENTS: dict[str, Instrument] = {
    "SPY": Instrument("SPY", 1.0, 1.0, "shares", "american", 0.65, 0.05, 0.01, 0.03, 0.01),
    "XSP": Instrument("XSP", 1.0, 1.0, "cash", "european", 0.65, 0.07, 0.03, 0.05, 0.01),
    "SPX": Instrument("SPX", 5.0, 10.0, "cash", "european", 0.65, 0.45, 0.10, 0.04, 0.05),
    "QQQ": Instrument("QQQ", 1.0, 1.0, "shares", "american", 0.65, 0.05, 0.01, 0.03, 0.01),
}
