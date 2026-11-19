// The History section of a structure's analysis (Ben, 19 Nov 2026: test a structure from the chart):
// how the same shape, placed the same way, did on every past day in the daily candles (data/history.ts),
// optionally only on days like today. A rough check on modelled prices, never shown as a tested strategy.

import { useEffect, useMemo, useState } from "react";
import type { Candles } from "../data/candles";
import { cachedCandles, Store } from "../data/store";
import type { OptionPosition } from "../data/options";
import { summarise, testHistory, Likeness } from "../data/history";
import Graph from "./Graph";
import { Info } from "./parts";

const LINKED = ["SPY", "QQQ", "IWM", "NVDA", "AAPL", "TSLA"];
const VIX = "^VIX";
const NEAR = 0.2;

const dollars = (v: number) => `${v < -0.005 ? "−" : v > 0.005 ? "+" : ""}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const dayFmt = new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const fmtDate = (d: string | null) => (d ? dayFmt.format(new Date(`${d}T12:00:00Z`)) : "—");

export default function HistoryTest(props: { store: Store; position: OptionPosition; under: Candles; vix: Candles | null; expired: boolean }) {
  const p = props.position;
  const [run, setRun] = useState(false);
  const [like, setLike] = useState<string[]>([]);                 // "vix" and symbols
  const [loaded, setLoaded] = useState<Record<string, Candles | "error">>({});

  useEffect(() => {
    let live = true;
    for (const k of like) {
      const sym = k === "vix" ? VIX : k;
      if (loaded[sym] || (sym === p.symbol)) continue;
      cachedCandles(props.store, sym, "1d")
        .then((c) => live && setLoaded((m) => ({ ...m, [sym]: c })))
        .catch(() => live && setLoaded((m) => ({ ...m, [sym]: "error" })));
    }
    return () => { live = false; };
  }, [like]); // eslint-disable-line react-hooks/exhaustive-deps

  const candlesOf = (sym: string): Candles | "error" | undefined => (sym === p.symbol ? props.under : sym === VIX && props.vix ? props.vix : loaded[sym]);
  const waiting = like.some((k) => candlesOf(k === "vix" ? VIX : k) === undefined);
  const failed = like.filter((k) => candlesOf(k === "vix" ? VIX : k) === "error");

  const result = useMemo(() => {
    if (!run || waiting) return null;
    const l: Likeness = {};
    const v = like.includes("vix") ? candlesOf(VIX) : undefined;
    if (v && v !== "error") l.vix = { candles: v, within: NEAR };
    l.trends = like.filter((k) => k !== "vix").flatMap((sym) => {
      const c = candlesOf(sym);
      return c && c !== "error" ? [{ symbol: sym, candles: c }] : [];
    });
    const r = testHistory(p, props.under, props.vix, l);
    return { r, s: summarise(r.trades) };
  }, [run, waiting, like.join(","), p, props.under, props.vix, loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (k: string) => setLike(like.includes(k) ? like.filter((x) => x !== k) : [...like, k]);
  const trendWord = (sym: string) => {
    const t = result?.r.today.trends[sym];
    return t === 1 ? " ↑" : t === -1 ? " ↓" : "";
  };

  return (
    <>
      <h2>History <Info term="historytest" /></h2>
      {!run ? (
        <>
          <button className="ghost" disabled={props.expired} onClick={() => setRun(true)}>Test it against the past</button>
          <p className="hint">How often this shape, placed the same way and held to expiry, made money on every past day in {p.symbol}'s daily candles.</p>
        </>
      ) : (
        <>
          <div className="hint" style={{ margin: "0 0 6px" }}>Only days like today</div>
          <div className="chips" style={{ marginBottom: 8 }}>
            <button className={`chip${like.includes("vix") ? " on" : ""}`} aria-pressed={like.includes("vix")} onClick={() => toggle("vix")}>
              VIX near today's{result?.r.today.vix ? ` (${result.r.today.vix.toFixed(0)})` : ""}
            </button>
            {[p.symbol, ...LINKED.filter((s) => s !== p.symbol)].map((sym) => (
              <button key={sym} className={`chip${like.includes(sym) ? " on" : ""}`} aria-pressed={like.includes(sym)} onClick={() => toggle(sym)}
                title={`${sym} on the same side of its 50-day average as today`}>
                {sym} trend{like.includes(sym) ? trendWord(sym) : ""}
              </button>
            ))}
          </div>
          {failed.length > 0 && <p className="msg warn">Couldn't load {failed.map((k) => (k === "vix" ? "the VIX" : k)).join(", ")}: left out.</p>}
          {waiting && <p className="empty">Loading…</p>}
          {result && result.r.sessions < 1 && <p className="msg warn">It needs at least one trading day to expiry.</p>}
          {result && result.r.sessions >= 1 && !result.s && <p className="msg warn">No past days to test{like.length ? " that are like today; switch a chip off" : ""}.</p>}
          {result?.s && (
            <>
              <div className="kv">
                <div><span>Days tested</span><b>{result.s.count.toLocaleString()}</b></div>
                <div><span>Made money</span><b>{(result.s.chance * 100).toFixed(0)}%</b></div>
                <div><span>Average</span><b className={result.s.average >= 0 ? "up" : "down"}>{dollars(result.s.average)}</b></div>
                <div><span>Middle result</span><b>{dollars(result.s.median)}</b></div>
                <div><span>Worst · {fmtDate(result.s.worst.date)}</span><b className="down">{dollars(result.s.worst.pnl)}</b></div>
                <div><span>Best · {fmtDate(result.s.best.date)}</span><b className="up">{dollars(result.s.best.pnl)}</b></div>
              </div>
              <Graph label="Every day's result, worst to best" height={160}
                xs={result.s.sorted.map((_, i) => (result.s!.sorted.length > 1 ? (i / (result.s!.sorted.length - 1)) * 100 : 0))}
                series={[{ label: "Result", colour: "#7A3E9D", ys: result.s.sorted, fill: true, width: 2 }]}
                xFmt={(x) => `${x.toFixed(0)}%`} yFmt={dollars} />
              <p className="hint">
                {fmtDate(result.r.from)} to {fmtDate(result.r.to)}, one contract, {result.r.sessions} trading day{result.r.sessions === 1 ? "" : "s"} to expiry each time.
                Strikes the same number of daily ranges from that day's close; priced with the same model as above ({p.symbol === "SPY" && props.vix ? "the VIX" : "the last 20 days' moves"}),
                $0.65 a leg and 5c slippage; held to expiry. A rough check on modelled prices, not a tested strategy: the days overlap and none are held back.
              </p>
            </>
          )}
        </>
      )}
    </>
  );
}
