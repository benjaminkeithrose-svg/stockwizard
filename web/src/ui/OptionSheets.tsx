// Calls and puts on the chart: the Options sheet (place a structure, see this
// symbol's), and a structure's details (expiry, strikes, planned or bought).
// Plans only: nothing here sends an order.

import { useState } from "react";
import type { Favourite } from "../data/model";
import {
  daysToExpiry, expiryChoices, expiryLabel, legName, OptionPosition, problems, Structure, STRUCTURES, structureLabel, todayNY, widestWing,
} from "../data/options";
import { Star } from "./icons";
import { Sheet } from "./parts";

export const isFavStructure = (fav: Favourite[], s: Structure) => fav.some((f) => f.kind === "structure" && f.structure === s);

export function ExpiryChips(props: { value: string; onChange: (e: string) => void }) {
  const today = todayNY();
  const list = expiryChoices(today, 15);
  if (!list.includes(props.value)) list.unshift(props.value);
  return (
    <div className="chips scrollx" role="group" aria-label="Expiry">
      {list.map((e) => (
        <button key={e} className={`chip${e === props.value ? " on" : ""}`} aria-pressed={e === props.value} onClick={() => props.onChange(e)}>
          {expiryLabel(e)} <span className="sub">{daysToExpiry(e, today)}d</span>
        </button>
      ))}
    </div>
  );
}

export function OptionsSheet(props: {
  symbol: string;
  positions: OptionPosition[];
  expiry: string;
  favourites: Favourite[];
  canPlace: boolean;
  onExpiry: (e: string) => void;
  onPlace: (s: Structure) => void;
  onOpen: (p: OptionPosition) => void;
  onFavourite: (s: Structure, on: boolean) => void;
  onClose: () => void;
}) {
  return (
    <Sheet title={`Options on ${props.symbol}`} onClose={props.onClose}>
      <h2>Expiry</h2>
      <ExpiryChips value={props.expiry} onChange={props.onExpiry} />
      <p className="hint">Weekdays only; exchange holidays aren't known yet, so check the date exists at the broker.</p>
      <h2>Place</h2>
      {!props.canPlace && <p className="msg warn">No candles on this chart, so there's no price to place around.</p>}
      {STRUCTURES.map((s) => {
        const fav = isFavStructure(props.favourites, s.id);
        return (
          <div key={s.id} className="card opt">
            <button className="cmain" disabled={!props.canPlace} onClick={() => props.onPlace(s.id)}>
              <div className="t">{s.label}</div>
              <div className="meta">{s.what}</div>
            </button>
            <button className={`icon star${fav ? " on" : ""}`} aria-pressed={fav}
              aria-label={fav ? `Remove ${s.label} from favourites` : `Add ${s.label} to favourites`}
              onClick={() => props.onFavourite(s.id, !fav)}><Star filled={fav} /></button>
          </div>
        );
      })}
      <p className="hint">Placed one daily range (ATR 14) either side of the latest session's mean price, wings $5 beyond. Drag the lines to adjust.</p>
      <h2>On {props.symbol}</h2>
      {!props.positions.length && <p className="empty">None.</p>}
      {props.positions.map((p) => (
        <div key={p.id} className={`card opt ${p.status}`}>
          <button className="cmain" onClick={() => props.onOpen(p)}>
            <div className="t">{structureLabel(p.structure)} · {expiryLabel(p.expiry)}</div>
            <div className="meta">{p.status === "bought" ? "Bought" : "Planned"} · {p.legs.map((l) => l.strike).join(" / ")}</div>
          </button>
        </div>
      ))}
    </Sheet>
  );
}

export function PositionSheet(props: {
  position: OptionPosition;
  onChange: (p: OptionPosition) => void;
  onAdjust: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [p, setP] = useState(props.position);
  const set = (next: OptionPosition) => { setP(next); props.onChange(next); };
  const risk = widestWing(p);
  const issues = problems(p);
  return (
    <Sheet title={`${structureLabel(p.structure)} on ${p.symbol}`} onClose={props.onClose} onDone={props.onClose}>
      <button className="big" onClick={props.onAdjust}>Adjust on the chart</button>
      <h2>Status</h2>
      <div className="seg wide" role="group" aria-label="Status">
        {(["planned", "bought", "closed"] as const).map((s) => (
          <button key={s} className={p.status === s ? "on" : ""} aria-pressed={p.status === s} onClick={() => set({ ...p, status: s })}>
            {s === "planned" ? "Planned" : s === "bought" ? "Bought" : "Closed"}
          </button>
        ))}
      </div>
      <p className="hint">Marking it bought only changes its colour to green. Nothing is sent to a broker. Closed takes it off the charts.</p>
      <h2>Expiry</h2>
      <ExpiryChips value={p.expiry} onChange={(e) => set({ ...p, expiry: e })} />
      <h2>Legs</h2>
      <div className="fields">
        {p.legs.map((l, i) => (
          <div key={i}>
            <label htmlFor={`leg-${i}`}>{legName(l).replace(/ [\d.]+$/, "")}</label>
            <input id={`leg-${i}`} type="number" inputMode="decimal" step="any" value={l.strike}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (e.target.value !== "" && Number.isFinite(v) && v > 0) set({ ...p, legs: p.legs.map((x, j) => (j === i ? { ...x, strike: v } : x)) });
              }} />
          </div>
        ))}
      </div>
      {issues.map((m) => <p key={m} className="msg warn">{m}</p>)}
      {risk !== null && <p className="msg info">Widest wing ${(risk).toLocaleString()} a contract, before the premium (not known until the broker is connected).</p>}
      <h2>Note</h2>
      <input aria-label="Note" value={p.note ?? ""} placeholder="Why, or what to watch" onChange={(e) => set({ ...p, note: e.target.value || null })} />
      <button className="link" style={{ color: "var(--warn)", marginTop: 18 }} onClick={props.onDelete}>Delete this structure</button>
    </Sheet>
  );
}
