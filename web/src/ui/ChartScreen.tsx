// The chart workspace: tabs, then the toolbar, then the chart. Every control
// sits above the chart, none below it.

import { useEffect, useMemo, useState } from "react";
import Chart, { TapMode } from "../chart/Chart";
import { Candles, emptyCandles, TIMEFRAMES, Timeframe } from "../data/candles";
import { Favourite, indicator, newId, sameIndicator, SymbolInfo, Workspace } from "../data/model";
import { expiryChoices, expiryLabel, MoveMode, moveLeg, newPosition, OptionPosition, placementBasis, Structure, structureLabel, todayNY } from "../data/options";
import type { useFavourites, usePositions } from "../data/usePositions";
import { cachedCandles, Store } from "../data/store";
import { REGISTRY } from "../indicators";
import { Close, Indicators, Legs, Pencil, Plus, Star } from "./icons";
import { AskText, ConfirmDelete, MoreMenu } from "./parts";
import { DrawSheet, IndicatorSheet, SymbolSearch } from "./sheets";
import { OptionsSheet, PositionSheet } from "./OptionSheets";

type WS = ReturnType<typeof import("../data/useWorkspaces").useWorkspaces>;
type Pos = ReturnType<typeof usePositions>;
type Fav = ReturnType<typeof useFavourites>;

const EXPIRY_KEY = "stockwizard.expiryDays";
/** The expiry a new structure gets: as many weekdays out as last time (1 to start). */
function defaultExpiry() {
  let n = 1;
  try { n = Math.min(14, Math.max(0, Number(localStorage.getItem(EXPIRY_KEY) ?? 1) || 0)); } catch { /* fine */ }
  return expiryChoices(todayNY(), 15)[n];
}

export default function ChartScreen(props: {
  store: Store; ws: WS; pos: Pos; fav: Fav; symbols: SymbolInfo[]; firstSymbol: () => string; single?: boolean;
}) {
  const { store, ws, pos, fav } = props;
  const w = ws.active;
  const [candles, setCandles] = useState<Candles>(emptyCandles());
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<"symbol" | "indicators" | "draw" | "options" | null>(null);
  const [openIndicator, setOpenIndicator] = useState<string | null>(null);
  const [expiry, setExpiryState] = useState(defaultExpiry);
  const [adjusting, setAdjusting] = useState<string | null>(null);
  const [moveMode, setMoveMode] = useState<MoveMode>("whole");
  const [details, setDetails] = useState<OptionPosition | null>(null);
  const [deletingPos, setDeletingPos] = useState<OptionPosition | null>(null);
  const [tapMode, setTapMode] = useState<TapMode>("none");
  const [anchorFor, setAnchorFor] = useState<string | null>(null);
  const [trendStart, setTrendStart] = useState<{ time: number; price: number } | null>(null);
  const [renaming, setRenaming] = useState<Workspace | null>(null);
  const [deleting, setDeleting] = useState<Workspace | null>(null);

  // Never leave the screen without a tab.
  useEffect(() => {
    if (ws.loaded && !ws.list.length) ws.add(props.firstSymbol(), "1d");
  }, [ws.loaded, ws.list.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!w) return;
    let live = true;
    setLoading(true);
    setLoadError(null);
    cachedCandles(store, w.symbol, w.timeframe)
      .then((c) => live && setCandles(c))
      .catch((e) => live && (setCandles(emptyCandles()), setLoadError(String(e.message ?? e))))
      .finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [store, w?.symbol, w?.timeframe]); // eslint-disable-line react-hooks/exhaustive-deps

  const stopTapping = () => { setTapMode("none"); setTrendStart(null); setAnchorFor(null); };
  useEffect(stopTapping, [w?.id]);
  useEffect(() => setAdjusting(null), [w?.id, w?.symbol]);

  const onTap = (time: number, price: number) => {
    if (!w || tapMode === "none") return;
    if (tapMode === "level") {
      ws.update({ ...w, drawings: [...w.drawings, { id: newId(), kind: "level", price }] });
      stopTapping();
    } else if (tapMode === "trend") {
      if (!trendStart) setTrendStart({ time, price });
      else if (time !== trendStart.time) {
        ws.update({ ...w, drawings: [...w.drawings, { id: newId(), kind: "trendline", a: trendStart, b: { time, price } }] });
        stopTapping();
      }
    } else if (tapMode === "anchor" && anchorFor) {
      const anchor = new Date(time * 1000).toISOString();
      ws.update({ ...w, indicators: w.indicators.map((i) => (i.id === anchorFor ? { ...i, params: { ...i.params, anchor } } : i)) });
      stopTapping();
    }
  };

  const tapPrompt =
    tapMode === "level" ? "Tap the chart where the level goes"
    : tapMode === "trend" ? (trendStart ? "Tap the trendline's second point" : "Tap the trendline's first point")
    : tapMode === "anchor" ? "Tap the candle VWAP starts from" : "";

  const sourceBadge = useMemo(() => {
    if (candles.source === "made-up") return <span className="badge est">Made-up candles</span>;
    if (candles.source === "yahoo-unofficial") return <span className="badge est" title="Free, unofficial source. Nothing on it counts as validated.">Free data source</span>;
    return null;
  }, [candles.source]);

  if (!w) return <div className="main"><div className="chartcard"><div className="chartmsg">Loading…</div></div></div>;

  // A tab still carrying its automatic name ("SPY 1d") follows its symbol and timeframe; a name typed in stays.
  const autoName = (sym: string, tf: Timeframe) => (w.name === `${w.symbol} ${w.timeframe}` ? `${sym} ${tf}` : w.name);
  const setTf = (tf: Timeframe) => ws.update({ ...w, timeframe: tf, name: autoName(w.symbol, tf) });
  const positions = pos.forSymbol(w.symbol);
  const basis = placementBasis(candles);
  const setExpiry = (e: string) => {
    setExpiryState(e);
    const n = expiryChoices(todayNY(), 15).indexOf(e);
    if (n >= 0) try { localStorage.setItem(EXPIRY_KEY, String(n)); } catch { /* fine */ }
  };
  const place = (structure: Structure) => {
    if (!basis) return;
    const p = newPosition(w.symbol, structure, basis, expiry);
    pos.save(p);
    setSheet(null);
    setMoveMode("whole");
    setAdjusting(p.id);
  };
  const adjustingPos = positions.find((p) => p.id === adjusting) ?? null;
  const dragLeg = (id: string, leg: number, price: number) => {
    const p = positions.find((x) => x.id === id);
    if (p) { const next = moveLeg(p, leg, price, moveMode); if (next !== p) pos.save(next); }
  };

  // Favourites: indicators already on this chart and structures already placed show as chips of their own, not again here.
  const favShown = fav.list.filter((f) => (f.kind === "indicator"
    ? !w.indicators.some((i) => sameIndicator(i, f)) && !(REGISTRY[f.name]?.intradayOnly && w.timeframe === "1d")
    : true));
  const addFavourite = (f: Favourite) => {
    if (f.kind === "indicator") ws.update({ ...w, indicators: [...w.indicators, indicator(f.name, f.params)] });
    else place(f.structure);
  };
  const favLabel = (f: Favourite) => (f.kind === "indicator" ? REGISTRY[f.name]?.short({ ...REGISTRY[f.name].defaults, ...f.params }) : structureLabel(f.structure));

  return (
    <div className="main">
      {!props.single && <div className="tabs" role="tablist" aria-label="Workspace tabs">
        {ws.list.map((t) => (
          <div key={t.id} className={`tab${t.id === w.id ? " on" : ""}`}>
            <button role="tab" aria-selected={t.id === w.id} className="tname" onClick={() => ws.setActiveId(t.id)}>{t.name}</button>
            <MoreMenu className="tmore" label={`More for ${t.name}`} items={[
              { label: "Rename", onPick: () => setRenaming(t) },
              { label: "Duplicate", onPick: () => setRenaming(ws.duplicate(t)) },
              { label: "-", onPick: () => {} },
              { label: "Delete tab", danger: true, onPick: () => setDeleting(t) },
            ]}>⋯</MoreMenu>
          </div>
        ))}
        <button className="tplus" aria-label="New tab" onClick={() => ws.add(w.symbol, w.timeframe)}><Plus /></button>
      </div>}

      <div className="bar">
        <button className="tool sym" aria-label={`Symbol ${w.symbol}, change`} onClick={() => setSheet("symbol")}>{w.symbol}</button>
        <div className="seg" role="group" aria-label="Timeframe">
          {TIMEFRAMES.map((tf) => (
            <button key={tf} className={tf === w.timeframe ? "on" : ""} aria-pressed={tf === w.timeframe} onClick={() => setTf(tf)}>{tf}</button>
          ))}
        </div>
        <button className="tool" aria-label="Indicators" onClick={() => { setOpenIndicator(null); setSheet("indicators"); }}><Indicators /><span className="word">Indicators</span></button>
        <button className={`tool${adjusting ? " on" : ""}`} aria-label="Options" onClick={() => setSheet("options")}><Legs /><span className="word">Options</span></button>
        <button className={`tool${tapMode === "level" || tapMode === "trend" ? " on" : ""}`} aria-label="Draw" onClick={() => setSheet("draw")}><Pencil /><span className="word">Draw</span></button>
      </div>

      <div className="chipbar" aria-label="On this chart">
        {w.indicators.map((i) => {
          const name = REGISTRY[i.name]?.short(i.params) ?? i.name;
          return (
            <span key={i.id} className="xchip">
              <button className="xname" onClick={() => { setOpenIndicator(i.id); setSheet("indicators"); }} aria-label={`${name} settings`}>{name}</button>
              <button className="x" aria-label={`Remove ${name}`} onClick={() => ws.update({ ...w, indicators: w.indicators.filter((x) => x.id !== i.id) })}><Close /></button>
            </span>
          );
        })}
        {positions.map((p) => {
          const name = `${structureLabel(p.structure)} ${expiryLabel(p.expiry)}`;
          return (
            <span key={p.id} className={`xchip opt ${p.status}${p.id === adjusting ? " on" : ""}`}>
              <button className="xname" aria-label={`${name}, adjust`} onClick={() => setAdjusting(p.id === adjusting ? null : p.id)}>{name}</button>
              <button className="x" aria-label={`Delete ${name}`} onClick={() => setDeletingPos(p)}><Close /></button>
            </span>
          );
        })}
        {favShown.length > 0 && <span className="favmark" aria-hidden="true"><Star filled /></span>}
        {favShown.map((f, n) => (
          <button key={n} className={`chip fav${f.kind === "structure" ? " opt" : ""}`} disabled={f.kind === "structure" && !basis}
            aria-label={`Add ${favLabel(f)}`} onClick={() => addFavourite(f)}>+ {favLabel(f)}</button>
        ))}
      </div>

      <div className="chartcard">
        <Chart candles={candles} timeframe={w.timeframe} indicators={w.indicators} drawings={w.drawings}
          viewKey={`${w.id}|${w.symbol}|${w.timeframe}`} onTap={onTap}
          positions={positions} editId={adjusting} onDragLeg={dragLeg} />
        {adjustingPos && !tapPrompt && !details && (
          <div className="adjbanner" role="status">
            <span>Drag a line to move</span>
            <div className="seg" role="group" aria-label="What moves">
              {([["whole", "All"], ["side", "Side"], ["leg", "Leg"]] as const).map(([m, label]) => (
                <button key={m} className={moveMode === m ? "on" : ""} aria-pressed={moveMode === m} onClick={() => setMoveMode(m)}>{label}</button>
              ))}
            </div>
            <button className="adjbtn" onClick={() => setDetails(adjustingPos)}>Details</button>
            <button className="adjbtn" onClick={() => setAdjusting(null)}>Done</button>
          </div>
        )}
        {sourceBadge && <div className="srcbadge">{sourceBadge}</div>}
        {tapPrompt && (
          <div className="tapbanner" role="status">{tapPrompt}<button onClick={stopTapping}>Cancel</button></div>
        )}
        {!candles.time.length && (
          <div className="chartmsg">
            {loading ? "Loading candles…" : loadError ? `Couldn't load candles: ${loadError}` : `No ${w.symbol} ${w.timeframe} candles in the database yet.`}
          </div>
        )}
      </div>
      <div className="hint" style={{ margin: 0 }} aria-live="polite">
        {ws.sync === "saving" ? "Saving…" : ws.sync === "offline" ? "Offline: changes are kept on this device" : ws.sync === "error" ? "Couldn't save: will retry" : "Saved"}
      </div>

      {sheet === "symbol" && (
        <SymbolSearch symbols={props.symbols} onClose={() => setSheet(null)}
          onPick={(s) => { ws.update({ ...w, symbol: s, name: autoName(s, w.timeframe) }); setSheet(null); }} />
      )}
      {sheet === "indicators" && (
        <IndicatorSheet indicators={w.indicators} timeframe={w.timeframe} onClose={() => setSheet(null)} open={openIndicator}
          favourites={fav.list} onFavourites={fav.set}
          onChange={(list) => ws.update({ ...w, indicators: list })}
          onPickAnchor={(id) => { setSheet(null); setAnchorFor(id); setTapMode("anchor"); }} />
      )}
      {sheet === "draw" && (
        <DrawSheet drawings={w.drawings} onClose={() => setSheet(null)}
          onChange={(d) => ws.update({ ...w, drawings: d })}
          onTool={(tool) => { setSheet(null); setTrendStart(null); setTapMode(tool); }} />
      )}
      {sheet === "options" && (
        <OptionsSheet symbol={w.symbol} positions={positions} expiry={expiry} favourites={fav.list} canPlace={!!basis}
          onExpiry={setExpiry} onPlace={place} onClose={() => setSheet(null)}
          onOpen={(p) => { setSheet(null); setDetails(p); }}
          onFavourite={(st, on) => fav.set(on ? [...fav.list, { kind: "structure", structure: st }] : fav.list.filter((f) => !(f.kind === "structure" && f.structure === st)))} />
      )}
      {details && (
        <PositionSheet position={details} onChange={(p) => { pos.save(p); if (p.status === "closed" && adjusting === p.id) setAdjusting(null); }}
          onClose={() => setDetails(null)}
          onAdjust={() => { setAdjusting(details.id); setDetails(null); }}
          onDelete={() => { setDeletingPos(positions.find((p) => p.id === details.id) ?? details); setDetails(null); }} />
      )}
      {deletingPos && (
        <ConfirmDelete what={`the ${structureLabel(deletingPos.structure)} on ${deletingPos.symbol}, ${expiryLabel(deletingPos.expiry)}`}
          detail={`Its ${deletingPos.legs.length} leg${deletingPos.legs.length === 1 ? "" : "s"} (${deletingPos.legs.map((l) => l.strike).join(" / ")})${deletingPos.status === "bought" ? ". It is marked bought: deleting it here doesn't close anything at a broker" : ""}${deletingPos.note ? " and its note" : ""}. To keep a record, mark it Closed instead.`}
          onCancel={() => setDeletingPos(null)}
          onDelete={() => { pos.remove(deletingPos); if (adjusting === deletingPos.id) setAdjusting(null); setDeletingPos(null); }} />
      )}
      {renaming && (
        <AskText title="Rename tab" label="Name" value={renaming.name} onClose={() => setRenaming(null)}
          onDone={(name) => { const cur = ws.list.find((x) => x.id === renaming.id); if (cur) ws.update({ ...cur, name }); }} />
      )}
      {deleting && (
        <ConfirmDelete what={`the tab “${deleting.name}”`}
          detail={`Its ${deleting.indicators.length} indicator${deleting.indicators.length === 1 ? "" : "s"} and ${deleting.drawings.length} drawing${deleting.drawings.length === 1 ? "" : "s"}. The candles stay.`}
          onCancel={() => setDeleting(null)} onDelete={() => { ws.remove(deleting); setDeleting(null); }} />
      )}
    </div>
  );
}
