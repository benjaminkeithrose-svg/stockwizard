// Joint account (Menu, Trading; Ben, 19 Nov 2026): two people working one trading account, each with
// full say. The account is the owner's, whose PC trades it; the partner, on their own install, sees
// and does everything on it (orders, approvals, closes, the kill switch, limits, automated
// strategies) while their own trading is set aside. Charts stay each person's own.

import { useEffect, useState } from "react";
import type { JointAccount, Store } from "../data/store";
import { Info } from "./parts";
import { Confirm } from "./Safety";

export default function JointScreen({ store }: { store: Store }) {
  const [joint, setJoint] = useState<JointAccount | null | undefined>(undefined);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [ending, setEnding] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const load = () => store.jointAccount().then(setJoint).catch((e) => setMsg({ kind: "err", text: String(e.message ?? e) }));
  useEffect(() => { load(); }, [store]); // eslint-disable-line react-hooks/exhaustive-deps

  const add = async () => {
    setBusy(true); setMsg(null);
    try {
      await store.addPartner(email.trim());
      setEmail("");
      setMsg({ kind: "ok", text: "Shared. They now see and work this trading account on their own install." });
      await load();
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : String(e) });
    } finally { setBusy(false); }
  };
  const end = async () => {
    setEnding(false); setBusy(true); setMsg(null);
    try {
      await store.endJoint();
      setMsg({ kind: "ok", text: "The joint account has ended." });
      await load();
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : String(e) });
    } finally { setBusy(false); }
  };

  if (joint === undefined) return <div className="list">{msg ? <div className="msg err">{msg.text}</div> : <p className="empty">Loading…</p>}</div>;

  return (
    <div className="list">
      {!joint ? (
        <>
          <h2>Share your trading account <Info term="joint" /></h2>
          <label className="hint" htmlFor="joint-email">Their sign-in email (someone already invited to Stock Wizard)</label>
          <input id="joint-email" type="email" inputMode="email" autoComplete="off" value={email} placeholder="name@example.com"
            onChange={(e) => setEmail(e.target.value)} style={{ fontSize: 16, width: "100%", minHeight: 40, marginBottom: 8 }} />
          <button className="big" disabled={busy || !email.includes("@")} onClick={add}>{busy ? "Sharing…" : "Share with them"}</button>
          {msg && <div className={`msg ${msg.kind}`} style={{ marginTop: 8 }}>{msg.text}</div>}
          <p className="hint">They get full say on this account: orders, approvals and closes, the kill switch, the limits and the automated strategies. Their own trading is set aside while they're on it. Charts, pages and favourites stay each person's own.</p>
          <p className="hint">Only your PC trades it (one TWS login). Stock Wizard on their PC shows and approves but doesn't trade.</p>
        </>
      ) : (
        <>
          <div className="card" style={{ marginTop: 4 }}>
            <div className="cmain">
              <div className="t">Joint account</div>
              <div className="meta">
                {joint.role === "owner"
                  ? <>Shared with {joint.partnerEmail}. Your PC trades it.</>
                  : <>You're working {joint.ownerEmail}'s account. Their PC trades it; yours shows and approves.</>}
              </div>
              <div className="meta">Since {new Date(joint.since).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</div>
            </div>
          </div>
          {msg && <div className={`msg ${msg.kind}`} style={{ marginTop: 8 }}>{msg.text}</div>}
          <p className="hint">Both of you have full say: every approval, close, kill switch and change of limits or strategies is logged with who did it.</p>
          <button className="link" style={{ color: "var(--warn)", marginTop: 18 }} disabled={busy} onClick={() => setEnding(true)}>
            {joint.role === "owner" ? "Stop sharing" : "Leave this account"}
          </button>
        </>
      )}
      {ending && joint && (
        <Confirm danger title={joint.role === "owner" ? "Stop sharing?" : "Leave this account?"} yes={joint.role === "owner" ? "Stop sharing" : "Leave"}
          body={joint.role === "owner"
            ? `${joint.partnerEmail} will no longer see or work this account's orders, limits or strategies. Nothing is deleted; orders stay as they are.`
            : `You'll no longer see or work ${joint.ownerEmail}'s orders, limits or strategies, and go back to your own. Nothing is deleted.`}
          onYes={end} onNo={() => setEnding(false)} />
      )}
    </div>
  );
}
