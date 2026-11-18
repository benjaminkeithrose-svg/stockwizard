// Safety: phase 5's controls. The kill switch first, then the orders waiting
// for Ben, then the limits. The bot checks every limit again before sending
// anything; this screen only sets them and records Ben's decisions. There is
// no live-trading switch here, or anywhere in the app.

import type { TermKey } from "../data/glossary";
import { useEffect, useState } from "react";
import { BotRequest, PaperOrder, SafetyLimits } from "../data/model";
import type { Store } from "../data/store";
import { expiryLabel, legName, structureLabel, Structure } from "../data/options";
import { Sheet, Info } from "./parts";
import StrategiesSection from "./Strategies";
import PcStatusLine from "./PcStatusLine";

const money = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `$${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
const STATUS: Record<PaperOrder["status"], string> = {
  proposed: "Waiting for you", refused: "Refused by the rails", approved: "Approved, checking again", rejected: "Rejected",
  sent: "Sent (paper)", filled: "Filled (paper)", cancelled: "Cancelled", closed: "Closed", failed: "Broker failed",
};
const label = (s: string) => structureLabel(s as Structure);

function Confirm(props: { title: string; body: string; yes: string; danger?: boolean; onYes: () => void; onNo: () => void }) {
  return (
    <Sheet title={props.title} onClose={props.onNo}>
      <p style={{ margin: "4px 0 14px" }}>{props.body}</p>
      <div style={{ display: "flex", gap: 10 }}>
        <button className="ghost" autoFocus onClick={props.onNo}>Cancel</button>
        <button className="ghost" style={props.danger ? { color: "var(--warn)", borderColor: "var(--warn)" } : undefined} onClick={props.onYes}>{props.yes}</button>
      </div>
    </Sheet>
  );
}

function OrderSheet(props: { order: PaperOrder; killed: boolean; onDecide: (approve: boolean) => void; onClose: () => void; onClose2: () => void }) {
  const o = props.order;
  const [closing, setClosing] = useState(false);
  return (
    <Sheet title={`${label(o.structure)} on ${o.symbol}`} onClose={props.onClose}>
      {o.status === "proposed" && (
        props.killed
          ? <p className="msg err">The kill switch is on: nothing can be approved.</p>
          : <button className="big" onClick={() => props.onDecide(true)}>Approve (paper)</button>
      )}
      <p className="hint">{STATUS[o.status]}{o.reason ? ` · ${o.reason}` : ""}</p>
      <div className="kv">
        <div><span>Expiry</span><b>{expiryLabel(o.expiry)}</b></div>
        <div><span>Quantity</span><b>{o.quantity}</b></div>
        <div><span>Limit price</span><b>{money(o.limit_price)} {o.price_kind}</b></div>
        <div><span>Most it can lose</span><b>{money(o.max_loss)}</b></div>
        {o.pnl !== null && <div><span>Profit or loss</span><b>{money(o.pnl)}</b></div>}
      </div>
      <h2>Legs</h2>
      {o.legs.map((l, i) => <div key={i} className="hint" style={{ margin: "2px 0" }}>{legName(l)} × {l.qty * o.quantity}</div>)}
      {o.refusals.length > 0 && <><h2>Why it was refused</h2>{o.refusals.map((r, i) => <p key={i} className="msg warn">{r.why}</p>)}</>}
      {o.status === "proposed" && (
        <button className="link" style={{ marginTop: 14 }} onClick={() => props.onDecide(false)}>Reject</button>
      )}
      {o.status === "filled" && <button className="ghost" style={{ marginTop: 14 }} onClick={() => setClosing(true)}>Close (paper)</button>}
      {closing && (
        <Confirm title="Close this position?" yes="Close it"
          body={`Your PC closes the ${label(o.structure)} on ${o.symbol} at its current theoretical price, the next time it runs. The profit or loss counts towards today's limit.`}
          onYes={() => { setClosing(false); props.onClose2(); }} onNo={() => setClosing(false)} />
      )}
      <p className="hint">Approving doesn't send it straight away: your PC checks every limit again first, and refuses it if anything has changed.</p>
    </Sheet>
  );
}

function LimitsSheet(props: { limits: SafetyLimits; onDone: (l: SafetyLimits) => void; onClose: () => void }) {
  const [l, setL] = useState(props.limits);
  const [day, setDay] = useState(props.limits.max_loss_per_day === null ? "" : String(props.limits.max_loss_per_day));
  const [auto, setAuto] = useState(false);
  const field = (k: keyof SafetyLimits, text: string, term: TermKey, step = "1") => (
    <div>
      <label htmlFor={`lim-${k}`}>{text} <Info term={term} /></label>
      <input id={`lim-${k}`} type="number" inputMode="decimal" min="1" step={step} value={String(l[k] ?? "")}
        onChange={(e) => { const v = Number(e.target.value); if (e.target.value !== "" && v > 0) setL({ ...l, [k]: v }); }} />
    </div>
  );
  const done = () => {
    const d = Number(day);
    props.onDone({ ...l, max_loss_per_day: day.trim() === "" || !(d > 0) ? null : d });
    props.onClose();
  };
  return (
    <Sheet title="Limits" onClose={props.onClose} onDone={done}>
      <div className="fields">
        {field("max_loss_per_trade", "Most a trade may lose ($)", "maxtrade")}
        <div>
          <label htmlFor="lim-day">Most a day may lose ($) <Info term="maxday" /></label>
          <input id="lim-day" type="number" inputMode="decimal" min="1" placeholder="Not set" value={day} onChange={(e) => setDay(e.target.value)} />
        </div>
        {field("max_open_positions", "Open positions at once", "positions")}
        {field("max_capital_at_risk", "Capital at risk ($)", "capital")}
        {field("max_data_age_seconds", "Oldest prices allowed (seconds)", "dataage")}
      </div>
      {day.trim() === "" && <p className="msg warn">While the daily limit is empty, every order is refused.</p>}
      <h2>Orders <Info term="approval" /></h2>
      <div className="seg wide" role="group" aria-label="Approval mode">
        <button className={l.approval_mode === "approval" ? "on" : ""} aria-pressed={l.approval_mode === "approval"}
          onClick={() => setL({ ...l, approval_mode: "approval" })}>I approve each one</button>
        <button className={l.approval_mode === "automatic" ? "on" : ""} aria-pressed={l.approval_mode === "automatic"}
          onClick={() => l.approval_mode !== "automatic" && setAuto(true)}>Automatic</button>
      </div>
      <p className="hint">Every change here is written to the audit log.</p>
      {auto && (
        <Confirm title="Automatic orders?" yes="Turn on automatic"
          body="Paper orders that pass every limit will be sent without asking you first. You can switch back at any time."
          onYes={() => { setL({ ...l, approval_mode: "automatic" }); setAuto(false); }} onNo={() => setAuto(false)} />
      )}
    </Sheet>
  );
}

export default function SafetyScreen({ store }: { store: Store }) {
  const [limits, setLimits] = useState<SafetyLimits | null>(null);
  const [orders, setOrders] = useState<PaperOrder[]>([]);
  const [requests, setRequests] = useState<BotRequest[]>([]);
  const [tab, setTab] = useState<"waiting" | "history">("waiting");
  const [open, setOpen] = useState<PaperOrder | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState<"kill" | "resume" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = () => Promise.all([store.safetyLimits(), store.paperOrders(), store.botRequests()])
    .then(([l, o, q]) => { setLimits(l); setOrders(o); setRequests(q.filter((x) => x.status === "waiting")); setError(null); })
    .catch((e) => setError(String(e.message ?? e)));
  useEffect(() => { reload(); }, [store]); // eslint-disable-line react-hooks/exhaustive-deps
  const act = (p: Promise<unknown>) => p.then(reload).catch((e) => setError(String(e.message ?? e)));

  if (!limits) return <div className="list">{error ? <div className="msg err">{error}</div> : <p className="empty">Loading…</p>}</div>;
  const waiting = orders.filter((o) => o.status === "proposed");
  const shown = tab === "waiting" ? waiting : orders.filter((o) => o.status !== "proposed");

  return (
    <div className="list">
      <PcStatusLine store={store} />
      {limits.kill_switch ? (
        <>
          <div className="msg err">The kill switch is on: no new orders, nothing can be approved.</div>
          <button className="ghost" style={{ marginTop: 8 }} onClick={() => setConfirm("resume")}>Turn trading back on</button>
        </>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}><button className="ghost" style={{ color: "var(--warn)", borderColor: "var(--warn)" }} onClick={() => setConfirm("kill")}>Kill switch: stop all trading</button> <Info term="killswitch" /></div>
      )}
      {error && <div className="msg err" style={{ marginTop: 8 }}>{error}</div>}

      <div className="seg wide" role="tablist" aria-label="Orders" style={{ marginTop: 14 }}>
        <button role="tab" aria-selected={tab === "waiting"} className={tab === "waiting" ? "on" : ""} onClick={() => setTab("waiting")}>Waiting ({waiting.length})</button>
        <button role="tab" aria-selected={tab === "history"} className={tab === "history" ? "on" : ""} onClick={() => setTab("history")}>History</button>
      </div>
      <div style={{ marginTop: 10 }}>
        {tab === "waiting" && requests.map((q) => (
          <div key={`q${q.id}`} className="card order requested">
            <div className="cmain" style={{ cursor: "default" }}>
              <div className="t">{q.kind === "open" ? `Order request · ${q.quantity} contract${q.quantity === 1 ? "" : "s"}` : `Close request · order ${q.order_id}`}</div>
              <div className="meta">Waiting for your PC to pick it up</div>
            </div>
          </div>
        ))}
        {!shown.length && !(tab === "waiting" && requests.length) && <p className="empty">{tab === "waiting" ? "Nothing waiting." : "No orders yet."}</p>}
        {shown.map((o) => (
          <div key={o.id} className={`card order ${o.status}`}>
            <button className="cmain" onClick={() => setOpen(o)}>
              <div className="t">{label(o.structure)} · {o.symbol} · {expiryLabel(o.expiry)}</div>
              <div className="meta">{STATUS[o.status]} · can lose {money(o.max_loss)}</div>
            </button>
          </div>
        ))}
      </div>

      <StrategiesSection store={store} onError={setError} />

      <h2>Limits <Info term="maxday" /></h2>
      <div className="card">
        <button className="cmain" onClick={() => setEditing(true)} aria-label="Change limits">
          <div className="t">{money(limits.max_loss_per_trade)} a trade · {limits.max_loss_per_day === null ? "no daily limit set" : `${money(limits.max_loss_per_day)} a day`}</div>
          <div className="meta">
            {limits.max_open_positions} open at once · {money(limits.max_capital_at_risk)} at risk · prices under {limits.max_data_age_seconds}s old · {limits.approval_mode === "approval" ? "you approve each order" : "automatic"}
          </div>
        </button>
      </div>
      {limits.max_loss_per_day === null && <p className="msg warn">The daily loss limit isn't set, so every order is refused. Set it once real spread prices are known.</p>}
      <p className="hint">Paper trading only. Live trading is disabled and can't be turned on from the app. Claude can't change anything on this screen.</p>

      {open && (
        <OrderSheet order={open} killed={limits.kill_switch} onClose={() => setOpen(null)}
          onClose2={() => { act(store.requestClose(open.id)); setOpen(null); }}
          onDecide={(approve) => { act(store.decideOrder(open.id, approve)); setOpen(null); }} />
      )}
      {editing && <LimitsSheet limits={limits} onClose={() => setEditing(false)} onDone={(l) => act(store.saveSafetyLimits(l))} />}
      {confirm === "kill" && (
        <Confirm title="Stop all trading?" yes="Stop all trading" danger
          body={`Blocks every new order and drops ${waiting.length} order${waiting.length === 1 ? "" : "s"} waiting for you; anything working at the broker is cancelled. Recorded in the audit log.`}
          onYes={() => { act(store.killSwitch()); setConfirm(null); }} onNo={() => setConfirm(null)} />
      )}
      {confirm === "resume" && (
        <Confirm title="Turn trading back on?" yes="Turn back on"
          body="Orders may be proposed again, within the limits. Recorded in the audit log."
          onYes={() => { act(store.saveSafetyLimits({ ...limits, kill_switch: false })); setConfirm(null); }} onNo={() => setConfirm(null)} />
      )}
    </div>
  );
}
