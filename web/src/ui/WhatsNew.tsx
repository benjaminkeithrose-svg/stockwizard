// What's new (Menu, What's new): the version, updates, and what changed lately. Inside the
// PC program it shows Stock Wizard's own version and installs an update with one press (the
// same as Update on the icon by the clock); in a browser or on the phone, Get latest version.

import { useEffect, useState } from "react";
import { APP_BUILD } from "../config";
import { pcBridge, PcUpdates } from "../data/pc";
import { getLatestVersion } from "../update";
import { WHATS_NEW } from "../data/whatsnew";

type Bridge = NonNullable<Awaited<ReturnType<typeof pcBridge>>>;

export default function WhatsNewScreen() {
  const [pc, setPc] = useState<Bridge | null | undefined>(undefined);
  const [up, setUp] = useState<PcUpdates | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err" | "info"; text: string } | null>(null);
  useEffect(() => { pcBridge().then((b) => { setPc(b); b?.updates().then(setUp).catch(() => {}); }); }, []);

  const check = async () => {
    if (!pc) return;
    setBusy(true);
    try {
      const u = await pc.check_updates();
      setUp(u);
      setMsg(u.error ? { kind: "err", text: `Couldn't reach GitHub: ${u.error}` } : u.available ? null : { kind: "ok", text: "Stock Wizard is up to date." });
    } finally { setBusy(false); }
  };
  const install = async () => {
    if (!pc) return;
    setBusy(true);
    const r = await pc.install_update();
    setBusy(false);
    setMsg(r.error ? { kind: "err", text: r.error } : { kind: "info", text: "Updating: Stock Wizard closes, installs the update and opens again by itself in a minute or so." });
  };

  return (
    <div className="list">
      {pc && up && up.available ? (
        <button className="big" disabled={busy || !up.can_apply} onClick={install}>
          {up.can_apply ? `Update to ${up.available}` : `Update to ${up.available} after the US close`}
        </button>
      ) : pc ? (
        <button className="big" disabled={busy} onClick={check}>{busy ? "Checking…" : "Check for updates"}</button>
      ) : (
        <button className="big" onClick={() => getLatestVersion()}>Get latest version</button>
      )}
      {msg && <div className={`msg ${msg.kind}`} style={{ marginTop: 10 }}>{msg.text}</div>}
      <p className="hint">
        App build {APP_BUILD}{pc && up?.current ? ` · Stock Wizard ${up.current} on this PC` : ""}.
        {pc ? " The PC checks for updates each time it opens and every 6 hours; updates wait until the US market closes." : ""}
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
