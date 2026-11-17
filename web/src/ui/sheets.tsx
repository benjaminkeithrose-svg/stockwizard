// The chart's pop-up sheets: symbol search, indicators and drawings.

import { useMemo, useState } from "react";
import type { Timeframe } from "../data/candles";
import { Drawing, Favourite, indicator, IndicatorInstance, MAX_FAVOURITES, sameIndicator, SymbolInfo } from "../data/model";
import { Params, REGISTRY, unavailable } from "../indicators";
import { Bin, Search, Star } from "./icons";
import { ConfirmDelete, Sheet } from "./parts";

const GROUPS = [
  ["trend", "Trend"],
  ["volatility", "Volatility"],
  ["momentum", "Momentum"],
  ["volume", "Volume"],
  ["levels", "Levels"],
] as const;

export function SymbolSearch(props: { symbols: SymbolInfo[]; onPick: (s: string) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const hits = useMemo(() => {
    const t = q.trim().toUpperCase();
    return props.symbols.filter((s) => !t || s.symbol.toUpperCase().includes(t) || (s.name ?? "").toUpperCase().includes(t));
  }, [q, props.symbols]);
  return (
    <Sheet title="Find a symbol" onClose={props.onClose} full>
      <div style={{ position: "relative" }}>
        <input autoFocus placeholder="Ticker or name" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search symbols"
          onKeyDown={(e) => e.key === "Enter" && hits[0] && props.onPick(hits[0].symbol)} style={{ paddingLeft: 40 }} />
        <span style={{ position: "absolute", left: 12, top: 13, color: "var(--ink-3)" }}><Search /></span>
      </div>
      <div style={{ marginTop: 12 }}>
        {hits.map((s) => (
          <div key={s.symbol} className="card">
            <button className="cmain" onClick={() => props.onPick(s.symbol)}>
              <div className="t">{s.symbol}</div>
              <div className="meta">{[s.name, s.market, s.tradable ? null : "watch only"].filter(Boolean).join(" · ")}</div>
            </button>
          </div>
        ))}
        {!hits.length && (
          <p className="empty">
            {props.symbols.length ? `No symbol matches “${q}”.` : "No symbols in the database yet. The loader adds them."}
          </p>
        )}
      </div>
    </Sheet>
  );
}

function ParamEditor(props: {
  inst: IndicatorInstance;
  timeframe: Timeframe;
  onChange: (p: Params) => void;
  onPickAnchor: () => void;
}) {
  const def = REGISTRY[props.inst.name];
  const keys = Object.keys(def.defaults);
  if (!keys.length) return <p className="hint">No settings.</p>;
  return (
    <div className="fields">
      {keys.map((k) =>
        k === "anchor" ? (
          <div key={k} style={{ gridColumn: "1 / -1" }}>
            <label>Starts at</label>
            <button className="ghost" onClick={props.onPickAnchor}>
              {props.inst.params.anchor ? new Date(String(props.inst.params.anchor)).toLocaleString() : "Choose the candle on the chart"}
            </button>
          </div>
        ) : (
          <div key={k}>
            <label htmlFor={`p-${k}`}>{k.replace("_", " ")}</label>
            <input id={`p-${k}`} type="number" inputMode="decimal" step="any" value={props.inst.params[k]}
              onChange={(e) => props.onChange({ ...props.inst.params, [k]: e.target.value === "" ? "" : Number(e.target.value) })} />
          </div>
        ),
      )}
    </div>
  );
}

export function IndicatorSheet(props: {
  indicators: IndicatorInstance[];
  timeframe: Timeframe;
  onChange: (list: IndicatorInstance[]) => void;
  onPickAnchor: (id: string) => void;
  onClose: () => void;
  /** Open this indicator's settings to start with (its chip was tapped). */
  open?: string | null;
  favourites: Favourite[];
  onFavourites: (f: Favourite[]) => void;
}) {
  const [list, setList] = useState(props.indicators);
  const [editing, setEditing] = useState<string | null>(props.open ?? null);
  const isFav = (i: IndicatorInstance) => props.favourites.some((f) => f.kind === "indicator" && sameIndicator(f, i));
  const toggleFav = (i: IndicatorInstance) => props.onFavourites(isFav(i)
    ? props.favourites.filter((f) => !(f.kind === "indicator" && sameIndicator(f, i)))
    : [...props.favourites, { kind: "indicator", name: i.name, params: { ...i.params } }]);
  const done = () => {
    // Settings left blank go back to their defaults.
    props.onChange(list.map((i) => ({
      ...i,
      params: Object.fromEntries(Object.entries(i.params).map(([k, v]) => [k, v === "" ? REGISTRY[i.name].defaults[k] : v])),
    })));
    props.onClose();
  };
  const add = (name: string) => {
    const inst = indicator(name);
    setList([...list, inst]);
    setEditing(inst.id);
  };
  return (
    <Sheet title="Indicators" onClose={done} onDone={done}>
      <h2>On this chart</h2>
      {!list.length && <p className="empty">None.</p>}
      {list.map((inst) => {
        const def = REGISTRY[inst.name];
        const why = unavailable(def, inst.params, props.timeframe);
        return (
          <div key={inst.id}>
            <div className="card indic">
              <button className="cmain" onClick={() => setEditing(editing === inst.id ? null : inst.id)}>
                <div className="t">{def.short(inst.params)}</div>
                <div className="meta">{why ?? def.label}</div>
              </button>
              <button className={`icon star${isFav(inst) ? " on" : ""}`} aria-pressed={isFav(inst)}
                disabled={!isFav(inst) && props.favourites.length >= MAX_FAVOURITES}
                aria-label={isFav(inst) ? `Remove ${def.short(inst.params)} from favourites` : `Add ${def.short(inst.params)} to favourites`}
                onClick={() => toggleFav(inst)}><Star filled={isFav(inst)} /></button>
              <button className="icon bin" aria-label={`Remove ${def.short(inst.params)}`}
                onClick={() => setList(list.filter((x) => x.id !== inst.id))}><Bin /></button>
            </div>
            {editing === inst.id && (
              <div style={{ margin: "-2px 0 12px 6px" }}>
                <ParamEditor inst={inst} timeframe={props.timeframe}
                  onChange={(p) => setList(list.map((x) => (x.id === inst.id ? { ...x, params: p } : x)))}
                  onPickAnchor={() => { props.onChange(list); props.onPickAnchor(inst.id); }} />
              </div>
            )}
          </div>
        );
      })}
      {(() => {
        const favs = props.favourites.filter((f): f is Extract<Favourite, { kind: "indicator" }> => f.kind === "indicator"
          && !list.some((i) => sameIndicator(i, f)) && !!REGISTRY[f.name] && !(REGISTRY[f.name].intradayOnly && props.timeframe === "1d"));
        const label = (f: Extract<Favourite, { kind: "indicator" }>) => REGISTRY[f.name].short({ ...REGISTRY[f.name].defaults, ...f.params });
        return favs.length > 0 && (
          <>
            <h2>Favourites</h2>
            <div className="chips">
              {favs.map((f) => (
                <button key={label(f)} className="chip fav" aria-label={`Add ${label(f)}`}
                  onClick={() => setList([...list, indicator(f.name, f.params)])}>+ {label(f)}</button>
              ))}
            </div>
          </>
        );
      })()}
      <p className="hint">The star keeps an indicator, with its settings, in Favourites here for one-tap adding.</p>
      <h2>Add</h2>
      {GROUPS.map(([g, label]) => (
        <div key={g} style={{ marginBottom: 10 }}>
          <div className="hint" style={{ margin: "0 0 6px" }}>{label}</div>
          <div className="chips">
            {Object.values(REGISTRY).filter((d) => d.group === g).map((d) => (
              <button key={d.name} className="chip" disabled={!!(d.intradayOnly && props.timeframe === "1d")}
                onClick={() => add(d.name)}>{d.label}</button>
            ))}
          </div>
        </div>
      ))}
    </Sheet>
  );
}

export function DrawSheet(props: {
  drawings: Drawing[];
  onTool: (tool: "level" | "trend") => void;
  onChange: (d: Drawing[]) => void;
  onClose: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  const describe = (d: Drawing) =>
    d.kind === "level" ? `Level at ${fmt(d.price)}` : `Trendline ${fmt(d.a.price)} → ${fmt(d.b.price)}`;
  return (
    <Sheet title="Draw" onClose={props.onClose}>
      <div className="chips">
        <button className="chip" onClick={() => props.onTool("level")}>Horizontal level</button>
        <button className="chip" onClick={() => props.onTool("trend")}>Trendline</button>
      </div>
      <p className="hint">Choose a tool, then tap the chart: once for a level, twice for a trendline.</p>
      <h2>On this chart</h2>
      {!props.drawings.length && <p className="empty">None.</p>}
      {props.drawings.map((d) => (
        <div key={d.id} className="card">
          <div className="cmain" style={{ cursor: "default" }}><div className="t">{describe(d)}</div></div>
          <button className="icon bin" aria-label={`Delete ${describe(d)}`}
            onClick={() => props.onChange(props.drawings.filter((x) => x.id !== d.id))}><Bin /></button>
        </div>
      ))}
      {props.drawings.length > 1 && (
        <button className="link" style={{ color: "var(--warn)" }} onClick={() => setConfirm(true)}>Delete all drawings</button>
      )}
      {confirm && (
        <ConfirmDelete what={`all ${props.drawings.length} drawings on this chart`}
          detail="The levels and trendlines on this tab. Indicators stay."
          onCancel={() => setConfirm(false)} onDelete={() => { props.onChange([]); setConfirm(false); }} />
      )}
    </Sheet>
  );
}
