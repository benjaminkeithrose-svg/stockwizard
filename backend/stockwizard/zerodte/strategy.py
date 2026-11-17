"""A 0DTE strategy's settings (the brief's sections 4–7), and choosing its strikes from a chain by delta."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import time

from .quotes import OptionQuote

STRUCTURES = ("bull_put", "bear_call", "iron_condor", "iron_fly", "bull_call_debit", "bear_put_debit", "directional", "directional_debit")


@dataclass(frozen=True)
class Config:
    instrument: str = "XSP"
    structure: str = "iron_condor"     # see STRUCTURES; "directional" picks bull put, bear call or condor from the signals
    entry: str = "10:30"               # New York time
    short_delta: float = 0.15
    width: float = 1.0                 # dollars between short and long strike (the put side for a condor)
    call_width: float | None = None    # a different call-side width (asymmetric condor)
    neutral_trade: str = "iron_condor" # for "directional": what to sell on a neutral day (iron_condor or none)
    require_inside_range: bool = False # only trade if the price is still inside the opening range
    vix_min: float | None = None
    vix_max: float | None = None
    skip_tags: tuple[str, ...] = ()    # e.g. ("fed_day",)
    min_credit: float = 0.0            # per share; skip if the natural credit is smaller
    profit_target: float | None = None # close when this share of the credit is made (0.25, 0.5, 0.75)
    stop_mult: float | None = None     # close when the loss reaches this many credits (1.5, 2, 3)
    stop_breach: bool = False          # close when the price touches a short strike
    stop_delta: float | None = None    # close when a short leg's delta reaches this (0.35, 0.40, 0.50)
    exit_time: str | None = None       # close by this time (14:30, 15:00, 15:30)
    slippage: float = 0.0              # per leg, each way, beyond paying the bid-ask spread

    def entry_time(self) -> time:
        return time.fromisoformat(self.entry)

    def exit_at(self) -> time | None:
        return time.fromisoformat(self.exit_time) if self.exit_time else None

    def key(self) -> str:
        return "|".join(f"{k}={v}" for k, v in sorted(asdict(self).items()) if v not in (None, False, (), 0.0) or k in ("instrument", "structure"))

    @classmethod
    def from_dict(cls, d: dict) -> "Config":
        d = {k: (tuple(v) if k == "skip_tags" else v) for k, v in d.items() if k in cls.__dataclass_fields__}
        return cls(**d)


@dataclass(frozen=True)
class Leg:
    right: str
    side: str      # buy or sell
    strike: float


def _nearest_delta(chain: dict, right: str, target: float, spot: float) -> OptionQuote | None:
    side = [q for (r, _), q in chain.items() if r == right and ((q.strike > spot) if right == "C" else (q.strike < spot))]
    return min(side, key=lambda q: abs(abs(q.delta) - target)) if side else None


def _at(chain: dict, right: str, strike: float) -> OptionQuote | None:
    return chain.get((right, round(strike, 2)))


def legs_for(cfg: Config, structure: str, chain: dict, spot: float, step: float) -> tuple[Leg, ...] | None:
    """The legs, or None when the chain doesn't list what's needed."""
    cw = cfg.call_width if cfg.call_width is not None else cfg.width
    if structure == "bull_put":
        sp = _nearest_delta(chain, "P", cfg.short_delta, spot)
        legs = sp and (Leg("P", "sell", sp.strike), Leg("P", "buy", sp.strike - cfg.width))
    elif structure == "bear_call":
        sc = _nearest_delta(chain, "C", cfg.short_delta, spot)
        legs = sc and (Leg("C", "sell", sc.strike), Leg("C", "buy", sc.strike + cw))
    elif structure == "iron_condor":
        sp, sc = _nearest_delta(chain, "P", cfg.short_delta, spot), _nearest_delta(chain, "C", cfg.short_delta, spot)
        legs = sp and sc and (Leg("P", "buy", sp.strike - cfg.width), Leg("P", "sell", sp.strike),
                              Leg("C", "sell", sc.strike), Leg("C", "buy", sc.strike + cw))
    elif structure == "iron_fly":
        at = round(spot / step) * step
        legs = (Leg("P", "buy", at - cfg.width), Leg("P", "sell", at), Leg("C", "sell", at), Leg("C", "buy", at + cw))
    elif structure == "bull_call_debit":
        at = round(spot / step) * step
        legs = (Leg("C", "buy", at), Leg("C", "sell", at + cw))
    elif structure == "bear_put_debit":
        at = round(spot / step) * step
        legs = (Leg("P", "buy", at), Leg("P", "sell", at - cfg.width))
    else:
        raise ValueError(f"Unknown structure {structure}")
    if not legs or any(_at(chain, l.right, l.strike) is None for l in legs):
        return None
    return legs


def resolve(cfg: Config, direction: str) -> str | None:
    """The structure to trade today; None for no trade."""
    if cfg.structure == "directional_debit":
        return {"bullish": "bull_call_debit", "bearish": "bear_put_debit"}.get(direction)
    if cfg.structure != "directional":
        return cfg.structure
    if direction == "bullish":
        return "bull_put"
    if direction == "bearish":
        return "bear_call"
    return None if cfg.neutral_trade == "none" else cfg.neutral_trade


def grid(**axes) -> list[Config]:
    """Every combination of the given settings, e.g. grid(short_delta=[0.1, 0.15], width=[1, 2])."""
    import itertools  # noqa: PLC0415
    names = list(axes)
    return [Config(**dict(zip(names, combo))) for combo in itertools.product(*(axes[n] for n in names))]


__all__ = ["Config", "Leg", "STRUCTURES", "grid", "legs_for", "resolve", "field"]
