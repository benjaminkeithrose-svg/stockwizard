// Safety and limits: phase 5's controls. The kill switch, then the limits (Ben, 19 Nov 2026:
// orders and automated strategies moved to Trading, the one place for them). Stock Wizard on
// the PC checks every limit again before sending anything; this screen only sets them. There
// is no live-trading switch here, or anywhere in the app.

import type { TermKey } from "../data/glossary";
import { useEffect, useState } from "react";
import { SafetyLimits } from "../data/model";
import type { Store } from "../data/store";
import { Sheet, Info } from "./parts";
import PcStatusLine from "./PcStatusLine";

const money = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `$${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}`);

export function Confirm(props: { title: string; body: string; yes: string; danger?: boolean; onYes: () => void; onNo: () => void }) {
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

export default function SafetyScreen({ store, onTrading }: { store: Store; onTrading: () => void }) {
  const [limits, setLimits] = useState<SafetyLimits | null>(null);
  const [waiting, setWaiting] = useState(0);
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState<"kill" | "resume" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = () => Promise.all([store.safetyLimits(), store.paperOrders()])
    .then(([l, o]) => { setLimits(l); setWaiting(o.filter((x) => x.status === "proposed").length); setError(null); })
    .catch((e) => setError(String(e.message ?? e)));
  useEffect(() => { reload(); }, [store]); // eslint-disable-line react-hooks/exhaustive-deps
  const act = (p: Promise<unknown>) => p.then(reload).catch((e) => setError(String(e.message ?? e)));

  if (!limits) return <div className="list">{error ? <div className="msg err">{error}</div> : <p className="empty">Loading…</p>}</div>;

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

      <h2>Limits <Info term="maxday" /></h2>
      <div className="card">
        <button className="cmain" onClick={() => setEditing(true)} aria-label="Change limits">
          <div className="t">{money(limits.max_loss_per_trade)} a trade · {limits.max_loss_per_day === null ? "no daily limit set" : `${money(limits.max_loss_per_day)} a day`}</div>
          <div className="meta">
            {limits.max_open_positions} open at once · {money(limits.max_capital_at_risk)} at risk · prices under {limits.max_data_age_seconds}s old · {limits.approval_mode === "approval" ? "you approve each order" : "automatic"}
          </div>
        </button>
      </div>
      {limits.max_loss_per_day === null && <p className="msg warn">The daily loss limit isn't set, so every order is refused. Set it before trading: tap the card above.</p>}
      <p className="hint">Orders waiting for you, automated strategies and results: <button className="link" onClick={onTrading}>Trading</button>.</p>
      <p className="hint">Paper trading only. Live trading is disabled and can't be turned on from the app. Claude can't change anything on this screen.</p>

      {editing && <LimitsSheet limits={limits} onClose={() => setEditing(false)} onDone={(l) => act(store.saveSafetyLimits(l))} />}
      {confirm === "kill" && (
        <Confirm title="Stop all trading?" yes="Stop all trading" danger
          body={`Blocks every new order and drops ${waiting} order${waiting === 1 ? "" : "s"} waiting for you; anything working at the broker is cancelled. Recorded in the audit log.`}
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
