// The bot's own strategies, on the Safety screen: what it proposes by itself
// each trading day at the entry time. Each is a 0DTE research configuration,
// so the bot follows the same rules the research tests. Switching one on
// asks first; the rails and approval mode still decide every order.

import { useEffect, useState } from "react";
import type { BotStrategy, StrategyConfig } from "../data/model";
import type { Store } from "../data/store";
import { Bin } from "./icons";
import { Sheet } from "./parts";

const PRESETS: { name: string; what: string; config: StrategyConfig }[] = [
  { name: "Directional", what: "10:30: bull put if bullish, bear call if bearish, nothing if neutral; take 50%, stop 2×, out by 15:00",
    config: { instrument: "XSP", structure: "directional", neutral_trade: "none", entry: "10:30", short_delta: 0.15, width: 1, profit_target: 0.5, stop_mult: 2, exit_time: "15:00" } },
  { name: "Neutral condor", what: "10:30, only while inside the opening range; take 50%, out by 15:00",
    config: { instrument: "XSP", structure: "iron_condor", entry: "10:30", short_delta: 0.15, width: 1, require_inside_range: true, profit_target: 0.5, exit_time: "15:00" } },
  { name: "Afternoon", what: "13:30: directional, or a condor on a neutral day; out by 15:30",
    config: { instrument: "XSP", structure: "directional", neutral_trade: "iron_condor", entry: "13:30", short_delta: 0.15, width: 1, exit_time: "15:30" } },
];

export function describeStrategy(c: StrategyConfig): string {
  const parts = [c.instrument, c.structure === "directional" ? "directional" : c.structure.replace("_", " "), c.entry, `${Math.round(c.short_delta * 100)} delta`, `$${c.width} wide`];
  if (c.require_inside_range) parts.push("inside opening range");
  if (c.profit_target) parts.push(`take ${Math.round(c.profit_target * 100)}%`);
  if (c.stop_mult) parts.push(`stop ${c.stop_mult}×`);
  if (c.exit_time) parts.push(`out by ${c.exit_time}`);
  return parts.join(" · ");
}

function Chips<T extends string | number | null>(props: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <>
      <h2>{props.label}</h2>
      <div className="chips">
        {props.options.map(([v, text]) => (
          <button key={String(v)} className={`chip${props.value === v ? " on" : ""}`} aria-pressed={props.value === v} onClick={() => props.onChange(v)}>{text}</button>
        ))}
      </div>
    </>
  );
}

function StrategySheet(props: { strategy: BotStrategy | null; onDone: (s: BotStrategy) => void; onDelete: () => void; onClose: () => void }) {
  const [label, setLabel] = useState(props.strategy?.label ?? PRESETS[1].name);
  const [c, setC] = useState<StrategyConfig>(props.strategy?.config ?? PRESETS[1].config);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const set = (k: keyof StrategyConfig, v: unknown) => setC({ ...c, [k]: v });
  const done = () => { props.onDone({ id: props.strategy?.id ?? "", label: label.trim() || "Strategy", config: c, enabled: props.strategy?.enabled ?? false }); props.onClose(); };
  return (
    <Sheet title={props.strategy ? "Strategy" : "New strategy"} onClose={props.onClose} onDone={done}>
      {!props.strategy && (
        <>
          <h2>Start from</h2>
          {PRESETS.map((p) => (
            <div key={p.name} className="card">
              <button className="cmain" onClick={() => { setLabel(p.name); setC(p.config); }}>
                <div className="t">{p.name}</div><div className="meta">{p.what}</div>
              </button>
            </div>
          ))}
        </>
      )}
      <label htmlFor="st-name">Name</label>
      <input id="st-name" value={label} onChange={(e) => setLabel(e.target.value)} />
      <Chips label="Instrument" value={c.instrument} options={[["XSP", "XSP"], ["SPY", "SPY"], ["QQQ", "QQQ"], ["SPX", "SPX"]]} onChange={(v) => set("instrument", v)} />
      <Chips label="Entry (New York)" value={c.entry} options={[["10:00", "10:00"], ["10:30", "10:30"], ["11:00", "11:00"], ["13:30", "13:30"], ["14:00", "14:00"]]} onChange={(v) => set("entry", v)} />
      <Chips label="Short strike delta" value={c.short_delta} options={[[0.1, "10"], [0.15, "15"], [0.2, "20"], [0.25, "25"]]} onChange={(v) => set("short_delta", v)} />
      <Chips label="Width" value={c.width} options={[[1, "$1"], [2, "$2"], [5, "$5"], [10, "$10"]]} onChange={(v) => set("width", v)} />
      <Chips label="Take profit at" value={c.profit_target ?? null} options={[[null, "Hold"], [0.25, "25%"], [0.5, "50%"], [0.75, "75%"]]} onChange={(v) => set("profit_target", v)} />
      <Chips label="Stop at" value={c.stop_mult ?? null} options={[[null, "None"], [1.5, "1.5×"], [2, "2×"], [3, "3×"]]} onChange={(v) => set("stop_mult", v)} />
      <Chips label="Out by" value={c.exit_time ?? null} options={[[null, "Expiry"], ["14:30", "14:30"], ["15:00", "15:00"], ["15:30", "15:30"]]} onChange={(v) => set("exit_time", v)} />
      <p className="hint">{describeStrategy(c)}. The safety rails check every order; your per-trade limit applies.</p>
      {props.strategy && <button className="link" style={{ color: "var(--warn)", marginTop: 12 }} onClick={() => setConfirmDelete(true)}><Bin /> Delete this strategy</button>}
      {confirmDelete && (
        <Sheet title="Delete?" onClose={() => setConfirmDelete(false)}>
          <p>Delete the strategy <b>{props.strategy?.label}</b>? Its past orders stay in the history.</p>
          <div style={{ display: "flex", gap: 10 }}>
            <button className="ghost" autoFocus onClick={() => setConfirmDelete(false)}>Cancel</button>
            <button className="ghost" style={{ color: "var(--warn)", borderColor: "var(--warn)" }} onClick={() => { props.onDelete(); props.onClose(); }}>Delete</button>
          </div>
        </Sheet>
      )}
    </Sheet>
  );
}

export default function StrategiesSection({ store, onError }: { store: Store; onError: (e: string) => void }) {
  const [list, setList] = useState<BotStrategy[]>([]);
  const [open, setOpen] = useState<BotStrategy | "new" | null>(null);
  const [turningOn, setTurningOn] = useState<BotStrategy | null>(null);
  const reload = () => store.botStrategies().then(setList).catch((e) => onError(String(e.message ?? e)));
  useEffect(() => { reload(); }, [store]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = (s: BotStrategy) => store.saveBotStrategy(s).then(reload).catch((e) => onError(String(e.message ?? e)));

  return (
    <>
      <h2>Strategies the bot runs</h2>
      {!list.length && <p className="empty">None yet.</p>}
      {list.map((s) => (
        <div key={s.id} className="card strat" style={{ borderLeftColor: s.enabled ? "#237F35" : undefined }}>
          <button className="cmain" onClick={() => setOpen(s)}>
            <div className="t">{s.label}</div>
            <div className="meta">{describeStrategy(s.config)}</div>
          </button>
          <button className={`toggle${s.enabled ? " on" : ""}`} role="switch" aria-checked={s.enabled} aria-label={`${s.label} ${s.enabled ? "on" : "off"}`}
            onClick={() => (s.enabled ? save({ ...s, enabled: false }) : setTurningOn(s))}>{s.enabled ? "On" : "Off"}</button>
        </div>
      ))}
      <button className="ghost" onClick={() => setOpen("new")}>+ Add a strategy</button>
      <p className="hint">At each strategy's entry time, the bot checks the setup and proposes the trade; you approve it here. With the pretend broker the prices are made up.</p>
      {open && (
        <StrategySheet strategy={open === "new" ? null : open} onClose={() => setOpen(null)} onDone={save}
          onDelete={() => open !== "new" && store.deleteBotStrategy(open.id).then(reload).catch((e) => onError(String(e.message ?? e)))} />
      )}
      {turningOn && (
        <Sheet title="Switch on?" onClose={() => setTurningOn(null)}>
          <p>Every trading day at {turningOn.config.entry} New York time, the bot checks <b>{turningOn.label}</b> and proposes the trade if the setup is there. The safety rails and approval mode decide every order.</p>
          <div style={{ display: "flex", gap: 10 }}>
            <button className="ghost" autoFocus onClick={() => setTurningOn(null)}>Cancel</button>
            <button className="ghost" onClick={() => { save({ ...turningOn, enabled: true }); setTurningOn(null); }}>Switch on</button>
          </div>
        </Sheet>
      )}
    </>
  );
}
