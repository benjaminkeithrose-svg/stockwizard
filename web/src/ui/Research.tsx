// The 0DTE tab of the Backtests screen: the latest run of the research matrix
// (backend/stockwizard/run_0dte_research.py). Shows what it is and isn't
// first, then how many strategies were tried and survived the false-discovery
// check, a chart of each survivor's development result against its validation
// result (a strategy that really holds up sits near the diagonal), the
// survivors, and for each its walk-forward blocks and results by regime.

import { useEffect, useMemo, useState } from "react";
import type { ResearchRun, ResearchStrategy } from "../data/model";
import type { Store } from "../data/store";
import { Sheet } from "./parts";

const money = (v: number | null | undefined) =>
  typeof v === "number" ? `${v > 0 ? "+" : v < 0 ? "−" : ""}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: Math.abs(v) < 10 ? 2 : 0 })}` : "—";
const pct = (v: number | null | undefined) => (typeof v === "number" ? `${v.toFixed(0)}%` : "—");
const REGIMES: [string, string][] = [
  ["vix_under_15", "VIX under 15"], ["vix_15_20", "VIX 15–20"], ["vix_20_30", "VIX 20–30"], ["vix_over_30", "VIX over 30"],
  ["session_range", "Range days"], ["session_trending", "Trending days"], ["session_high_volatility", "Wild days"],
  ["fed_day", "Fed days"], ["expiration_friday", "Expiration Fridays"],
  ["direction_bullish", "Bullish at entry"], ["direction_bearish", "Bearish at entry"], ["direction_neutral", "Neutral at entry"],
];

function Scatter({ points, onPick }: { points: { x: number; y: number; label: string; i: number }[]; onPick: (i: number) => void }) {
  const W = 320, H = 240, P = 36;
  const all = points.flatMap((p) => [p.x, p.y]).concat([0]);
  const lo = Math.min(...all), hi = Math.max(...all);
  const pad = (hi - lo) * 0.1 || 10;
  const [a, b] = [lo - pad, hi + pad];
  const X = (v: number) => P + ((v - a) / (b - a)) * (W - P - 8);
  const Y = (v: number) => H - P + 8 - ((v - a) / (b - a)) * (H - P);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Development against validation, a dot per survivor" className="scatter">
      <line x1={X(a)} y1={Y(a)} x2={X(b)} y2={Y(b)} stroke="#9A9B9D" strokeDasharray="4 4" />
      <line x1={X(0)} y1={8} x2={X(0)} y2={H - P + 8} stroke="#DADDE1" />
      <line x1={P} y1={Y(0)} x2={W - 8} y2={Y(0)} stroke="#DADDE1" />
      <text x={W - 10} y={Y(b) + 12} fontSize="9" textAnchor="end" fill="#77787A">held up</text>
      <text x={P + 2} y={H - 4} fontSize="9" fill="#77787A">Development, average a trade →</text>
      <text x={10} y={14} fontSize="9" fill="#77787A">Validation ↑</text>
      {points.map((p) => (
        <circle key={p.i} cx={X(p.x)} cy={Y(p.y)} r={4} fill={p.y > 0 ? "#237F35" : "#B2232F"} fillOpacity={0.6}
          style={{ cursor: "pointer" }} onClick={() => onPick(p.i)}><title>{p.label}</title></circle>
      ))}
    </svg>
  );
}

function Bars({ values }: { values: number[] }) {
  const max = Math.max(1, ...values.map(Math.abs));
  return (
    <div className="wfbars" role="img" aria-label={`Walk-forward blocks: ${values.map((v) => money(v)).join(", ")}`}>
      {values.map((v, i) => (
        <div key={i} className="wfbar">
          <div className="wftrack">
            <i style={{ height: `${(Math.abs(v) / max) * 50}%`, background: v >= 0 ? "#237F35" : "#B2232F", [v >= 0 ? "bottom" : "top"]: "50%" }} />
          </div>
          <span>{money(v)}</span>
        </div>
      ))}
    </div>
  );
}

function StrategySheet({ s, onClose }: { s: ResearchStrategy; onClose: () => void }) {
  const rows: [string, (m: ResearchStrategy["development"]) => string][] = [
    ["Trades", (m) => String(m?.trades ?? "—")], ["Won", (m) => pct(m?.win_rate)], ["Average a trade", (m) => money(m?.expectancy)],
    ["Profit factor", (m) => (m?.profit_factor == null ? "—" : String(m.profit_factor))], ["Worst trade", (m) => money(m?.largest_loss)],
    ["Deepest drawdown", (m) => money(m?.max_drawdown)], ["Months up", (m) => pct(m?.months_positive_pct)],
    ["Return on risk", (m) => pct(m?.avg_return_on_risk_pct)], ["Sharpe", (m) => (m?.sharpe == null ? "—" : String(m.sharpe))],
  ];
  return (
    <Sheet title="Strategy" onClose={onClose}>
      <p style={{ marginTop: 0 }}><b>{s.strategy}</b></p>
      <div className="cmptable" role="table" aria-label="Development and validation">
        <div role="row" className="head"><span role="columnheader" /><span role="columnheader">Development</span><span role="columnheader">Validation</span></div>
        {rows.map(([n, f]) => <div role="row" key={n}><span role="rowheader">{n}</span><span role="cell">{f(s.development)}</span><span role="cell">{f(s.validation)}</span></div>)}
      </div>
      {s.walk_forward && (
        <>
          <h2>Validation in four blocks</h2>
          <Bars values={s.walk_forward} />
          <p className="hint">A strategy that really works makes money in most blocks, not in one lucky stretch.</p>
        </>
      )}
      {s.by_regime && (
        <>
          <h2>By market conditions (validation)</h2>
          <div className="cmptable" role="table" aria-label="By regime">
            <div role="row" className="head"><span role="columnheader" /><span role="columnheader">Trades</span><span role="columnheader">Won</span><span role="columnheader">Average</span></div>
            {REGIMES.filter(([k]) => s.by_regime![k]).map(([k, name]) => {
              const m = s.by_regime![k];
              return <div role="row" key={k}><span role="rowheader">{name}</span><span role="cell">{m.trades}</span><span role="cell">{pct(m.win_rate)}</span><span role="cell">{money(m.expectancy)}</span></div>;
            })}
          </div>
        </>
      )}
    </Sheet>
  );
}

export default function ResearchView({ store }: { store: Store }) {
  const [run, setRun] = useState<ResearchRun | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<ResearchStrategy | null>(null);
  const [shown, setShown] = useState(15);
  useEffect(() => { store.latestResearch().then(setRun).catch((e) => setError(String(e.message ?? e))); }, [store]);
  const points = useMemo(() => (run?.result.survivors ?? []).map((s, i) => ({ x: s.development?.expectancy ?? 0, y: s.validation?.expectancy ?? 0, label: s.strategy, i })), [run]);

  if (error) return <div className="msg err">Couldn't load the research: {error}</div>;
  if (run === undefined) return <p className="empty">Loading…</p>;
  if (run === null) return <p className="empty">No research run yet.</p>;
  const r = run.result;
  const held = r.survivors.filter((s) => (s.validation?.expectancy ?? 0) > 0).length;
  return (
    <>
      {run.modelled && <div className="msg warn"><b>Modelled option prices: not evidence.</b> These results mostly reflect the model's own assumptions. Real quotes are needed before any of it means anything.</div>}
      <details className="notes"><summary>What this run is and isn't</summary><ul>{r.notes.map((n) => <li key={n}>{n.replace(/\*\*/g, "")}</li>)}</ul></details>
      <div className="kv">
        <div><span>Strategies tried</span><b>{r.tried}</b></div>
        <div><span>Passed the false-discovery check</span><b>{r.survivors.length}</b></div>
        <div><span>Then made money in validation</span><b>{held}</b></div>
        <div><span>Final untouched period</span><b>{r.final_used ? "Used" : "Not looked at"}</b></div>
      </div>
      <p className="hint">Development {r.periods.start} to {r.periods.dev_end}; validation to {r.periods.val_end}; final period to {r.periods.end}.</p>
      {points.length > 0 && (
        <>
          <h2>Did they hold up?</h2>
          <Scatter points={points} onPick={(i) => setOpen(r.survivors[i])} />
          <p className="hint">A dot per survivor: its average trade in development (across) against validation (up). Near the dashed line means it held up; below zero means it lost money on data it wasn't chosen on. Tap a dot.</p>
        </>
      )}
      <h2>Survivors, best in validation first</h2>
      {r.survivors.slice(0, shown).map((s) => (
        <div key={s.strategy} className="card" style={{ borderLeftColor: (s.validation?.expectancy ?? 0) > 0 ? "#237F35" : "var(--warn)" }}>
          <button className="cmain" onClick={() => setOpen(s)}>
            <div className="t">{s.strategy}</div>
            <div className="meta">Validation {money(s.validation?.expectancy)} a trade · {pct(s.validation?.win_rate)} won · worst {money(s.validation?.largest_loss)}</div>
          </button>
        </div>
      ))}
      {r.survivors.length > shown && <button className="ghost" onClick={() => setShown(shown + 25)}>Show more ({r.survivors.length - shown} left)</button>}
      {open && <StrategySheet s={open} onClose={() => setOpen(null)} />}
    </>
  );
}
