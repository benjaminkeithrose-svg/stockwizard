// Option-structure backtests: iron condors and flies on SPY with modelled
// prices. The list sits in the Backtests screen's Options tab; a strategy
// opens its own page with build and held-back side by side, the running
// profit or loss, and every trade. Only the held-back years stand for what to
// expect, and every price here is modelled until real option fills exist.

import { useEffect, useMemo, useState } from "react";
import type { OptionMetrics, OptionRun, OptionStrategyDef, OptionTradeRow } from "../data/model";
import type { Store } from "../data/store";
import Graph from "./Graph";

const dollars = (v: number | null | undefined, sign = true) =>
  typeof v === "number" ? `${sign && v > 0 ? "+" : v < 0 ? "−" : ""}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: Math.abs(v) < 10 ? 2 : 0 })}` : "—";
const pct = (v: number | null | undefined) => (typeof v === "number" ? `${v.toFixed(0)}%` : "—");
const range = (m: OptionMetrics) => (m.next_100_wins_low === null ? "—" : `${m.next_100_wins_low}–${m.next_100_wins_high}`);
const day = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

function useOptionBacktests(store: Store) {
  const [strategies, setStrategies] = useState<OptionStrategyDef[]>([]);
  const [runs, setRuns] = useState<Record<string, OptionRun>>({});
  const [state, setState] = useState<"loading" | "ok" | string>("loading");
  useEffect(() => {
    Promise.all([store.optionStrategies(), store.latestOptionRuns()])
      .then(([s, r]) => { setStrategies(s); setRuns(r); setState("ok"); })
      .catch((e) => setState(String(e.message ?? e)));
  }, [store]);
  return { strategies, runs, state };
}

function Notes({ run }: { run: OptionRun }) {
  return (
    <>
      <div className="msg info">Modelled option prices (Black-Scholes, the VIX as volatility), with $0.65 a leg commission and 5c a leg slippage each way.</div>
      {run.source === "yahoo-unofficial" && <div className="msg warn">Free, unofficial data: nothing here counts as validated.</div>}
      {run.held_back_burned && <div className="msg warn">The held-back years were already seen with other settings, so their result is no longer a fair test.</div>}
      {run.report.warnings.filter((w) => !w.startsWith("Modelled")).map((w) => <div key={w} className="msg warn">{w}</div>)}
    </>
  );
}

export function OptionBacktestList(props: { store: Store; onOpen: (id: string) => void }) {
  const { strategies, runs, state } = useOptionBacktests(props.store);
  if (state === "loading") return <p className="empty">Loading…</p>;
  if (state !== "ok") return <div className="msg err">Couldn't load the option backtests: {state}</div>;
  if (!strategies.length) return <p className="empty">No option strategies.</p>;
  return (
    <>
      <p className="hint" style={{ marginTop: 0 }}>Modelled prices until real option fills exist. Held back = the last 5 years, the fair test.</p>
      {strategies.map((s) => {
        const r = runs[s.id];
        const warn = r && (r.held_back_burned || r.report.warnings.some((w) => !w.startsWith("Modelled")));
        return (
          <div key={s.id} className="card opt" style={{ borderLeftColor: warn ? "var(--orange-dk)" : undefined }}>
            <button className="cmain" onClick={() => props.onOpen(s.id)}>
              <div className="t">{s.label}</div>
              {!r ? <div className="meta">Not run yet</div> : (
                <div className="meta">
                  Build {pct(r.report.build.win_rate)} won, {dollars(r.report.build.expectancy)} a trade · Held back {pct(r.report.held_back.win_rate)} won, {dollars(r.report.held_back.expectancy)} a trade
                </div>
              )}
            </button>
          </div>
        );
      })}
    </>
  );
}

export function OptionBacktestScreen(props: { store: Store; id: string }) {
  const { strategies, runs, state } = useOptionBacktests(props.store);
  const s = strategies.find((x) => x.id === props.id);
  const run = runs[props.id];
  const [trades, setTrades] = useState<OptionTradeRow[] | null>(null);
  const [shown, setShown] = useState(30);
  useEffect(() => { if (run) props.store.optionTrades(run.id).then(setTrades).catch(() => setTrades([])); }, [run?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const equity = useMemo(() => {
    if (!trades?.length || !run) return null;
    let sum = 0;
    const ys: number[] = [], xs: number[] = [];
    trades.forEach((t, i) => { sum += t.pnl; xs.push(i); ys.push(sum); });
    const split = trades.findIndex((t) => t.entry_day >= run.split_date);
    return { xs, ys, split };
  }, [trades, run]);

  if (state === "loading") return <div className="list"><p className="empty">Loading…</p></div>;
  if (!s || !run) return <div className="list"><p className="empty">{s ? "Not run yet." : "No such strategy."}</p></div>;
  const b = run.report.build, h = run.report.held_back;
  const rows: [string, (m: OptionMetrics) => string][] = [
    ["Trades", (m) => String(m.trades)],
    ["Won", (m) => pct(m.win_rate)],
    ["Likely wins in the next 100", range],
    ["Average a trade", (m) => dollars(m.expectancy)],
    ["Average win", (m) => dollars(m.avg_win)],
    ["Average loss", (m) => dollars(m.avg_loss)],
    ["Worst trade", (m) => dollars(m.worst_trade)],
    ["Total", (m) => dollars(m.total_pnl)],
    ["Deepest drawdown", (m) => dollars(m.max_drawdown)],
    ["Profit factor", (m) => (m.profit_factor === null ? "—" : m.profit_factor.toFixed(2))],
    ["Return on risk, average", (m) => pct(m.avg_return_on_risk)],
    ["Longest losing run", (m) => String(m.longest_losing_streak)],
    ...(s.config.manage === "take_50" ? [["Closed early at 50%", (m: OptionMetrics) => String(m.take_profit_exits)] as [string, (m: OptionMetrics) => string]] : []),
  ];

  return (
    <div className="list">
      <p className="hint" style={{ marginTop: 0 }}>{s.notes}</p>
      <Notes run={run} />
      <div className="cmptable" role="table" aria-label="Build and held back" style={{ marginTop: 10 }}>
        <div role="row" className="head"><span role="columnheader" /><span role="columnheader">Build 2006–2021</span><span role="columnheader">Held back 2021–now</span></div>
        {rows.map(([name, f]) => (
          <div role="row" key={name}><span role="rowheader">{name}</span><span role="cell">{f(b)}</span><span role="cell">{f(h)}</span></div>
        ))}
      </div>
      <p className="hint">One structure (one contract per leg) per trade; one trade at a time. Only the held-back column stands for what to expect.</p>
      {equity && (
        <>
          <h2>Running profit or loss</h2>
          <Graph label="Running total, trade by trade" xs={equity.xs} height={200}
            series={[{ label: "Running total", colour: "#7A3E9D", ys: equity.ys, width: 1.5 }]}
            markers={equity.split > 0 ? [{ x: equity.split, label: "Held back from here", colour: "#E36C00", dashed: true, top: true }] : []}
            xFmt={(x) => (trades![Math.round(x)] ? trades![Math.round(x)].entry_day.slice(0, 4) : "")} yFmt={(y) => dollars(y)} />
        </>
      )}
      <h2>Trades, newest first</h2>
      {!trades && <p className="empty">Loading…</p>}
      {trades && [...trades].reverse().slice(0, shown).map((t, i) => (
        <div key={i} className="card" style={{ borderLeftColor: t.pnl > 0 ? "#237F35" : "var(--warn)" }}>
          <div className="cmain" style={{ cursor: "default" }}>
            <div className="t">{day(t.entry_day)} · {dollars(t.pnl)}</div>
            <div className="meta">
              {t.legs.map((l) => l.strike).join(" / ")} · SPY {t.spot_in.toFixed(2)} → {t.spot_out.toFixed(2)} ·
              {t.credit >= 0 ? ` ${dollars(t.credit * 100, false)} credit` : ` ${dollars(-t.credit * 100, false)} debit`} ·
              {t.exit_reason === "take_profit" ? ` closed at 50% on ${day(t.exit_day)}` : ` settled ${day(t.exit_day)}`}
            </div>
          </div>
        </div>
      ))}
      {trades && trades.length > shown && <button className="ghost" onClick={() => setShown(shown + 50)}>Show 50 more ({trades.length - shown} left)</button>}
    </div>
  );
}
