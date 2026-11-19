// Updates and what's new (Menu): one Update button for everything (Ben, 19 Nov 2026), then what
// changed lately. It checks both pieces each time it opens: the app (a newer build published?)
// and, inside the PC program, Stock Wizard itself (a newer release?), and updates whichever is
// behind with one press (data/updating.ts). The PC program's update waits for the US close.

import { useEffect, useState } from "react";
import { APP_BUILD } from "../config";
import { checkUpdates, plan, updateEverything, UpdateState } from "../data/updating";
import { WHATS_NEW } from "../data/whatsnew";

export default function WhatsNewScreen() {
  const [state, setState] = useState<UpdateState | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err" | "info"; text: string } | null>(null);

  const check = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const s = await checkUpdates();
      setState(s);
      if (s.pc?.error) setMsg({ kind: "err", text: `Couldn't check Stock Wizard's updates: ${s.pc.error}` });
    } finally { setBusy(false); }
  };
  useEffect(() => { check(); }, []);

  const p = state ? plan(state) : null;
  const go = async () => {
    if (!state) return;
    setBusy(true);
    const err = await updateEverything(state);
    setBusy(false);
    setMsg(err ? { kind: "err", text: err } : { kind: "info", text: p?.note ?? "Updating…" });
  };

  return (
    <div className="list">
      {!p ? <button className="big" disabled>Checking for updates…</button>
        : p.can ? <button className="big" disabled={busy} onClick={go}>{p.label}</button>
        : <button className="big" disabled={busy} onClick={check}>{busy ? "Checking…" : `${p.label} · check again`}</button>}
      {p?.note && !msg && <p className="hint">{p.note}</p>}
      {msg && <div className={`msg ${msg.kind}`} style={{ marginTop: 10 }}>{msg.text}</div>}
      <p className="hint">
        App build {APP_BUILD}{state?.pc?.current ? ` · Stock Wizard ${state.pc.current} on this PC` : ""}.
        {state?.pc ? " On the PC, both the app and Stock Wizard update with this one button." : " The app checks for a newer build each time this opens."}
      </p>
      {WHATS_NEW.map((n) => (
        <section key={n.build}>
          <h2>{n.date} · {n.build}{n.build === APP_BUILD ? " · this version" : ""}</h2>
          <ul className="steps">{n.items.map((i) => <li key={i}>{i}</li>)}</ul>
        </section>
      ))}
    </div>
  );
}
