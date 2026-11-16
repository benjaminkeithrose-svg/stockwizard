// Chart pages: up to 10 workspace tabs as cards on a page. On the PC, drag a
// card by its title bar and resize it from its corner; it snaps to the grid
// and the others make room. On the phone, one card per row. Tap a chart to
// open it full screen.

import { useEffect, useMemo, useRef, useState } from "react";
import Chart from "../chart/Chart";
import { Candles, emptyCandles } from "../data/candles";
import { addCard, Card, COLS, MAX_CARDS, moveCard, ordered, removeCard, resizeCard, rowsUsed } from "../data/grid";
import { ChartView, newId, Workspace } from "../data/model";
import { cachedCandles, Store } from "../data/store";
import type { useViews } from "../data/useViews";
import type { useWorkspaces } from "../data/useWorkspaces";
import { Plus } from "./icons";
import { AskText, ConfirmDelete, MoreMenu, Sheet } from "./parts";

type Views = ReturnType<typeof useViews>;
type WS = ReturnType<typeof useWorkspaces>;

const ROW = 56; // px per grid row on the PC
const GAP = 10;
const PHONE = 720;

function useWide() {
  const [wide, setWide] = useState(() => window.innerWidth >= PHONE);
  useEffect(() => {
    const on = () => setWide(window.innerWidth >= PHONE);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return wide;
}

function CardChart({ store, w }: { store: Store; w: Workspace }) {
  const [candles, setCandles] = useState<Candles>(emptyCandles());
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  useEffect(() => {
    let live = true;
    setState("loading");
    cachedCandles(store, w.symbol, w.timeframe)
      .then((c) => { if (live) { setCandles(c); setState("ok"); } })
      .catch(() => live && setState("error"));
    return () => { live = false; };
  }, [store, w.symbol, w.timeframe]);
  return (
    <>
      <Chart candles={candles} timeframe={w.timeframe} indicators={w.indicators} drawings={w.drawings}
        viewKey={`card|${w.id}|${w.symbol}|${w.timeframe}`} still />
      {!candles.time.length && (
        <div className="chartmsg">{state === "loading" ? "Loading…" : state === "error" ? "Couldn't load candles" : `No ${w.symbol} ${w.timeframe} candles yet`}</div>
      )}
    </>
  );
}

type Drag = { id: string; kind: "move" | "size"; sx: number; sy: number; dx: number; dy: number };

export default function PagesScreen(props: { store: Store; views: Views; ws: WS; onOpen: (workspaceId: string) => void }) {
  const { views, ws, store } = props;
  const v = views.active;
  const wide = useWide();
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [adding, setAdding] = useState(false);
  const [naming, setNaming] = useState<ChartView | "new" | null>(null);
  const [deleting, setDeleting] = useState<ChartView | null>(null);
  const moved = useRef(false);

  useEffect(() => {
    if (!box.current) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(box.current);
    return () => ro.disconnect();
  }, [wide, v?.id]);

  const byId = useMemo(() => new Map(ws.list.map((w) => [w.id, w])), [ws.list]);
  // Cards whose tab was deleted simply aren't shown.
  const cards = (v?.cards ?? []).filter((c) => byId.has(c.workspace_id));
  const colW = (width + GAP) / COLS;

  const setCards = (next: Card[]) => v && views.update({ ...v, cards: next });

  // Dragging: follow the pointer, then snap on release.
  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      if (Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) > 4) moved.current = true;
      setDrag((d) => d && { ...d, dx: e.clientX - d.sx, dy: e.clientY - d.sy });
    };
    const up = () => {
      setDrag((d) => {
        if (d && moved.current) {
          const c = cards.find((x) => x.id === d.id);
          if (c) {
            const cx = d.dx / colW, cy = d.dy / ROW;
            setCards(d.kind === "move" ? moveCard(cards, c.id, c.x + cx, c.y + cy) : resizeCard(cards, c.id, c.w + cx, c.h + cy));
          }
        }
        return null;
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
  }); // re-bound each render so `up` sees the current cards

  const start = (e: React.PointerEvent, id: string, kind: Drag["kind"]) => {
    if (!wide || e.button !== 0) return;
    e.preventDefault();
    moved.current = false;
    setDrag({ id, kind, sx: e.clientX, sy: e.clientY, dx: 0, dy: 0 });
  };

  const addToPage = (workspaceId: string) => {
    if (!v) return;
    const next = addCard(cards, { id: newId(), workspace_id: workspaceId });
    if (next) setCards(next);
    setAdding(false);
  };

  const newChartTab = () => {
    const base = ws.active;
    const created = ws.add(base?.symbol ?? "SPY", base?.timeframe ?? "1d");
    addToPage(created.id);
  };

  const pageTabs = (
    <div className="tabs" role="tablist" aria-label="Chart pages">
      {views.list.map((p) => (
        <div key={p.id} className={`tab${p.id === v?.id ? " on" : ""}`}>
          <button role="tab" aria-selected={p.id === v?.id} className="tname" onClick={() => views.setActiveId(p.id)}>{p.name}</button>
          <MoreMenu className="tmore" label={`More for ${p.name}`} items={[
            { label: "Rename", onPick: () => setNaming(p) },
            { label: "Duplicate", onPick: () => setNaming(views.duplicate(p)) },
            { label: "-", onPick: () => {} },
            { label: "Delete page", danger: true, onPick: () => setDeleting(p) },
          ]}>⋯</MoreMenu>
        </div>
      ))}
      <button className="tplus" aria-label="New page" onClick={() => setNaming("new")}><Plus /></button>
    </div>
  );

  const cardFrame = (c: Card, style: React.CSSProperties, phone: boolean) => {
    const w = byId.get(c.workspace_id)!;
    return (
      <div key={c.id} className={`gcard${drag?.id === c.id ? " dragging" : ""}`} style={style} data-testid="page-card" data-card={c.id}>
        <div className="gbar" onPointerDown={(e) => start(e, c.id, "move")} title={phone ? undefined : "Drag to move"}>
          <span className="gname">{w.name}</span>
          <MoreMenu className="icon" label={`More for ${w.name} on this page`} items={[
            { label: "Open full screen", onPick: () => props.onOpen(w.id) },
            { label: "Take off this page", onPick: () => setCards(removeCard(cards, c.id)) },
          ]} />
        </div>
        <div className="gbody" role="button" tabIndex={0} aria-label={`Open ${w.name} full screen`}
          onClick={() => !moved.current && props.onOpen(w.id)} onKeyDown={(e) => e.key === "Enter" && props.onOpen(w.id)}>
          <CardChart store={store} w={w} />
        </div>
        {!phone && <div className="gsize" aria-hidden="true" onPointerDown={(e) => start(e, c.id, "size")} />}
      </div>
    );
  };

  return (
    <div className="main">
      {pageTabs}
      {v && (
        <div className="bar">
          <button className="tool" onClick={() => setAdding(true)} disabled={cards.length >= MAX_CARDS}><Plus /><span>Add chart</span></button>
          <span className="hint" style={{ margin: 0 }}>
            {cards.length >= MAX_CARDS ? `${MAX_CARDS} charts is the most on one page` : `${cards.length} of ${MAX_CARDS} charts`}
            {wide && cards.length > 1 ? " · drag a title bar to move, a corner to resize" : ""}
          </span>
        </div>
      )}
      {!views.list.length && views.loaded && <p className="empty">No pages.</p>}
      {v && !cards.length && <p className="empty">No charts on this page.</p>}
      {v && cards.length > 0 && (
        <div className="gscroll">
          {wide ? (
            <div ref={box} className="grid" style={{ height: (rowsUsed(cards) + (drag ? 6 : 0)) * ROW }}>
              {drag && (() => {
                const c = cards.find((x) => x.id === drag.id)!;
                const cx = Math.round(drag.dx / colW), cy = Math.round(drag.dy / ROW);
                const g = drag.kind === "move"
                  ? { x: Math.max(0, Math.min(COLS - c.w, c.x + cx)), y: Math.max(0, c.y + cy), w: c.w, h: c.h }
                  : { x: c.x, y: c.y, w: Math.max(3, Math.min(COLS - c.x, c.w + cx)), h: Math.max(3, c.h + cy) };
                return <div className="gghost" style={{ left: g.x * colW, top: g.y * ROW, width: g.w * colW - GAP, height: g.h * ROW - GAP }} />;
              })()}
              {cards.map((c) => {
                const d = drag?.id === c.id ? drag : null;
                return cardFrame(c, {
                  position: "absolute",
                  left: c.x * colW + (d?.kind === "move" ? d.dx : 0),
                  top: c.y * ROW + (d?.kind === "move" ? d.dy : 0),
                  width: c.w * colW - GAP + (d?.kind === "size" ? d.dx : 0),
                  height: c.h * ROW - GAP + (d?.kind === "size" ? d.dy : 0),
                }, false);
              })}
            </div>
          ) : (
            <div className="glist">{ordered(cards).map((c) => cardFrame(c, { height: 280 }, true))}</div>
          )}
        </div>
      )}

      {adding && v && (
        <Sheet title="Add a chart to this page" onClose={() => setAdding(false)}>
          <div className="chips">
            {ws.list.filter((w) => !cards.some((c) => c.workspace_id === w.id)).map((w) => (
              <button key={w.id} className="chip" onClick={() => addToPage(w.id)}>{w.name}</button>
            ))}
            <button className="chip" onClick={newChartTab}><Plus />New chart tab</button>
          </div>
          <p className="hint">Each card is one of your chart tabs. Changing it full screen changes that tab everywhere.</p>
        </Sheet>
      )}
      {naming && (
        <AskText title={naming === "new" ? "New page" : "Rename page"} label="Name" value={naming === "new" ? "" : naming.name}
          onClose={() => setNaming(null)}
          onDone={(name) => { if (naming === "new") views.add(name); else { const cur = views.list.find((x) => x.id === naming.id); if (cur) views.update({ ...cur, name }); } }} />
      )}
      {deleting && (
        <ConfirmDelete what={`the page “${deleting.name}”`}
          detail={`Its layout of ${deleting.cards.length} chart${deleting.cards.length === 1 ? "" : "s"}. The chart tabs themselves stay.`}
          onCancel={() => setDeleting(null)} onDelete={() => { views.remove(deleting); setDeleting(null); }} />
      )}
    </div>
  );
}
