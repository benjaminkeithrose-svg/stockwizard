// Today: the pre-market checklist from the 0DTE research on one page. Whether
// the US market is open (in Sydney time), the latest snapshot the bot saved
// (price, VIX, VIX1D, expected move, opening range, VWAP, direction), today's
// special days, each switched-on strategy and what it did today, and the
// orders and the day's profit or loss against the limit.

import { useEffect, useState } from "react";
import type { BotStrategy, MarketSnapshot, PaperOrder, SafetyLimits } from "../data/model";
import type { Store } from "../data/store";
import { describeStrategy } from "./Strategies";
import PcStatusLine from "./PcStatusLine";

const NY = "America/New_York", SYD = "Australia/Sydney";
// The Federal Reserve's published announcement days (as in backend/stockwizard/zerodte/calendar.py).
const FOMC = new Set(["2026-01-28", "2026-03-18", "2026-04-29", "2026-06-17", "2026-07-29", "2026-09-16", "2026-10-28", "2026-12-09"]);

const parts = (d: Date, tz: string) => Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
  timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short",
}).formatToParts(d).map((p) => [p.type, p.value]));
const nyDate = (d: Date) => { const p = parts(d, NY); return `${p.year}-${p.month}-${p.day}`; };
const sydTime = (d: Date) => new Intl.DateTimeFormat("en-AU", { timeZone: SYD, weekday: "short", hour: "numeric", minute: "2-digit" }).format(d);

/** The UTC instant of hh:mm New York time on a New York date. */
function nyAt(date: string, hhmm: string): Date {
  const guess = new Date(`${date}T${hhmm}:00Z`);
  const p = parts(guess, NY);
  const offset = (Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00Z`) - guess.getTime()) / 60000;
  return new Date(guess.getTime() - offset * 60000);
}

function session(now: Date): { open: boolean; text: string } {
  const p = parts(now, NY);
  const weekday = !["Sat", "Sun"].includes(p.weekday);
  const mins = Number(p.hour) * 60 + Number(p.minute);
  if (weekday && mins >= 570 && mins < 960) return { open: true, text: `US market open · closes ${sydTime(nyAt(nyDate(now), "16:00"))} Sydney` };
  const d = new Date(`${nyDate(now)}T12:00:00Z`);
  if (!(weekday && mins < 570)) d.setUTCDate(d.getUTCDate() + 1);
  while ([0, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1);
  return { open: false, text: `US market closed · opens ${sydTime(nyAt(d.toISOString().slice(0, 10), "09:30"))} Sydney (9:30 New York)` };
}

const money = (v: number | null | undefined) => (typeof v === "number" ? `${v > 0 ? "+" : v < 0 ? "−" : ""}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}` : "—");

export default function TodayScreen({ store, onSafety }: { store: Store; onSafety: () => void }) {
  const [now, setNow] = useState(() => new Date());
  const [snap, setSnap] = useState<MarketSnapshot | null>(null);
  const [strategies, setStrategies] = useState<BotStrategy[]>([]);
  const [orders, setOrders] = useState<PaperOrder[]>([]);
  const [noTrades, setNoTrades] = useState<{ strategy: string; why: string }[]>([]);
  const [limits, setLimits] = useState<SafetyLimits | null>(null);
  const [error, setError] = useState<string | null>(null);
  const today = nyDate(now);

  useEffect(() => {
    const load = () => Promise.all([store.marketSnapshot("SPY"), store.botStrategies(), store.paperOrders(), store.strategyNoTrades(nyAt(today, "00:00").toISOString()), store.safetyLimits()])
      .then(([s, st, o, nt, l]) => { setSnap(s); setStrategies(st.filter((x) => x.enabled)); setOrders(o); setNoTrades(nt); setLimits(l); setError(null); })
      .catch((e) => setError(String(e.message ?? e)));
    load();
    const t = setInterval(() => { setNow(new Date()); load(); }, 60_000);
    return () => clearInterval(t);
  }, [store, today]);

  const s = session(now);
  const todays = orders.filter((o) => String(o.expiry).slice(0, 10) === today || nyDate(new Date(o.created_at)) === today);
  const waiting = orders.filter((o) => o.status === "proposed").length;
  const closedToday = todays.filter((o) => o.status === "closed" && typeof o.pnl === "number");
  const pnl = closedToday.reduce((a, o) => a + (o.pnl as number), 0);
  const lossToday = closedToday.reduce((a, o) => a + Math.max(0, -(o.pnl as number)), 0);
  const d = new Date(`${today}T12:00:00Z`);
  const tags = [FOMC.has(today) ? "Fed announcement day" : null, d.getUTCDay() === 5 && d.getUTCDate() >= 15 && d.getUTCDate() <= 21 ? "Expiration Friday" : null].filter(Boolean);
  const fresh = snap && snap.session_date === today;

  return (
    <div className="list today">
      <div className={`msg ${s.open ? "ok" : "info"}`}>{s.text}</div>
      <PcStatusLine store={store} />
      {error && <div className="msg err">{error}</div>}
      {tags.length > 0 && <div className="msg warn">Today is a {tags.join(" and ")}: expect bigger moves.</div>}

      <h2>The market {snap ? `· as of ${sydTime(new Date(snap.taken_at))} Sydney` : ""}</h2>
      {!snap ? <p className="empty">No snapshot yet: your PC saves one every 30 seconds during the US session.</p> : (
        <>
          {!fresh && <p className="hint">From the last session ({snap.session_date}).</p>}
          <div className="kv">
            <div><span>SPY</span><b>{snap.price.toFixed(2)}</b></div>
            <div><span>VIX</span><b>{snap.vix?.toFixed(1) ?? "—"}</b></div>
            <div><span>VIX1D</span><b>{snap.vix1d?.toFixed(1) ?? "—"}</b></div>
            <div><span>Expected move to the close</span><b>{snap.expected_move != null ? `±${snap.expected_move.toFixed(2)}` : "—"}</b></div>
            <div><span>Opening range</span><b>{snap.or_low != null ? `${snap.or_low.toFixed(2)} – ${snap.or_high?.toFixed(2)}` : "—"}</b></div>
            <div><span>VWAP</span><b>{snap.vwap?.toFixed(2) ?? "—"}</b></div>
            <div><span>Direction</span><b className={snap.direction === "bullish" ? "up" : snap.direction === "bearish" ? "down" : ""}>{snap.direction ?? "—"}</b></div>
          </div>
          <p className="hint">{snap.source === "ibkr" ? "From Interactive Brokers." : "From the free source's 5-minute candles, which can run a little behind."}</p>
        </>
      )}

      <h2>Strategies today</h2>
      {!strategies.length && <p className="empty">None switched on.</p>}
      {strategies.map((st) => {
        const o = todays.find((x) => x.strategy_id === st.id)
          ?? orders.find((x) => x.strategy_id === st.id && ["proposed", "sent", "filled"].includes(x.status));   // a multi-day position from an earlier day
        const nt = noTrades.find((x) => x.strategy === st.id);
        const entry = nyAt(today, st.config.entry);
        const status = o
          ? (o.status === "closed" ? `Closed ${money(o.pnl)}` : o.status === "proposed" ? "Waiting for your approval" : o.status === "refused" ? `Refused: ${o.refusals[0]?.why ?? ""}` : o.status === "filled" ? `Open (filled)${String(o.expiry).slice(0, 10) > today ? `, expires ${String(o.expiry).slice(0, 10)}` : ""}` : o.status)
          : nt ? `No trade: ${nt.why}` : now < entry ? `Due at ${st.config.entry} New York (${sydTime(entry)} Sydney)` : "No proposal (your PC may not have been running at the entry time)";
        return (
          <div key={st.id} className="card strat" style={{ borderLeftColor: o?.status === "closed" ? ((o.pnl ?? 0) >= 0 ? "#237F35" : "var(--warn)") : undefined }}>
            <div className="cmain" style={{ cursor: "default" }}>
              <div className="t">{st.label}</div>
              <div className="meta">{status}</div>
              <div className="meta">{describeStrategy(st.config)}</div>
            </div>
          </div>
        );
      })}

      <h2>Orders and today's result</h2>
      <div className="kv">
        <div><span>Waiting for you</span><b>{waiting}</b></div>
        <div><span>Today's profit or loss</span><b className={pnl >= 0 ? "up" : "down"}>{money(pnl)}</b></div>
        <div><span>Daily limit used</span><b>{limits?.max_loss_per_day ? `$${lossToday.toFixed(0)} of $${limits.max_loss_per_day}` : "No limit set"}</b></div>
        <div><span>Approval</span><b>{limits?.approval_mode === "automatic" ? "Automatic (paper)" : "You approve each"}</b></div>
      </div>
      <button className="ghost" onClick={onSafety}>Open Safety and orders</button>
    </div>
  );
}
