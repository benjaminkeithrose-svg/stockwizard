// Shared pieces: sheets (pop-up panels), ⋯ menus and the delete confirmation.

import { ReactNode, useEffect, useRef, useState } from "react";
import { Close, Dots } from "./icons";

export function Sheet(props: {
  title: string;
  onClose: () => void;
  /** The Done button: leaves the sheet and keeps what was entered. */
  onDone?: () => void;
  full?: boolean;
  children: ReactNode;
}) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && props.onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [props.onClose]);
  return (
    <div className="scrim" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className={`sheet${props.full ? " full" : ""}`} role="dialog" aria-label={props.title}>
        <div className="sh-h">
          <button className="icon" aria-label="Close" onClick={props.onClose}><Close /></button>
          <b>{props.title}</b>
          {props.onDone && <button className="done" onClick={props.onDone}>Done</button>}
        </div>
        <div className="sh-b">{props.children}</div>
      </div>
    </div>
  );
}

export interface MenuItem {
  label: string;
  onPick: () => void;
  danger?: boolean;
  icon?: ReactNode;
}

/** A ⋯ button that opens a small menu. */
export function MoreMenu(props: { items: MenuItem[]; label: string; className?: string; children?: ReactNode }) {
  const [at, setAt] = useState<{ top: number; right: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!at) return;
    const close = () => setAt(null);
    window.addEventListener("resize", close);
    return () => window.removeEventListener("resize", close);
  }, [at]);
  const open = () => {
    const r = btn.current!.getBoundingClientRect();
    setAt({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) });
  };
  return (
    <>
      <button ref={btn} className={props.className ?? "menubtn"} aria-label={props.label} aria-haspopup="menu" onClick={open}>
        {props.children ?? <Dots />}
      </button>
      {at && (
        <div className="scrim" style={{ background: "transparent" }} onClick={() => setAt(null)}>
          <div className="menu" role="menu" style={{ top: at.top, right: at.right }}>
            {props.items.map((it, i) =>
              it.label === "-" ? <hr key={i} /> : (
                <button key={i} role="menuitem" className={it.danger ? "danger" : ""}
                  onClick={(e) => { e.stopPropagation(); setAt(null); it.onPick(); }}>
                  {it.icon}{it.label}
                </button>
              ),
            )}
          </div>
        </div>
      )}
    </>
  );
}

/** Names exactly what will be lost. Cancel is the safe default. */
export function ConfirmDelete(props: { what: string; detail?: string; onCancel: () => void; onDelete: () => void }) {
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => cancel.current?.focus(), []);
  return (
    <Sheet title="Delete?" onClose={props.onCancel}>
      <p style={{ margin: "4px 0 6px" }}>Delete <b>{props.what}</b>?</p>
      {props.detail && <p className="hint">{props.detail}</p>}
      <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
        <button ref={cancel} className="ghost" onClick={props.onCancel}>Cancel</button>
        <button className="ghost" style={{ color: "var(--warn)", borderColor: "var(--warn)" }} onClick={props.onDelete}>Delete</button>
      </div>
    </Sheet>
  );
}

/** One text answer, e.g. a new name. Done keeps it; an empty answer changes nothing. */
export function AskText(props: { title: string; label: string; value: string; onClose: () => void; onDone: (v: string) => void }) {
  const [v, setV] = useState(props.value);
  const done = () => { if (v.trim()) props.onDone(v.trim()); props.onClose(); };
  return (
    <Sheet title={props.title} onClose={props.onClose} onDone={done}>
      <label htmlFor="asktext">{props.label}</label>
      <input id="asktext" autoFocus value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === "Enter" && done()} />
    </Sheet>
  );
}
