// Backtests: the latest saved run of each strategy, build period and
// held-back period side by side. Only held-back and walk-forward results stand
// for expected performance; the build period is where the rules were made.

import { useEffect, useState } from "react";
import type { BacktestRun, BacktestTrade, Metrics, StrategyDef } from "../data/model";
import type { Store } from "../data/store";
import LabView from "./Lab";
import { OptionBacktestList } from "./OptionBacktests";

const num = (v: unknown, digits = 0) =>
  typeof v === "number" && Number.isFinite(v) ? v.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits }) : "—";
const pct = (v: unknown, digits = 0) => (typeof v === "number" ? `${num(v, digits)}%` : "—");
const signedPct = (v: unknown, digits = 1) => (typeof v === "number" ? `${v > 0 ? "+" : ""}${num(v, digits)}%` : "—");
const range = (m: Metrics, key: "targets" | "wins") => {
  const lo = m[`next_100_${key}_low`], hi = m[`next_100_${key}_high`];
  return typeof lo === "number" && typeof hi === "number" ? `${lo}–${hi}` : "—";
};
const date = (iso: string) => new Date(iso).toLocaleDateString("en-AU", { timeZone: "America/New_York", day: "numeric", month: "short", year: "numeric" });
const year = (d: string) => d.slice(0, 4);

function periods(run: BacktestRun) {
  const get = (kind: string) => run.metrics.find((m) => m.kind === kind)?.metrics ?? ({} as Metrics);
  return { build: get("build"), held: get("held_back"), windows: run.metrics.filter((m) => m.kind === "window") };
}

/** The study note shown with every result: what was tested and what wasn't. */
function StudyNote({ s, run }: { s: StrategyDef; run: BacktestRun }) {
  return (
    <>
      {s.config.study && (
        <div className="msg info">
          A signal study: the {s.config.trade_symbol} index itself can't be traded, so there are no costs. Option prices come later.
        </div>
      )}
      {run.source === "yahoo-unofficial" && <div className="msg warn">Free, unofficial data: nothing here counts as validated.</div>}
      {run.held_back_burned && (
        <div className="msg warn">The held-back years were already seen with other settings, so their result is no longer a fair test.</div>
      )}
      {run.warnings.map((w) => <div key={w} className="msg warn">{w}</div>)}
    </>
  );
}

export function BacktestsScreen(props: { store: Store; onOpen: (id: string) => void; onOpenOption: (id: string) => void }) {
  const [tab, setTab] = useState<"strategies" | "options" | "lab">(() => {
    try { const t = localStorage.getItem("stockwizard.btTab"); return t === "lab" || t === "options" ? t : "strategies"; } catch { return "strategies"; }
  });
  useEffect(() => { try { localStorage.setItem("stockwizard.btTab", tab); } catch { /* fine */ } }, [tab]);
  const [strategies, setStrategies] = useState<StrategyDef[]>([]);
  const [runs, setRuns] = useState<Record<string, BacktestRun>>({});
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [error, setError] = useState("");
  useEffect(() => {
    Promise.all([props.store.strategies(), props.store.latestBacktests()])
      .then(([s, r]) => { setStrategies(s); setRuns(r); setState("ok"); })
      .catch((e) => { setError(String(e.message ?? e)); setState("error"); });
  }, [props.store]);

  const tabs = (
    <div className="seg" role="group" aria-label="Backtests or pattern lab" style={{ marginBottom: 10 }}>
      <button className={tab === "strategies" ? "on" : ""} aria-pressed={tab === "strategies"} onClick={() => setTab("strategies")}>Strategies</button>
      <button className={tab === "options" ? "on" : ""} aria-pressed={tab === "options"} onClick={() => setTab("options")}>Options</button>
      <button className={tab === "lab" ? "on" : ""} aria-pressed={tab === "lab"} onClick={() => setTab("lab")}>Pattern lab</button>
    </div>
  );
  if (tab === "lab") return <div className="list">{tabs}<LabView store={props.store} /></div>;
  if (tab === "options") return <div className="list">{tabs}<OptionBacktestList store={props.store} onOpen={props.onOpenOption} /></div>;

  return (
    <div className="list">
      {tabs}
      {state === "loading" && <p className="empty">Loading…</p>}
      {state === "error" && <div className="msg err">Couldn't load the backtests: {error}</div>}
      {state === "ok" && !strategies.length && <p className="empty">No strategies.</p>}
      {strategies.map((s) => {
        const run = runs[s.id];
        const p = run ? periods(run) : null;
        return (
          <div key={s.id} className="card" style={{ borderLeftColor: run?.warnings.length || run?.held_back_burned ? "var(--orange-dk)" : undefined }}>
            <button className="cmain" onClick={() => props.onOpen(s.id)}>
              <div className="t">{s.label}</div>
              {!p ? <div className="meta">Not run yet</div> : (
                <div className="btpair">
                  <div>
                    <div className="btlab">Build {year(run!.start_date)}–{year(run!.split_date)}</div>
                    <div className="btbig">{pct(p.build.target_rate)}</div>
                    <div className="meta">reached target · {num(p.build.trades)} trades</div>
                  </div>
                  <div>
                    <div className="btlab">Held back {year(run!.split_date)}–now</div>
                    <div className="btbig">{pct(p.held.target_rate)}</div>
                    <div className="meta">reached target · {num(p.held.trades)} trades</div>
                  </div>
                </div>
              )}
            </button>
          </div>
        );
      })}
      {state === "ok" && strategies.length > 0 && (
        <p className="hint">Tap a strategy for the full results, the 3-year windows and every trade. Runs are made on the server and saved; each can be repeated exactly.</p>
      )}
    </div>
  );
}

const ROWS: [string, string, (m: Metrics) => string][] = [
  ["Trades", "", (m) => num(m.trades)],
  ["Reached target", "the study's test of working", (m) => pct(m.target_rate)],
  ["Likely range", "targets reached in the next 100 trades", (m) => range(m, "targets")],
  ["Closed up", "by any exit", (m) => pct(m.win_rate)],
  ["Average win", "", (m) => signedPct(m.avg_win_pct)],
  ["Average loss", "", (m) => signedPct(m.avg_loss_pct)],
  ["Profit factor", "wins ÷ losses", (m) => num(m.profit_factor, 2)],
  ["Per trade", "average result", (m) => signedPct(m.expectancy_pct, 2)],
  ["Deepest fall", "from a peak, trade by trade", (m) => signedPct(m.max_drawdown_pct)],
  ["Longest losing run", "", (m) => num(m.longest_losing_streak)],
  ["Time in a trade", "", (m) => pct(m.time_in_market_pct)],
  ["Days held", "average", (m) => num(m.avg_bars_held, 1)],
  ["Exits", "target / stop / time", (m) => (m.exits ? `${m.exits.target ?? 0} / ${m.exits.stop ?? 0} / ${m.exits.time ?? 0}` : "—")],
];

export function BacktestScreen(props: { store: Store; id: string }) {
  const [s, setS] = useState<StrategyDef | null>(null);
  const [run, setRun] = useState<BacktestRun | null>(null);
  const [trades, setTrades] = useState<BacktestTrade[] | null>(null);
  const [error, setError] = useState("");
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    Promise.all([props.store.strategies(), props.store.latestBacktests()])
      .then(([ss, rr]) => {
        setS(ss.find((x) => x.id === props.id) ?? null);
        const r = rr[props.id] ?? null;
        setRun(r);
        if (r) props.store.backtestTrades(r.id).then(setTrades).catch((e) => setError(String(e.message ?? e)));
      })
      .catch((e) => setError(String(e.message ?? e)));
  }, [props.store, props.id]);

  if (error) return <div className="list"><div className="msg err">Couldn't load this backtest: {error}</div></div>;
  if (!s) return <div className="list"><p className="empty">Loading…</p></div>;
  if (!run) return <div className="list"><p className="empty">Not run yet.</p></div>;
  const p = periods(run);
  const shown = trades ? (showAll ? [...trades].reverse() : [...trades].reverse().slice(0, 25)) : [];

  return (
    <div className="list">
      {s.notes && <p className="hint" style={{ marginTop: 0 }}>{s.notes}. Signal on {s.config.signal_symbol}, entered at the next day's open.</p>}
      <StudyNote s={s} run={run} />

      <h2>Results</h2>
      <table className="bt">
        <thead>
          <tr><th /><th>Build<br /><span>{year(run.start_date)}–{year(run.split_date)}</span></th><th>Held back<br /><span>{year(run.split_date)}–now</span></th></tr>
        </thead>
        <tbody>
          {ROWS.map(([label, sub, f]) => (
            <tr key={label}>
              <td>{label}{sub && <span>{sub}</span>}</td>
              <td>{f(p.build)}</td>
              <td>{f(p.held)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="hint">Only the held-back column stands for what to expect: the build years are where the rules were made.</p>

      <h2>3-year windows</h2>
      <table className="bt">
        <thead><tr><th>Years</th><th>Trades</th><th>Target</th><th>Closed up</th></tr></thead>
        <tbody>
          {p.windows.map((w) => (
            <tr key={w.period}>
              <td>{year(w.period)}–{year(w.period.split("..")[1])}<span>{w.metrics.period === "build" ? "build" : w.metrics.period === "held_back" ? "held back" : "both"}</span></td>
              <td>{num(w.metrics.trades)}</td>
              <td>{pct(w.metrics.target_rate)}</td>
              <td>{pct(w.metrics.win_rate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="hint">One lucky stretch shouldn't carry the result: look for the rate holding up window to window.</p>

      <h2>Trades{trades ? ` · ${trades.length}` : ""}</h2>
      {!trades && <p className="empty">Loading…</p>}
      {shown.map((t) => (
        <div key={t.n} className="card" style={{ borderLeftColor: t.exit_reason === "target" ? "var(--ok)" : t.exit_reason === "stop" ? "var(--orange-dk)" : undefined }}>
          <div className="cmain" style={{ cursor: "default" }}>
            <div className="t">{date(t.entry_ts)} · {t.exit_reason === "open" ? "still open" : signedPct(t.return_pct)}</div>
            <div className="meta">
              {s.config.trade_symbol} {num(t.entry_price, 2)} → {t.exit_price === null ? "—" : num(t.exit_price, 2)}
              {" · "}{t.exit_reason === "target" ? "reached target" : t.exit_reason === "stop" ? "stopped" : t.exit_reason === "time" ? "time limit" : "open"}
              {" · "}{t.bars} day{t.bars === 1 ? "" : "s"}{" · "}{t.period === "build" ? "build" : "held back"}
            </div>
          </div>
        </div>
      ))}
      {trades && trades.length > 25 && !showAll && <button className="link" onClick={() => setShowAll(true)}>Show all {trades.length} trades</button>}

      <p className="hint">
        Run {run.id} on {date(run.ran_at)}, candles to {date(run.as_of)}.
        {run.skipped.already_in_trade ? ` ${run.skipped.already_in_trade} signals came while a trade was open and were skipped.` : ""}
        {run.skipped.already_past_target ? ` ${run.skipped.already_past_target} signals came with the price already past the target and were skipped.` : ""}
      </p>
    </div>
  );
}
