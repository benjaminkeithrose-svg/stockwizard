// Trading (Menu, Trading; Ben, 19 Nov 2026): what's running in the market, the orders as a
// broker lists them, and how it's going. Three tabs: Now (automated strategies switched on,
// open positions with their value now), Orders (Working, Filled, Closed, Not traded) and
// Results (profit and loss over time, by strategy). Approving, rejecting and closing stay
// in Safety and orders. Values of open positions are theoretical (Black-Scholes) estimates.

import { useEffect, useMemo, useState } from "react";
import type { Candles } from "../data/candles";
import { BotStrategy, PaperOrder, SafetyLimits } from "../data/model";
import { expiryLabel, Structure, structureLabel } from "../data/options";
import { historicalVol } from "../data/pricing";
import { cachedCandles, Store } from "../data/store";
import { byTab, closedAt, closing, OrderTab, openValue, results } from "../data/trading";
import { isTested } from "../data/bots";
import Graph from "./Graph";
import PcStatusLine from "./PcStatusLine";
import { Info, Sheet } from "./parts";

const SYD = "Australia/Sydney";
const when = (iso: string | null | undefined) => (iso ? new Intl.DateTimeFormat("en-AU", { timeZone: SYD, day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(iso)) : "—");
const money = (v: number | null | undefined, signed = true) => (typeof v === "number"
  ? `${signed ? (v > 0 ? "+" : v < 0 ? "−" : "") : v < 0 ? "−" : ""}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—");
const price = (o: PaperOrder, v: number | null | undefined) => (typeof v === "number" ? `${v.toFixed(2)} ${o.price_kind}` : "—");
const label = (o: PaperOrder) => `${structureLabel(o.structure as Structure)} · ${o.symbol} · ${expiryLabel(o.expiry)}`;
const STATUS: Record<string, string> = {
  proposed: "Waiting for you", approved: "Approved, checking again", sent: "At the broker", filled: "Open", closed: "Closed",
  refused: "Refused by the limits", rejected: "You rejected it", cancelled: "Cancelled", failed: "Failed",
};
const TABS: [OrderTab, string][] = [["working", "Working"], ["filled", "Filled"], ["closed", "Closed"], ["nottraded", "Not traded"]];

type Market = Record<string, { spot: number; vol: number }>;

/** The latest close and a volatility for each symbol with an open position: the VIX for the index funds, else 20 days' moves. */
function useMarket(store: Store, symbols: string[]): Market {
  const [m, setM] = useState<Market>({});
  const key = symbols.slice().sort().join(",");
  useEffect(() => {
    if (!symbols.length) return;
    let on = true;
    const last = (c: Candles) => c.close[c.close.length - 1];
    Promise.all([cachedCandles(store, "^VIX", "1d").catch(() => null), ...symbols.map((s) => cachedCandles(store, s, "1d").catch(() => null))])
      .then(([vix, ...cs]) => {
        if (!on) return;
        const out: Market = {};
        symbols.forEach((s, i) => {
          const c = cs[i];
          if (!c || !c.close.length) return;
          const v = ["SPY", "SPX", "XSP"].includes(s) && vix?.close.length ? last(vix) / 100
            : s === "QQQ" && vix?.close.length ? (last(vix) / 100) * 1.2 : historicalVol(c) ?? 0.25;
          out[s] = { spot: last(c), vol: v };
        });
        setM(out);
      });
    return () => { on = false; };
  }, [store, key]); // eslint-disable-line react-hooks/exhaustive-deps
  return m;
}

function OrderInfo(props: { order: PaperOrder; labels: Record<string, string>; onClose: () => void; onSafety: () => void }) {
  const o = props.order;
  return (
    <Sheet title={label(o)} onClose={props.onClose}>
      <div className="kv">
        <div><span>Status</span><b>{closing(o) ? "Closing: the close is at the broker" : STATUS[o.status] ?? o.status}</b></div>
        <div><span>From</span><b>{o.strategy_id ? props.labels[o.strategy_id] ?? "An automated strategy" : "The chart (by hand)"}</b></div>
        <div><span>Contracts</span><b>{o.quantity}</b></div>
        <div><span>Limit price</span><b>{price(o, o.limit_price)}</b></div>
        <div><span>Filled at</span><b>{price(o, o.fill_price)}</b></div>
        {o.close_price != null && <div><span>Closed at</span><b>{o.close_price.toFixed(2)}</b></div>}
        <div><span>Most it can lose</span><b>{money(o.max_loss, false)}</b></div>
        {o.pnl != null && <div><span>Profit or loss</span><b className={o.pnl >= 0 ? "up" : "down"}>{money(o.pnl)}</b></div>}
        <div><span>Proposed</span><b>{when(o.created_at)}</b></div>
        <div><span>Last change</span><b>{when(o.updated_at)}</b></div>
      </div>
      <h2>Legs</h2>
      <p style={{ margin: "4px 0" }}>{o.legs.map((l) => `${l.side === "buy" ? "Buy" : "Sell"} ${l.qty} ${l.strike} ${l.right === "C" ? "call" : "put"}`).join(" · ")}</p>
      {o.reason && <p className="hint">Why: {o.reason}</p>}
      {o.close_reason && <p className="hint">Closed because: {o.close_reason}</p>}
      {o.refusals.length > 0 && <>{o.refusals.map((r, i) => <p key={i} className="msg warn">{r.why}</p>)}</>}
      <button className="ghost" style={{ marginTop: 10 }} onClick={props.onSafety}>Approve, reject or close it in Safety and orders</button>
    </Sheet>
  );
}

export default function TradingScreen(props: { store: Store; onSafety: () => void }) {
  const { store } = props;
  const [tab, setTab] = useState<"now" | "orders" | "results">("now");
  const [orderTab, setOrderTab] = useState<OrderTab>("working");
  const [orders, setOrders] = useState<PaperOrder[] | null>(null);
  const [strategies, setStrategies] = useState<BotStrategy[]>([]);
  const [limits, setLimits] = useState<SafetyLimits | null>(null);
  const [open, setOpen] = useState<PaperOrder | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = () => Promise.all([store.paperOrders(), store.botStrategies(), store.safetyLimits()])
      .then(([o, s, l]) => { setOrders(o); setStrategies(s); setLimits(l); setError(null); })
      .catch((e) => setError(String(e.message ?? e)));
    load();
    const t = window.setInterval(load, 30_000);
    return () => window.clearInterval(t);
  }, [store]);

  const labels = useMemo(() => Object.fromEntries(strategies.map((s) => [s.id, s.label])), [strategies]);
  const tabs = useMemo(() => byTab(orders ?? []), [orders]);
  const res = useMemo(() => results(orders ?? [], labels), [orders, labels]);
  const market = useMarket(store, [...new Set(tabs.filled.map((o) => o.symbol))]);
  const now = Date.now();
  const running = strategies.filter((s) => s.enabled);
  const waiting = (orders ?? []).filter((o) => o.status === "proposed").length;
  const todayKey = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(iso));
  const today = todayKey(new Date().toISOString());
  const todayPnl = (orders ?? []).filter((o) => o.status === "closed" && typeof o.pnl === "number" && todayKey(closedAt(o)) === today)
    .reduce((a, o) => a + (o.pnl as number), 0);

  const orderCard = (o: PaperOrder) => {
    const mv = o.status === "filled" && market[o.symbol] ? openValue(o, market[o.symbol].spot, market[o.symbol].vol, now) : null;
    return (
      <div key={`${o.id}`} className="card" style={{ borderLeftColor: o.strategy_id ? "#0E7C86" : undefined }}>
        <button className="cmain" onClick={() => setOpen(o)}>
          <div className="t">{label(o)}{o.strategy_id && <span className="badge info" style={{ marginLeft: 6 }}>Auto</span>}</div>
          <div className="meta">
            {closing(o) && orderTab === "working" ? "Closing · " : `${STATUS[o.status] ?? o.status} · `}
            {o.quantity} × {price(o, o.fill_price ?? o.limit_price)}
            {o.status === "closed" ? ` · ${money(o.pnl)} · closed ${when(closedAt(o))}` : ` · ${when(o.created_at)}`}
            {mv && <> · now {money(mv.pnl)} <span className="badge est">estimate</span></>}
          </div>
        </button>
      </div>
    );
  };

  return (
    <div className="list">
      <div className="seg wide" role="tablist" aria-label="Trading">
        {([["now", "Now"], ["orders", "Orders"], ["results", "Results"]] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {error && <div className="msg err" style={{ marginTop: 8 }}>{error}</div>}
      {orders === null && !error && <p className="empty">Loading…</p>}

      {orders !== null && tab === "now" && <>
        <div style={{ marginTop: 10 }}><PcStatusLine store={store} /></div>
        {waiting > 0 && (
          <div className="card" style={{ borderLeftColor: "var(--orange-dk)" }}>
            <button className="cmain" onClick={props.onSafety}>
              <div className="t">{waiting} order{waiting === 1 ? "" : "s"} waiting for you</div>
              <div className="meta">Approve or reject in Safety and orders</div>
            </button>
          </div>
        )}
        <h2>Automated strategies running <Info term="entrytime" /></h2>
        {!running.length ? <p className="empty">None switched on.</p> : running.map((s) => {
          const mine = tabs.filled.filter((o) => o.strategy_id === s.id).length;
          return (
            <div key={s.id} className="card" style={{ borderLeftColor: "#0E7C86" }}>
              <button className="cmain" onClick={props.onSafety}>
                <div className="t">{s.label} <span className={`badge ${isTested(s) ? "ok" : "est"}`}>{isTested(s) ? "Tested" : "Untested"}</span></div>
                <div className="meta">{s.config.instrument} · looks for its trade at {s.config.entry} New York · {mine ? `${mine} open` : "nothing open"}</div>
              </button>
            </div>
          );
        })}
        <h2>Open positions</h2>
        {!tabs.filled.length ? <p className="empty">Nothing open.</p> : tabs.filled.map(orderCard)}
        {tabs.filled.length > 0 && <p className="hint">Value now: theoretical (Black-Scholes, from the last close and the VIX or recent moves), not a quote. <Info term="modelled" /></p>}
      </>}

      {orders !== null && tab === "orders" && <>
        <div className="seg wide" role="tablist" aria-label="Orders" style={{ marginTop: 10 }}>
          {TABS.map(([k, l]) => (
            <button key={k} role="tab" aria-selected={orderTab === k} className={orderTab === k ? "on" : ""} onClick={() => setOrderTab(k)}>
              {l}{tabs[k].length ? ` ${tabs[k].length}` : ""}
            </button>
          ))}
        </div>
        <div style={{ marginTop: 10 }}>
          {!tabs[orderTab].length ? <p className="empty">None.</p> : tabs[orderTab].map(orderCard)}
        </div>
      </>}

      {orders !== null && tab === "results" && <>
        <div className="kv" style={{ marginTop: 10 }}>
          <div><span>Total</span><b className={res.total >= 0 ? "up" : "down"}>{money(res.total)}</b></div>
          <div><span>Closed trades</span><b>{res.trades}</b></div>
          <div><span>Won</span><b>{res.winRate == null ? "—" : `${res.winRate.toFixed(0)}%`}</b></div>
          <div><span>Average win</span><b>{money(res.avgWin)}</b></div>
          <div><span>Average loss</span><b>{money(res.avgLoss)}</b></div>
          <div><span>Best · worst</span><b>{money(res.best)} · {money(res.worst)}</b></div>
          <div><span>Today <Info term="maxday" /></span><b>{money(todayPnl)}{limits?.max_loss_per_day ? ` of −$${limits.max_loss_per_day} limit` : ""}</b></div>
        </div>
        {res.curve.length > 1 ? (
          <Graph label="Profit or loss over time" height={200} xs={res.curve.map((c) => c[0])}
            series={[{ label: "Running total", colour: "#2C6BBF", ys: res.curve.map((c) => c[1]), fill: true }]}
            xFmt={(x) => new Intl.DateTimeFormat("en-AU", { timeZone: SYD, day: "numeric", month: "short" }).format(new Date(x))}
            yFmt={(y) => money(y)} />
        ) : <p className="empty">The graph starts after two closed trades.</p>}
        <h2>By strategy</h2>
        {!res.byStrategy.length ? <p className="empty">No closed trades yet.</p> : res.byStrategy.map((g) => (
          <div key={g.id ?? "hand"} className="card">
            <div className="cmain">
              <div className="t">{g.label}</div>
              <div className="meta">{g.trades} trade{g.trades === 1 ? "" : "s"} · {money(g.total)} · {g.winRate == null ? "—" : `${g.winRate.toFixed(0)}% won`}</div>
            </div>
          </div>
        ))}
        <p className="hint">Paper trading: practice money. Each automated strategy's card in Safety and orders compares its results with its backtest.</p>
      </>}

      {open && <OrderInfo order={open} labels={labels} onClose={() => setOpen(null)} onSafety={() => { setOpen(null); props.onSafety(); }} />}
    </div>
  );
}
