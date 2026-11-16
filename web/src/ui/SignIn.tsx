import { useState } from "react";
import type { Store } from "../data/store";

export default function SignIn({ store }: { store: Store }) {
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "err" | "info"; text: string } | null>(null);

  const go = async () => {
    setBusy(true);
    setMsg(null);
    try {
      if (mode === "in") await store.signIn(email.trim(), password);
      else if ((await store.signUp(email.trim(), password)) === "check-email") {
        setMsg({ kind: "info", text: "Check your email and open the link Supabase sent, then sign in here." });
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
        <div style={{ fontWeight: 700, fontSize: 17 }}>{mode === "in" ? "Sign in" : "Create your account"}</div>
        <button className="big" disabled={busy || !email || password.length < 6} onClick={go}>
          {busy ? "Working…" : mode === "in" ? "Sign in" : "Create account"}
        </button>
        <div>
          <label htmlFor="email">Email</label>
          <input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <label htmlFor="password">Password</label>
          <input id="password" type="password" autoComplete={mode === "in" ? "current-password" : "new-password"}
            value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && go()} />
          {mode === "up" && <div className="hint">At least 6 characters.</div>}
        </div>
        {msg && <div className={`msg ${msg.kind}`}>{msg.text}</div>}
        <button className="link" onClick={() => { setMode(mode === "in" ? "up" : "in"); setMsg(null); }}>
          {mode === "in" ? "First time here? Create your account" : "Already have an account? Sign in"}
        </button>
      </div>
    </div>
  );
}
