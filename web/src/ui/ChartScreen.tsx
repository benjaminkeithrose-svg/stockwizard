// The chart workspace: tabs, then the toolbar, then the chart. Every control
// sits above the chart, none below it.

import { useEffect, useMemo, useState } from "react";
import Chart, { TapMode } from "../chart/Chart";
import { Candles, emptyCandles, TIMEFRAMES, Timeframe } from "../data/candles";
import { newId, SymbolInfo, Workspace } from "../data/model";
import { cachedCandles, Store } from "../data/store";
import { REGISTRY } from "../indicators";
import { Indicators, Pencil, Plus } from "./icons";
import { AskText, ConfirmDelete, MoreMenu } from "./parts";
import { DrawSheet, IndicatorSheet, SymbolSearch } from "./sheets";

type WS = ReturnType<typeof import("../data/useWorkspaces").useWorkspaces>;

export default function ChartScreen(props: { store: Store; ws: WS; symbols: SymbolInfo[]; firstSymbol: () => string; single?: boolean }) {
  const { store, ws } = props;
  const w = ws.active;
  const [candles, setCandles] = useState<Candles>(emptyCandles());
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<"symbol" | "indicators" | "draw" | null>(null);
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
  const shortNames = w.indicators.map((i) => REGISTRY[i.name]?.short(i.params)).filter(Boolean);

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
        <button className="tool" aria-label="Indicators" onClick={() => setSheet("indicators")}><Indicators /><span className="word">Indicators</span></button>
        <button className={`tool${tapMode === "level" || tapMode === "trend" ? " on" : ""}`} aria-label="Draw" onClick={() => setSheet("draw")}><Pencil /><span className="word">Draw</span></button>
      </div>

      <div className="chartcard">
        <Chart candles={candles} timeframe={w.timeframe} indicators={w.indicators} drawings={w.drawings}
          viewKey={`${w.id}|${w.symbol}|${w.timeframe}`} onTap={onTap} />
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
        {shortNames.join(" · ") || "No indicators"}{" · "}
        {ws.sync === "saving" ? "Saving…" : ws.sync === "offline" ? "Offline: changes are kept on this device" : ws.sync === "error" ? "Couldn't save: will retry" : "Saved"}
      </div>

      {sheet === "symbol" && (
        <SymbolSearch symbols={props.symbols} onClose={() => setSheet(null)}
          onPick={(s) => { ws.update({ ...w, symbol: s, name: autoName(s, w.timeframe) }); setSheet(null); }} />
      )}
      {sheet === "indicators" && (
        <IndicatorSheet indicators={w.indicators} timeframe={w.timeframe} onClose={() => setSheet(null)}
          onChange={(list) => ws.update({ ...w, indicators: list })}
          onPickAnchor={(id) => { setSheet(null); setAnchorFor(id); setTapMode("anchor"); }} />
      )}
      {sheet === "draw" && (
        <DrawSheet drawings={w.drawings} onClose={() => setSheet(null)}
          onChange={(d) => ws.update({ ...w, drawings: d })}
          onTool={(tool) => { setSheet(null); setTrendStart(null); setTapMode(tool); }} />
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
