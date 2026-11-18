// Bot key (⋯ menu): the key a person's own bot uses to sign in to Stock Wizard
// (multi-user, 18 Nov 2026). The bot runs on their PC against their own
// Interactive Brokers paper account and can act on their orders and nothing else.
// The key is shown once; making a new one stops the old one working.

import { useEffect, useState } from "react";
import type { Store } from "../data/store";
import { Sheet } from "./parts";

const GUIDE = "https://github.com/benjaminkeithrose-svg/stockwizard/blob/main/docs/SETUP-BOT.md";

export default function BotKeyScreen({ store }: { store: Store }) {
  const [madeAt, setMadeAt] = useState<string | null | undefined>(undefined);
  const [key, setKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { store.botKeyMadeAt().then(setMadeAt).catch((e) => setError(String(e.message ?? e))); }, [store]);

  const make = async () => {
    setConfirm(false);
    setBusy(true);
    setError(null);
    try {
      setKey(await store.makeBotKey());
      setMadeAt(new Date().toISOString());
      setCopied(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => {
    if (!key) return;
    try { await navigator.clipboard.writeText(key); setCopied(true); } catch { setError("Couldn't copy: select the key and copy it by hand."); }
  };
  const when = madeAt ? new Date(madeAt).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : null;

  return (
    <div className="list">
      <button className="big" disabled={busy || madeAt === undefined} onClick={() => (madeAt ? setConfirm(true) : make())}>
        {busy ? "Making the key…" : madeAt ? "Make a new bot key" : "Make a bot key"}
      </button>
      {error && <div className="msg err" style={{ marginTop: 8 }}>{error}</div>}

      {key ? (
        <>
          <div className="msg ok" style={{ marginTop: 12 }}>Here's your bot key. It's shown only this once: copy it now.</div>
          <div className="card" style={{ marginTop: 8 }}>
            <code style={{ wordBreak: "break-all", padding: "10px 12px", fontSize: 13, flex: 1 }} aria-label="Your bot key">{key}</code>
          </div>
          <button className="ghost" style={{ marginTop: 8 }} onClick={copy}>{copied ? "Copied" : "Copy the key"}</button>
          <h2>Put it in your bot</h2>
          <p className="hint">Not installed yet? Follow the <a href={GUIDE} target="_blank" rel="noreferrer">setup guide</a>: the installer asks for this key.</p>
          <p className="hint">Already installed:</p>
          <ol className="steps">
            <li>On the PC that runs your bot, open the Start menu and click <b>Stock Wizard Bot settings</b>.</li>
            <li>On the line that starts <b>BOT_KEY=</b>, replace everything after the = with the key, with no spaces.</li>
            <li>Save and close Notepad.</li>
            <li>Close the bot's window, then open <b>Stock Wizard Bot</b> from the Start menu.</li>
          </ol>
        </>
      ) : (
        <p className="hint" style={{ marginTop: 12 }}>
          {madeAt === undefined ? "Checking…" : when ? `You made a bot key on ${when}. A new one stops the old one working.` : "You haven't made a bot key yet."}
        </p>
      )}

      <h2>What the key does</h2>
      <p className="hint">
        Your bot runs on your own PC, next to Interactive Brokers' TWS or IB Gateway, and trades only your paper account.
        With this key it signs in to Stock Wizard as your bot: it can read your limits and bots and place and update your
        orders, and nothing else of yours or anyone else's. Keep it private, like a password.
      </p>
      <p className="hint">Setting up for the first time: the <a href={GUIDE} target="_blank" rel="noreferrer">setup guide</a> covers
        Interactive Brokers, TWS and installing the bot, step by step.</p>

      {confirm && (
        <Sheet title="Make a new bot key?" onClose={() => setConfirm(false)}>
          <p style={{ margin: "4px 0 6px" }}>Your <b>old bot key stops working</b>, within the hour.</p>
          <p className="hint">Put the new key in your bot's stockwizard.env afterwards, or the bot can't sign in.</p>
          <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
            <button className="ghost" autoFocus onClick={() => setConfirm(false)}>Cancel</button>
            <button className="ghost" onClick={make}>Make a new key</button>
          </div>
        </Sheet>
      )}
    </div>
  );
}
