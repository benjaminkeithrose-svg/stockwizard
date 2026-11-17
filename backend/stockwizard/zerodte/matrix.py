"""The experiment matrix and the validation steps (the brief's section 11).

1. Development period: every strategy in the grid is run. Each gets a
   one-sided test that its average trade beats zero, and the
   Benjamini-Hochberg false-discovery check runs across *everything tried*,
   so a lucky winner among hundreds doesn't pass.
2. Validation period: only the survivors are run on it, once.
3. Walk-forward: the validation period cut into blocks; a survivor should make
   money in most of them, not in one lucky stretch.
4. Final untouched period: run only when asked (final=True). Once seen, any
   change to the grid means it's no longer a fair test, so the report says
   when it was used.

The ranking never uses win rate alone: survivors are ranked by validation
expectancy, and every table shows the worst trade and the drawdown beside it.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import date

from . import engine, stats
from .strategy import Config


@dataclass(frozen=True)
class Periods:
    start: date
    dev_end: date          # development: start .. dev_end
    val_end: date          # validation: after dev_end .. val_end
    end: date              # final untouched: after val_end .. end


def _between(trades, lo, hi):
    return [t for t in trades if lo < t.day <= hi] if lo else [t for t in trades if t.day <= hi]


def _blocks(trades, lo: date, hi: date, n: int = 4) -> list[float]:
    span = (hi - lo).days
    out = []
    for i in range(n):
        a = lo if i == 0 else date.fromordinal(lo.toordinal() + span * i // n)
        b = date.fromordinal(lo.toordinal() + span * (i + 1) // n)
        out.append(round(sum(t.pnl for t in trades if a < t.day <= b), 2))
    return out


def run(configs: list[Config], data: dict, periods: Periods, q: float = 0.10, final: bool = False, progress=None) -> dict:
    """`data`: what engine.run needs per instrument: bars, bar_minutes, quotes, vol_at, vix_prev, atr_prev."""
    rows = []
    for i, cfg in enumerate(configs):
        d = data[cfg.instrument]
        res = engine.run(cfg, d["bars"], d["bar_minutes"], d["quotes"], d["vol_at"], d["vix_prev"], d["atr_prev"], periods.start, periods.end)
        trades = res["trades"]
        dev = [t for t in trades if t.day <= periods.dev_end]
        rows.append({"config": cfg, "trades": trades, "skipped": res["skipped"], "dev": stats.summary(dev)})
        if progress:
            progress(i + 1, len(configs))
    p_values = [r["dev"].get("p_value", 1.0) if r["dev"]["trades"] >= 20 else 1.0 for r in rows]
    passed = stats.benjamini_hochberg(p_values, q)
    survivors = []
    for r, ok in zip(rows, passed):
        r["survived"] = bool(ok and (r["dev"].get("expectancy") or 0) > 0)
        if r["survived"]:
            val = _between(r["trades"], periods.dev_end, periods.val_end)
            r["validation"] = stats.summary(val)
            r["walk_forward"] = _blocks(val, periods.dev_end, periods.val_end)
            r["by_regime"] = stats.by_regime(val)
            if final:
                r["final"] = stats.summary(_between(r["trades"], periods.val_end, periods.end))
            survivors.append(r)
    survivors.sort(key=lambda r: r["validation"].get("expectancy") or -1e9, reverse=True)
    best_dev = sorted(rows, key=lambda r: r["dev"].get("expectancy") if r["dev"]["trades"] else -1e9, reverse=True)[:10]
    for r in best_dev:
        if "validation" not in r:
            r["validation_unseen"] = True
    return {
        "tried": len(rows),
        "with_20_trades": sum(1 for r in rows if r["dev"]["trades"] >= 20),
        "survivors": survivors,
        "best_in_development": best_dev,
        "q": q,
        "final_used": final,
        "periods": asdict(periods),
        "rows": rows,
    }


def report_markdown(out: dict, title: str, notes: list[str]) -> str:
    p = out["periods"]
    lines = [f"# {title}", "", *[f"- {n}" for n in notes], "",
             f"Periods: development {p['start']} to {p['dev_end']}; validation to {p['val_end']}; final untouched to {p['end']}"
             f" ({'USED in this run' if out['final_used'] else 'not looked at'}).", "",
             f"**Tried {out['tried']} strategies** ({out['with_20_trades']} with at least 20 development trades). "
             f"False-discovery check at q = {out['q']}: **{len(out['survivors'])} survived**.", ""]
    head = "| Strategy | Trades | Won % | Avg a trade | Profit factor | Worst trade | Max drawdown | Months up % | Return on risk % | Typical risk |"
    sep = "|---|---|---|---|---|---|---|---|---|---|"

    def row(r, m):
        cfg = r["config"]
        risk = sorted(t.max_loss for t in r["trades"])[len(r["trades"]) // 2] if r["trades"] else None
        return (f"| {describe(cfg)} | {m.get('trades', 0)} | {m.get('win_rate', '—')} | {m.get('expectancy', '—')} | {m.get('profit_factor') or '—'} | "
                f"{m.get('largest_loss', '—')} | {m.get('max_drawdown', '—')} | {m.get('months_positive_pct', '—')} | {m.get('avg_return_on_risk_pct', '—')} | "
                f"{'$' + format(risk, '.0f') if risk else '—'}{' (fits $50)' if risk and risk <= 50 else ''} |")
    if out["survivors"]:
        lines += ["## Survivors, on the validation period (data they weren't chosen on)", "", head, sep]
        lines += [row(r, r["validation"]) for r in out["survivors"]]
        lines += ["", "Walk-forward (validation in four blocks, dollars): " + "; ".join(f"{describe(r['config'])}: {r['walk_forward']}" for r in out["survivors"][:10]), ""]
    else:
        lines += ["## No strategy survived the false-discovery check", "", "None of the development results is strong enough to be told apart from luck across everything tried.", ""]
    lines += ["## The ten best in development (shown for context: these saw the data they're ranked on)", "", head, sep]
    lines += [row(r, r["dev"]) for r in out["best_in_development"]]
    return "\n".join(lines) + "\n"


def describe(c: Config) -> str:
    parts = [c.instrument, c.structure.replace("_", " "), c.entry, f"Δ{int(c.short_delta * 100)}", f"${c.width:g} wide"]
    if c.call_width is not None and c.call_width != c.width:
        parts.append(f"calls ${c.call_width:g}")
    if c.require_inside_range:
        parts.append("inside opening range")
    if c.vix_min is not None or c.vix_max is not None:
        parts.append(f"VIX {c.vix_min or ''}–{c.vix_max or ''}")
    if c.profit_target:
        parts.append(f"take {int(c.profit_target * 100)}%")
    if c.stop_mult:
        parts.append(f"stop {c.stop_mult:g}×")
    if c.stop_breach:
        parts.append("stop at breach")
    if c.stop_delta:
        parts.append(f"stop Δ{int(c.stop_delta * 100)}")
    if c.exit_time:
        parts.append(f"out by {c.exit_time}")
    return " · ".join(parts)
