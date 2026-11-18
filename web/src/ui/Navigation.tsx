// Getting around (Ben, 18 Nov 2026: cues from Financial Vault, picks 1, 3 and 6).
// One full-screen menu with every screen in groups, Look and feel at its foot, and the
// path bar under the header: the screens you came through, each one tappable.

import { useState } from "react";
import { MODES, Mode, readMode, saveMode } from "../theme";
import { Sheet } from "./parts";

export interface MenuEntry {
  key: string;
  label: string;
  onPick: () => void;
}

export interface MenuGroup {
  label: string;
  entries: MenuEntry[];
}

/** The full-screen menu: every screen, grouped; the current one marked. Picking one closes it. */
export function FullMenu(props: { groups: MenuGroup[]; current: string; onClose: () => void; foot?: React.ReactNode }) {
  const [mode, setMode] = useState<Mode>(readMode());
  return (
    <Sheet title="Menu" full onClose={props.onClose}>
      <nav className="navmenu" aria-label="Screens">
        {props.groups.map((g) => (
          <section key={g.label}>
            <h2>{g.label}</h2>
            {g.entries.map((e) => (
              <button key={e.key} className={`navlink${e.key === props.current ? " on" : ""}`} aria-current={e.key === props.current ? "page" : undefined}
                onClick={() => { props.onClose(); e.onPick(); }}>
                {e.label}
              </button>
            ))}
          </section>
        ))}
        <section>
          <h2>Look and feel</h2>
          <div className="seg wide" role="group" aria-label="Light or dark">
            {MODES.map((m) => (
              <button key={m.id} className={mode === m.id ? "on" : ""} aria-pressed={mode === m.id}
                onClick={() => { setMode(m.id); saveMode(m.id); }}>
                {m.name}
              </button>
            ))}
          </div>
          <p className="hint">Kept on this device: your phone and PC can each have their own.</p>
        </section>
        {props.foot}
      </nav>
    </Sheet>
  );
}

export interface Crumb {
  key: string;
  title: string;
  onPick: () => void;
}

/** The path you came down, under the header: shown two or more screens deep. The last is where you are. */
export function PathBar({ crumbs }: { crumbs: Crumb[] }) {
  if (crumbs.length < 3) return null;   // home plus one: the back and home buttons already say it
  return (
    <nav className="pathbar" aria-label="The path you came down">
      <ol>
        {crumbs.map((c, i) => (
          <li key={c.key} aria-current={i === crumbs.length - 1 ? "page" : undefined}>
            {i === crumbs.length - 1 ? c.title : <button onClick={c.onPick}>{c.title}</button>}
          </li>
        ))}
      </ol>
    </nav>
  );
}
