// The options analysis screen: what a structure on the chart could make or
// lose, across prices and over time, on theoretical (Black-Scholes) prices
// until Interactive Brokers supplies real quotes. Up to three structures can
// be compared on one graph: the same one at other expiries, or others placed
// on the symbol. Built in Stock Wizard's own style.

import { useEffect, useMemo, useState } from "react";
import type { Candles } from "../data/candles";
import { cachedCandles, Store } from "../data/store";
import { newId } from "../data/model";
import { expiryLabel, legName, OptionPosition, structureLabel } from "../data/options";
import { analyse, decayCurve, expiryTime, historicalVol, pnlCurve } from "../data/pricing";
import Graph, { Marker, Series } from "./Graph";
import { ExpiryChips } from "./OptionSheets";
import { Sheet, Info } from "./parts";

const COLOURS = ["#7A3E9D", "#00708D", "#E36C00"];
export const MAX_COMPARE = 3;
const DAY = 86400;

/** Dollars: whole dollars from $10 up, cents below, so small amounts don't all read "$0". */
const dollars = (v: number) => Math.abs(v) < 0.005 ? "0" : Math.abs(v).toLocaleString(undefined, Math.abs(v) >= 10 ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (v: number | null) => (v === null ? "Unlimited" : `${v < 0 ? "−" : ""}$${dollars(v)}`);
const signed = (v: number) => `${v > 0.005 ? "+" : v < -0.005 ? "−" : ""}$${dollars(v)}`;
const days = (n: number) => `${n} day${n === 1 ? "" : "s"}`;
const pct = (v: number) => `${(v * 100).toFixed(0)}%`;
const dayFmt = new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", timeZone: "America/New_York" });

/** The volatility to start from: the VIX for SPY, otherwise the last 20 days' moves; 20% if neither is known. */
export function defaultVol(symbol: string, under: Candles, vix: Candles | null): { vol: number; source: string } {
  if (symbol === "SPY" && vix?.close.length) return { vol: vix.close[vix.close.length - 1] / 100, source: "VIX" };
  const hv = historicalVol(under);
  if (hv) return { vol: hv, source: "last 20 days' moves" };
  return { vol: 0.2, source: "a default" };
}

function useInputs(store: Store, symbol: string) {
  const [under, setUnder] = useState<Candles | null>(null);
  const [vix, setVix] = useState<Candles | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    cachedCandles(store, symbol, "1d").then((c) => live && setUnder(c)).catch((e) => live && setError(String(e.message ?? e)));
    if (symbol === "SPY") cachedCandles(store, "^VIX", "1d").then((c) => live && setVix(c)).catch(() => live && setVix(null));
    return () => { live = false; };
  }, [store, symbol]);
  return { under, vix, error };
}

function CompareSheet(props: {
  main: OptionPosition; others: OptionPosition[]; taken: string[];
  onAdd: (p: OptionPosition) => void; onClose: () => void;
}) {
  const [expiry, setExpiry] = useState(props.main.expiry);
  const free = props.others.filter((o) => !props.taken.includes(o.id));
  return (
    <Sheet title="Compare with" onClose={props.onClose}>
      <h2>The same {structureLabel(props.main.structure).toLowerCase()}, another expiry</h2>
      <ExpiryChips value={expiry} onChange={setExpiry} />
      <button className="ghost" style={{ marginTop: 10 }} disabled={expiry === props.main.expiry}
        onClick={() => props.onAdd({ ...props.main, id: newId(), expiry, note: "comparison" })}>
        Compare with {expiryLabel(expiry)}
      </button>
      <h2>Another structure on {props.main.symbol}</h2>
      {!free.length && <p className="empty">None placed.</p>}
      {free.map((o) => (
        <div key={o.id} className={`card opt ${o.status}`}>
          <button className="cmain" onClick={() => props.onAdd(o)}>
            <div className="t">{structureLabel(o.structure)} · {expiryLabel(o.expiry)}</div>
            <div className="meta">{o.legs.map((l) => l.strike).join(" / ")}</div>
          </button>
        </div>
      ))}
    </Sheet>
  );
}

function OrderSheet(props: { store: Store; position: OptionPosition; perContract: { price: number; credit: boolean; maxLoss: number | null }; onClose: () => void }) {
  const [qty, setQty] = useState(1);
  const [state, setState] = useState<"idle" | "sending" | "sent" | string>("idle");
  const { price, credit, maxLoss } = props.perContract;
  const send = () => {
    setState("sending");
    props.store.requestOrder(props.position.id, qty).then(() => setState("sent")).catch((e) => setState(String(e.message ?? e)));
  };
  return (
    <Sheet title="Order (paper)" onClose={props.onClose}>
      {state === "sent" ? (
        <>
          <p className="msg ok">Sent to Stock Wizard on your PC. It prices the order and checks every limit; it then waits for you in Trading, under Waiting for you.</p>
          <button className="big" onClick={props.onClose}>Done</button>
        </>
      ) : (
        <>
          <button className="big" disabled={state === "sending"} onClick={send}>Send as a paper order</button>
          <h2>Contracts</h2>
          <div className="seg wide" role="group" aria-label="Contracts">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} className={qty === n ? "on" : ""} aria-pressed={qty === n} onClick={() => setQty(n)}>{n}</button>
            ))}
          </div>
          <div className="kv">
            <div><span>{credit ? "Credit (est.)" : "Debit (est.)"}</span><b>{money(price * qty)}</b></div>
            <div><span>Most it loses</span><b className="down">{money(maxLoss === null ? null : maxLoss * qty)}</b></div>
          </div>
          <p className="hint">Paper only: the pretend broker until Interactive Brokers is connected. Your PC prices it again when it picks it up, checks every limit, and nothing is sent until you approve it.</p>
          {state !== "idle" && state !== "sending" && <p className="msg err">{state}</p>}
        </>
      )}
    </Sheet>
  );
}

export default function AnalysisScreen(props: {
  store: Store; position: OptionPosition; others: OptionPosition[]; onAdjust: () => void;
}) {
  const p = props.position;
  const { under, vix, error } = useInputs(props.store, p.symbol);
  const [now] = useState(() => Date.now() / 1000);
  const [volPts, setVolPts] = useState<number | null>(null);   // the slider, in volatility points; null = the default
  const [dayIdx, setDayIdx] = useState(0);                      // days from now on the date slider
  const [variants, setVariants] = useState<OptionPosition[]>([]);
  const [comparing, setComparing] = useState(false);
  const [ordering, setOrdering] = useState(false);

  const all = [p, ...variants];
  const spot = under?.close.length ? under.close[under.close.length - 1] : null;
  const base = under ? defaultVol(p.symbol, under, vix) : null;
  const vol = volPts !== null ? volPts / 100 : base?.vol ?? 0.2;
  const lastExpiry = Math.max(...all.map((x) => expiryTime(x.expiry)));
  const totalDays = Math.max(0, Math.ceil((lastExpiry - now) / DAY));
  const at = Math.min(now + dayIdx * DAY, lastExpiry);

  const results = useMemo(() => (spot === null ? [] : all.map((x) => ({ p: x, a: analyse(x, spot, vol, now) }))),
    [spot, vol, now, p, variants]); // eslint-disable-line react-hooks/exhaustive-deps

  const graph = useMemo(() => {
    if (spot === null || !results.length) return null;
    const strikes = all.flatMap((x) => x.legs.map((l) => l.strike));
    const em = results[0].a.expectedMove;
    const lo = Math.min(...strikes, spot - 2 * em), hi = Math.max(...strikes, spot + 2 * em);
    const pad = (hi - lo) * 0.12 || spot * 0.05;
    const xs = Array.from({ length: 161 }, (_, i) => lo - pad + ((hi - lo + 2 * pad) * i) / 160);
    const series: Series[] = [];
    const single = results.length === 1;
    results.forEach(({ p: x, a }, i) => {
      const c = COLOURS[i];
      const name = single ? "" : `${structureLabel(x.structure)} ${expiryLabel(x.expiry)} · `;
      series.push({ label: `${name}at expiry`, colour: c, ys: pnlCurve(x, a.entry, xs, Infinity, vol), width: single ? 2.5 : 1.5, fill: i === 0 && single, dashed: !single });
      const t = Math.min(at, expiryTime(x.expiry));
      if (t < expiryTime(x.expiry)) {
        series.push({ label: `${name}${dayIdx === 0 ? "today" : dayFmt.format(new Date(t * 1000))}`, colour: c, ys: pnlCurve(x, a.entry, xs, t, vol), width: single ? 2 : 2.5, dashed: single });
      }
    });
    const markers: Marker[] = [{ x: spot, label: `Now ${spot.toFixed(2)}`, colour: "#222", top: true }];
    results[0].a.breakevens.forEach((b) => markers.push({ x: b, label: `BE ${b.toFixed(1)}`, colour: "#77787A", dashed: true }));
    const emAt = spot * vol * Math.sqrt(Math.max(0, Math.min(at, expiryTime(p.expiry)) - now) / (365 * DAY));
    const band = dayIdx > 0 || results.length ? { from: spot - (dayIdx > 0 ? emAt : em), to: spot + (dayIdx > 0 ? emAt : em), label: "Expected move (1 s.d.)" } : undefined;
    return { xs, series, markers, band };
  }, [results, at, dayIdx, spot, vol]); // eslint-disable-line react-hooks/exhaustive-deps

  const decay = useMemo(() => {
    if (spot === null || !results.length) return null;
    const curves = results.map(({ p: x, a }) => decayCurve(x, spot, a.entry, vol, now, 60));
    const end = Math.max(...curves.map((c) => c[c.length - 1].at));
    const xs = Array.from({ length: 61 }, (_, i) => now + ((end - now) * i) / 60);
    const series: Series[] = curves.map((c, i) => ({
      label: results.length === 1 ? "If the price stays put" : `${structureLabel(results[i].p.structure)} ${expiryLabel(results[i].p.expiry)}`,
      colour: COLOURS[i], fill: i === 0 && results.length === 1,
      ys: xs.map((t) => { const k = c.findIndex((pt) => pt.at >= t); return k < 0 ? c[c.length - 1].pnl : c[k].pnl; }),
    }));
    return { xs, series };
  }, [results, spot, vol, now]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <div className="list"><div className="msg err">Couldn't load {p.symbol}'s candles: {error}</div></div>;
  if (!under || spot === null || !base) return <div className="list"><p className="empty">Loading…</p></div>;
  const expired = expiryTime(p.expiry) <= now;
  const main = results[0].a;

  return (
    <div className="list analysis">
      <div className="anahead">
        <div>
          <div className="t">{structureLabel(p.structure)} · {p.symbol} · {expiryLabel(p.expiry)}</div>
          <div className="meta">{p.legs.map(legName).join(" · ")}</div>
        </div>
        <span className="badge est" title="Black-Scholes prices from the last close and an estimated volatility, until Interactive Brokers supplies real quotes">Theoretical</span>
      </div>
      <div className="anabtns">
        <button className="ghost" onClick={() => setOrdering(true)} disabled={expired}>Order (paper)</button>
        <button className="ghost" onClick={props.onAdjust}>Adjust on the chart</button>
        <button className="ghost" disabled={all.length >= MAX_COMPARE} onClick={() => setComparing(true)}>
          {all.length >= MAX_COMPARE ? `Comparing ${MAX_COMPARE}` : "+ Compare"}
        </button>
      </div>
      {variants.length > 0 && (
        <div className="chips" style={{ marginBottom: 8 }}>
          {variants.map((v, i) => (
            <span key={v.id} className="xchip" style={{ borderColor: COLOURS[i + 1], color: COLOURS[i + 1], background: "#fff" }}>
              <span className="xname">{structureLabel(v.structure)} {expiryLabel(v.expiry)}</span>
              <button className="x" aria-label={`Stop comparing ${structureLabel(v.structure)} ${expiryLabel(v.expiry)}`}
                onClick={() => setVariants(variants.filter((x) => x.id !== v.id))}>×</button>
            </span>
          ))}
        </div>
      )}

      <div className="sliders">
        <label htmlFor="ana-date">
          Date: <b>{dayIdx === 0 ? "today" : dayFmt.format(new Date(at * 1000))}</b>
          {" · "}{days(Math.max(0, Math.ceil((expiryTime(p.expiry) - at) / DAY)))} to expiry
        </label>
        <input id="ana-date" type="range" min={0} max={totalDays} step={1} value={dayIdx} disabled={!totalDays}
          onChange={(e) => setDayIdx(Number(e.target.value))} />
        <label htmlFor="ana-vol">
          Volatility: <b>{(vol * 100).toFixed(0)}%</b>
          {volPts === null ? <> <span className="badge est">from {base.source}</span></> : (
            <> <button className="link" style={{ minHeight: 0, padding: "0 4px" }} onClick={() => setVolPts(null)}>back to {(base.vol * 100).toFixed(0)}% ({base.source})</button></>
          )}
        </label>
        <input id="ana-vol" type="range" min={5} max={100} step={1} value={Math.round(vol * 100)} onChange={(e) => setVolPts(Number(e.target.value))} />
      </div>

      {expired && <p className="msg warn">This expiry has passed: the lines show what it was worth at expiry.</p>}
      {graph && (
        <Graph label="Profit or loss across prices" xs={graph.xs} series={graph.series} height={280} markers={graph.markers}
          band={graph.band} xFmt={(x) => x.toFixed(x < 50 ? 1 : 0)} yFmt={signed} />
      )}

      <div className="kv">
        <div><span>{main.credit ? "Credit (est.)" : "Debit (est.)"}</span><b>{money(Math.abs(main.entry))}</b></div>
        <div><span>Most it makes</span><b className="up">{money(main.maxProfit)}</b></div>
        <div><span>Most it loses</span><b className="down">{money(main.maxLoss)}</b></div>
        <div><span>Chance of profit <Info term="pop" /></span><b>{pct(main.pop)}</b></div>
        <div><span>Break-even{main.breakevens.length > 1 ? "s" : ""}</span><b>{main.breakevens.map((b) => b.toFixed(2)).join(" / ") || "—"}</b></div>
        <div><span>Return on risk</span><b>{main.returnOnRisk === null ? "—" : pct(main.returnOnRisk)}</b></div>
        <div><span>Expected move <Info term="expectedmove" /></span><b>±{main.expectedMove.toFixed(2)}</b></div>
        <div><span>Theta (a day) <Info term="theta" /></span><b>{signed(main.greeks.theta)}</b></div>
        <div><span>Delta <Info term="delta" /></span><b>{main.greeks.delta.toFixed(1)}</b></div>
        <div><span>Vega (1 vol point) <Info term="vega" /></span><b>{signed(main.greeks.vega)}</b></div>
        <div><span>Gamma <Info term="gamma" /></span><b>{main.greeks.gamma.toFixed(2)}</b></div>
        <div><span>Underlying</span><b>{spot.toFixed(2)}</b></div>
      </div>
      <p className="hint">
        Chance of profit is held to expiry, with no adjusting or early exit. Delta and gamma are in shares; theta and vega in dollars.
        Prices are Black-Scholes estimates from the last close; real spreads will differ.
      </p>

      <h2>Time decay <Info term="theta" /></h2>
      {decay && (
        <Graph label="Profit or loss from today to expiry, if the price stays where it is" xs={decay.xs} series={decay.series} height={180}
          xFmt={(t) => dayFmt.format(new Date(t * 1000))} yFmt={signed} />
      )}

      {results.length > 1 && (
        <>
          <h2>Side by side</h2>
          <div className="cmptable" role="table" aria-label="Comparison">
            <div role="row" className="head">
              <span role="columnheader" />
              {results.map(({ p: x }, i) => <span role="columnheader" key={x.id} style={{ color: COLOURS[i] }}>{structureLabel(x.structure)} {expiryLabel(x.expiry)}</span>)}
            </div>
            {([
              ["Days left", ({ p: x }) => String(Math.max(0, Math.ceil((expiryTime(x.expiry) - now) / DAY)))],
              ["Credit / debit", ({ a }) => `${money(Math.abs(a.entry))} ${a.credit ? "cr" : "db"}`],
              ["Most it makes", ({ a }) => money(a.maxProfit)],
              ["Most it loses", ({ a }) => money(a.maxLoss)],
              ["Chance of profit", ({ a }) => pct(a.pop)],
              ["Return on risk", ({ a }) => (a.returnOnRisk === null ? "—" : pct(a.returnOnRisk))],
              ["Theta (a day)", ({ a }) => signed(a.greeks.theta)],
              ["Break-evens", ({ a }) => a.breakevens.map((b) => b.toFixed(1)).join(" / ") || "—"],
            ] as [string, (r: (typeof results)[number]) => string][]).map(([name, f]) => (
              <div role="row" key={name}>
                <span role="rowheader">{name}</span>
                {results.map((r) => <span role="cell" key={r.p.id}>{f(r)}</span>)}
              </div>
            ))}
          </div>
        </>
      )}

      {ordering && (
        <OrderSheet store={props.store} position={p} onClose={() => setOrdering(false)}
          perContract={{ price: Math.abs(main.entry), credit: main.credit, maxLoss: main.maxLoss }} />
      )}
      {comparing && (
        <CompareSheet main={p} others={props.others.filter((o) => o.id !== p.id)} taken={variants.map((v) => v.id)}
          onClose={() => setComparing(false)} onAdd={(v) => { setVariants([...variants, v]); setComparing(false); }} />
      )}
    </div>
  );
}
