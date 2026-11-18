// Signing in. Stock Wizard is by invitation (Ben, 18 Nov 2026: multi-user): Ben invites
// someone from Supabase, they open the email's link, choose a password here and are in.
// There's no "create an account" here; a forgotten password gets a reset email.

import { useState } from "react";
import type { Store } from "../data/store";

export default function SignIn({ store }: { store: Store }) {
  const [mode, setMode] = useState<"in" | "forgot">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "err" | "info"; text: string } | null>(null);

  const go = async () => {
    setBusy(true);
    setMsg(null);
    try {
      if (mode === "in") await store.signIn(email.trim(), password);
      else {
        await store.resetPassword(email.trim());
        setMsg({ kind: "info", text: "If that email has an account, a link to choose a new password is on its way. Open it on this device." });
        setMode("in");
      }
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="signin">
      <div className="panel">
        <div style={{ fontWeight: 700, fontSize: 17 }}>{mode === "in" ? "Sign in" : "Forgotten your password?"}</div>
        <button className="big" disabled={busy || !email || (mode === "in" && password.length < 6)} onClick={go}>
          {busy ? "Working…" : mode === "in" ? "Sign in" : "Email me a link"}
        </button>
        <div>
          <label htmlFor="email">Email</label>
          <input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && mode === "forgot" && go()} />
        </div>
        {mode === "in" && (
          <div>
            <label htmlFor="password">Password</label>
            <input id="password" type="password" autoComplete="current-password"
              value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && go()} />
          </div>
        )}
        {msg && <div className={`msg ${msg.kind}`}>{msg.text}</div>}
        <button className="link" onClick={() => { setMode(mode === "in" ? "forgot" : "in"); setMsg(null); }}>
          {mode === "in" ? "Forgotten your password?" : "Back to sign in"}
        </button>
        {mode === "in" && <div className="hint">Stock Wizard is by invitation: the invitation email has the link to start.</div>}
      </div>
    </div>
  );
}

/** After an invitation or a reset email: choose the password used to sign in from now on. */
export function SetPassword({ store, why, onDone }: { store: Store; why: "invite" | "recovery"; onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      await store.setPassword(password);
      history.replaceState(null, "", location.pathname + location.search);   // the email's link has done its job
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="signin">
      <div className="panel">
        <div style={{ fontWeight: 700, fontSize: 17 }}>{why === "invite" ? "Welcome to Stock Wizard" : "Choose a new password"}</div>
        <button className="big" disabled={busy || password.length < 8} onClick={go}>{busy ? "Working…" : "Set my password"}</button>
        <div>
          <label htmlFor="newpw">{why === "invite" ? "Choose a password" : "New password"}</label>
          <input id="newpw" type="password" autoComplete="new-password" autoFocus value={password}
            onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && password.length >= 8 && go()} />
          <div className="hint">At least 8 characters. You'll sign in with your email and this password from now on.</div>
        </div>
        {error && <div className="msg err">{error}</div>}
      </div>
    </div>
  );
}
