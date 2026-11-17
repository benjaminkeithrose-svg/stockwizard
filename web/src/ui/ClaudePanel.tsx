// Claude in the app: the box to ask at the top, the newest answer just under
// it. On the PC it sits beside the chart; on the phone it fills the screen.

import { useEffect, useMemo, useState } from "react";
import { ClaudeAction, ClaudeMessage, exchanges } from "../data/claude";
import type { Store } from "../data/store";
import { Close } from "./icons";
import { ConfirmDelete, MoreMenu } from "./parts";

function load(key: string): ClaudeMessage[] {
  try { return JSON.parse(localStorage.getItem(key) ?? "[]"); } catch { return []; }
}

export default function ClaudePanel(props: {
  store: Store;
  userId: string;
  onClose: () => void;
  onAction: (a: ClaudeAction) => void;
  onOpenBacktest: (id: string) => void;
}) {
  const key = `stockwizard.claude.${props.userId}`;
  const [history, setHistory] = useState<ClaudeMessage[]>(() => load(key));
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [backtests, setBacktests] = useState<Record<number, string[]>>({});
  const [clearing, setClearing] = useState(false);

  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(history)); } catch { /* storage full: still works this session */ } }, [history, key]);

  const ask = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    const next: ClaudeMessage[] = [...history, { role: "user", content: text }];
    setHistory(next);
    setDraft("");
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const reply = await props.store.askClaude(next);
      setHistory([...next, ...reply.added]);
      setNote(reply.note);
      const opened: string[] = [];
      for (const a of reply.actions) {
        if (a.type === "open_backtest") opened.push(a.strategy_id);
        else props.onAction(a);
      }
      if (opened.length) setBacktests((b) => ({ ...b, [next.length - 1]: opened }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const shown = useMemo(() => exchanges(history), [history]);

  return (
    <aside className="claude" aria-label="Claude">
      <div className="sh-h">
        <button className="icon" aria-label="Close Claude" onClick={props.onClose}><Close /></button>
        <b>Claude</b>
        <MoreMenu className="icon" label="More for Claude" items={[
          { label: "New conversation", onPick: () => setClearing(true) },
        ]} />
      </div>
      <div className="sh-b">
        <textarea className="ask" aria-label="Ask Claude" placeholder="Ask, or describe a test in your own words" value={draft}
          onChange={(e) => setDraft(e.target.value)} disabled={busy}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(); } }} />
        <button className="big" onClick={ask} disabled={busy || !draft.trim()}>{busy ? "Claude is working… (can take a minute)" : "Ask Claude"}</button>
        {error && <div className="msg err">{error}</div>}
        {note && <div className="msg warn">{note}</div>}
        {!shown.length && !busy && <p className="hint">Claude can read your charts, scans, backtests and the pattern lab, make new scans and strategies, run backtests and put indicators on your chart. It can't place orders or change safety settings.</p>}
        {shown.map((x) => (
          <div key={x.index} className="turn">
            <div className="you">{x.asked}</div>
            {!!x.did.length && <div className="did">{[...new Set(x.did)].join(" · ")}</div>}
            {x.reply.map((t, i) => <div key={i} className="said">{t}</div>)}
            {!x.reply.length && busy && x === shown[0] && <div className="hint">Working…</div>}
            {(backtests[x.index] ?? []).map((id) => (
              <button key={id} className="ghost" style={{ marginTop: 6 }} onClick={() => props.onOpenBacktest(id)}>Open the backtest</button>
            ))}
          </div>
        ))}
      </div>
      {clearing && (
        <ConfirmDelete what="this conversation" detail={`Its ${shown.length} exchange${shown.length === 1 ? "" : "s"} with Claude, on this device. Anything Claude made (scans, strategies, backtests) stays.`}
          onCancel={() => setClearing(false)} onDelete={() => { setHistory([]); setBacktests({}); setClearing(false); }} />
      )}
    </aside>
  );
}
