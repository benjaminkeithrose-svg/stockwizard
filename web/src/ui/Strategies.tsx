// Bots, on the Safety screen: what the bot proposes by itself each trading
// day at the entry time. A bot is made from a backtest ("Make a bot" on its
// page) and keeps the settings it tested; only a tested bot can be switched
// on. Each card shows its paper results against what the backtest expected.
// Switching one on asks first; the rails and approval mode still decide every
// order.

import { useEffect, useState } from "react";
import type { BotStrategy, PaperOrder, StrategyConfig } from "../data/model";
import { isTested, paperResults, sameSettings } from "../data/bots";
import type { Store } from "../data/store";
import { Bin } from "./icons";
import { Sheet, Info, MoreMenu } from "./parts";

const PRESETS: { name: string; what: string; config: StrategyConfig }[] = [
  { name: "Directional", what: "10:30: bull put if bullish, bear call if bearish, nothing if neutral; take 50%, stop 2×, out by 15:00",
    config: { instrument: "XSP", structure: "directional", neutral_trade: "none", entry: "10:30", short_delta: 0.15, width: 1, profit_target: 0.5, stop_mult: 2, exit_time: "15:00" } },
  { name: "Neutral condor", what: "10:30, only while inside the opening range; take 50%, out by 15:00",
    config: { instrument: "XSP", structure: "iron_condor", entry: "10:30", short_delta: 0.15, width: 1, require_inside_range: true, profit_target: 0.5, exit_time: "15:00" } },
  { name: "Afternoon", what: "13:30: directional, or a condor on a neutral day; out by 15:30",
    config: { instrument: "XSP", structure: "directional", neutral_trade: "iron_condor", entry: "13:30", short_delta: 0.15, width: 1, exit_time: "15:30" } },
];

const STRUCTURES: [string, string][] = [["iron_condor", "Iron condor"], ["iron_fly", "Iron fly"], ["bull_put", "Bull put"], ["bear_call", "Bear call"],
  ["bull_call_debit", "Bull call debit"], ["bear_put_debit", "Bear put debit"], ["directional", "Credit spread by direction"], ["directional_debit", "Debit spread by direction"]];
const money = (v: number | null | undefined) => (typeof v === "number" ? `${v >= 0 ? "+" : "−"}$${Math.abs(v).toFixed(0)}` : "—");
const pct = (v: number | null | undefined) => (typeof v === "number" ? `${v.toFixed(0)}%` : "—");
const expires = (d?: number) => (!d || d <= 1 ? "same day" : d >= 21 ? "about a month" : `${d} days`);

export function describeStrategy(c: StrategyConfig): string {
  const kind = STRUCTURES.find(([k]) => k === c.structure)?.[1] ?? c.structure.replace("_", " ");
  const shorts = c.short_atr && ["iron_condor", "bull_put", "bear_call"].includes(c.structure) ? `shorts ${c.short_atr}× daily range`
    : ["iron_fly", "bull_call_debit", "bear_put_debit"].includes(c.structure) ? "at the money" : `${Math.round(c.short_delta * 100)} delta`;
  const parts = [c.instrument, kind, c.entry, `expires ${expires(c.dte)}`, shorts, `$${c.width} wide`];
  if (c.require_inside_range) parts.push("inside opening range");
  if (c.profit_target) parts.push(`take ${Math.round(c.profit_target * 100)}%`);
  if (c.stop_mult) parts.push(`stop ${c.stop_mult}×`);
  if (c.close_days_left) parts.push(`close at ${c.close_days_left} days left`);
  if (c.vix_max != null) parts.push(`VIX ≤ ${c.vix_max}`);
  if (c.signal_rule) parts.push(`on ${String(c.signal_rule).replace(/_/g, " ")} days`);
  if (c.exit_time) parts.push(`out by ${c.exit_time}${c.dte && c.dte > 1 ? " on expiry day" : ""}`);
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

export function BotSheet(props: { strategy: BotStrategy | null; onDone: (s: BotStrategy) => void; onDelete?: () => void; onClose: () => void }) {
  const [label, setLabel] = useState(props.strategy?.label ?? PRESETS[1].name);
  const [c, setC] = useState<StrategyConfig>(props.strategy?.config ?? PRESETS[1].config);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const set = (k: keyof StrategyConfig, v: unknown) => setC({ ...c, [k]: v });
  const source = props.strategy?.source ?? null;
  const changed = !!source && !sameSettings(c, source.config);
  // A tested bot changed away from its settings is switched off: it can't run untested.
  const done = () => { props.onDone({ id: props.strategy?.id ?? "", label: label.trim() || "Automated strategy", config: c, source, enabled: (props.strategy?.enabled ?? false) && !changed }); props.onClose(); };
  return (
    <Sheet title={props.strategy?.id ? "Automated strategy" : "New automated strategy"} onClose={props.onClose} onDone={done}>
      {source && (
        <div className={`msg ${changed ? "warn" : "ok"}`}>
          {changed
            ? <>Changed from the tested settings, so it can't be switched on until these are backtested. <button className="link" onClick={() => setC(source.config)}>Put them back</button></>
            : <>Tested: {source.label}{source.held_back ? `. Held back: ${source.held_back.trades} trades, ${pct(source.held_back.win_rate)} won, ${money(source.held_back.expectancy)} a trade.` : "."}</>}
        </div>
      )}
      {!source && <div className="msg warn">Set up by hand: untested, so it can't be switched on. Use Start paper trading on a backtest page in the Lab to start from tested settings.</div>}
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
      <Chips label="Structure" value={c.structure} options={STRUCTURES} onChange={(v) => setC({ ...c, structure: v, neutral_trade: v === "directional" ? (c.neutral_trade ?? "none") : c.neutral_trade })} />
      <Chips label="Expires" value={c.dte ?? 0} options={[[0, "Same day"], [3, "3 days"], [9, "9 days"], [21, "~1 month"]]} onChange={(v) => set("dte", v)} />
      <Chips label="Instrument" value={c.instrument} options={[["XSP", "XSP"], ["SPY", "SPY"], ["QQQ", "QQQ"], ["SPX", "SPX"]]} onChange={(v) => set("instrument", v)} />
      <Chips label="Entry (New York)" value={c.entry} options={[["10:00", "10:00"], ["10:30", "10:30"], ["11:00", "11:00"], ["13:30", "13:30"], ["14:00", "14:00"]]} onChange={(v) => set("entry", v)} />
      {c.structure === "iron_condor" && <Chips label="Shorts placed by" value={c.short_atr ?? null} options={[[null, "Delta"], [0.25, "¼ daily range"], [0.5, "½ range"], [1, "1 range"]]} onChange={(v) => set("short_atr", v)} />}
      <Chips label="Short strike delta" value={c.short_delta} options={[[0.1, "10"], [0.15, "15"], [0.2, "20"], [0.25, "25"]]} onChange={(v) => set("short_delta", v)} />
      <Chips label="Width" value={c.width} options={[[1, "$1"], [2, "$2"], [5, "$5"], [10, "$10"]]} onChange={(v) => set("width", v)} />
      <Chips label="Take profit at" value={c.profit_target ?? null} options={[[null, "Hold"], [0.25, "25%"], [0.5, "50%"], [0.75, "75%"]]} onChange={(v) => set("profit_target", v)} />
      <Chips label="Stop at" value={c.stop_mult ?? null} options={[[null, "None"], [1.5, "1.5×"], [2, "2×"], [3, "3×"]]} onChange={(v) => set("stop_mult", v)} />
      <Chips label="Out by" value={c.exit_time ?? null} options={[[null, "Expiry"], ["14:30", "14:30"], ["15:00", "15:00"], ["15:30", "15:30"]]} onChange={(v) => set("exit_time", v)} />
      <p className="hint">{describeStrategy(c)}. The safety rails check every order; your per-trade limit applies.</p>
      {props.strategy?.id && props.onDelete && <button className="link" style={{ color: "var(--warn)", marginTop: 12 }} onClick={() => setConfirmDelete(true)}><Bin /> Delete this automated strategy</button>}
      {confirmDelete && (
        <Sheet title="Delete?" onClose={() => setConfirmDelete(false)}>
          <p>Delete the automated strategy <b>{props.strategy?.label}</b>? Its past orders stay in the history.</p>
          <div style={{ display: "flex", gap: 10 }}>
            <button className="ghost" autoFocus onClick={() => setConfirmDelete(false)}>Cancel</button>
            <button className="ghost" style={{ color: "var(--warn)", borderColor: "var(--warn)" }} onClick={() => { props.onDelete?.(); props.onClose(); }}>Delete</button>
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
  const [orders, setOrders] = useState<PaperOrder[]>([]);
  const reload = () => Promise.all([store.botStrategies(), store.paperOrders()]).then(([b, o]) => { setList(b); setOrders(o); }).catch((e) => onError(String(e.message ?? e)));
  useEffect(() => { reload(); }, [store]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = (s: BotStrategy) => store.saveBotStrategy(s).then(reload).catch((e) => onError(String(e.message ?? e)));

  return (
    <>
      <div className="h2row"><h2>Automated strategies <Info term="tested" /></h2>
        <MoreMenu className="icon" label="More for automated strategies" items={[{ label: "Set one up by hand (untested)", onPick: () => setOpen("new") }]} /></div>
      {!list.length && <p className="empty">None yet.</p>}
      {list.map((s) => (
        <div key={s.id} className="card strat" style={{ borderLeftColor: s.enabled ? "#237F35" : undefined }}>
          <button className="cmain" onClick={() => setOpen(s)}>
            <div className="t">{s.label} <span className={`badge ${isTested(s) ? "ok" : "est"}`}>{isTested(s) ? "Tested" : "Untested"}</span></div>
            <div className="meta">{describeStrategy(s.config)}</div>
            {(() => {
              const r = paperResults(orders, s.id);
              const h = s.source?.held_back;
              return (
                <div className="meta">
                  Paper: {r.trades ? `${r.trades} closed, ${pct(r.win_rate)} won, ${money(r.expectancy)} a trade` : "no closed trades yet"}{r.open ? ` · ${r.open} open` : ""}
                  {h ? ` · Backtest expected ${pct(h.win_rate)} won, ${money(h.expectancy)} a trade` : ""}
                </div>
              );
            })()}
          </button>
          <button className={`toggle${s.enabled ? " on" : ""}`} role="switch" aria-checked={s.enabled} aria-label={`${s.label} ${s.enabled ? "on" : "off"}`}
            onClick={() => (s.enabled ? save({ ...s, enabled: false }) : setTurningOn(s))}>{s.enabled ? "On" : "Off"}</button>
        </div>
      ))}
      <p className="hint">Start one from the Lab: open a backtest that held up, then Start paper trading. Only a tested one can be switched on. Each card compares its paper results with what its backtest expected.</p>
      {open && (
        <BotSheet strategy={open === "new" ? null : open} onClose={() => setOpen(null)} onDone={save}
          onDelete={() => open !== "new" && store.deleteBotStrategy(open.id).then(reload).catch((e) => onError(String(e.message ?? e)))} />
      )}
      {turningOn && (
        isTested(turningOn) ? <Sheet title="Switch on?" onClose={() => setTurningOn(null)}>
          <p>Every trading day at {turningOn.config.entry} New York time, Stock Wizard on your PC checks <b>{turningOn.label}</b> and proposes the trade if the setup is there. The safety rails and approval mode decide every order.</p>
          <div style={{ display: "flex", gap: 10 }}>
            <button className="ghost" autoFocus onClick={() => setTurningOn(null)}>Cancel</button>
            <button className="ghost" onClick={() => { save({ ...turningOn, enabled: true }); setTurningOn(null); }}>Switch on</button>
          </div>
        </Sheet>
        : <Sheet title="Can't switch on" onClose={() => setTurningOn(null)}>
          <p><b>{turningOn.label}</b> {turningOn.source ? "has been changed from the settings its backtest tested" : "was set up by hand, so nothing has tested it"}. Only tested settings can run.</p>
          <p className="hint">{turningOn.source ? "Open it and tap Put them back, or automate one from a backtest." : "Open a backtest in the Lab and tap Start paper trading."}</p>
          <button className="ghost" autoFocus onClick={() => setTurningOn(null)}>OK</button>
        </Sheet>
      )}
    </>
  );
}
