// The candlestick chart with indicator overlays, indicator panes and drawings,
// on TradingView's Lightweight Charts (Apache 2.0; its logo link stays on as
// the licence asks). Times are shown in New York time, the market's own.

import { useEffect, useRef } from "react";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  HistogramSeries,
  IChartApi,
  IPriceLine,
  ISeriesApi,
  LineSeries,
  LineStyle,
  LogicalRange,
  Time,
  UTCTimestamp,
} from "lightweight-charts";
import type { Candles, Timeframe } from "../data/candles";
import type { Drawing, IndicatorInstance } from "../data/model";
import { expiryLabel, legName, OptionPosition } from "../data/options";
import { REGISTRY, unavailable } from "../indicators";

export type TapMode = "none" | "level" | "trend" | "anchor";

interface Props {
  candles: Candles;
  timeframe: Timeframe;
  indicators: IndicatorInstance[];
  drawings: Drawing[];
  /** Changes when the symbol or timeframe changes, so the view resets then and only then. */
  viewKey: string;
  onTap?: (time: number, price: number) => void;
  /** A card on a chart page: no panning or zooming, so the card can be tapped and dragged. */
  still?: boolean;
  /** Option structures on this symbol: a line per leg, purple while planned, green once bought. */
  positions?: OptionPosition[];
  /** The structure being adjusted: its lines are bold and can be dragged. */
  editId?: string | null;
  onDragLeg?: (positionId: string, leg: number, price: number) => void;
}

export const PLANNED = "#7A3E9D", BOUGHT = "#237F35";

const nyTime = new Intl.DateTimeFormat("en-AU", {
  timeZone: "America/New_York", day: "numeric", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
});
const nyDay = new Intl.DateTimeFormat("en-AU", { timeZone: "America/New_York", day: "numeric", month: "short" });
const nyMonth = new Intl.DateTimeFormat("en-AU", { timeZone: "America/New_York", month: "short", year: "2-digit" });
const nyClock = new Intl.DateTimeFormat("en-AU", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false });

const UP = "#237F35", DOWN = "#B2232F";

function histogramColour(values: number[], i: number) {
  const v = values[i], prev = values[i - 1];
  const rising = i > 0 && v > prev;
  if (v >= 0) return rising ? "#00708D" : "#ACD3E1";
  return rising ? "#E8A0A6" : "#B2232F";
}

export default function Chart({ candles, timeframe, indicators, drawings, viewKey, onTap, still, positions, editId, onDragLeg }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const priceSeries = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const drawn = useRef<{ lines: IPriceLine[]; series: ISeriesApi<"Line">[] }>({ lines: [], series: [] });
  const lastKey = useRef("");
  const tap = useRef(onTap);
  tap.current = onTap;
  const optionLines = useRef<IPriceLine[]>([]);
  const strikes = useRef<number[]>([]); // kept in view: the price scale stretches to show every leg
  strikes.current = (positions ?? []).flatMap((p) => p.legs.map((l) => l.strike));
  const editing = useRef<{ pos: OptionPosition | null; drag: typeof onDragLeg }>({ pos: null, drag: undefined });
  editing.current = { pos: positions?.find((p) => p.id === editId) ?? null, drag: onDragLeg };

  // Create the chart once.
  useEffect(() => {
    const c = createChart(box.current!, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "#FFFFFF" },
        textColor: "#4D4D4F",
        fontFamily: "Roboto, Arial, 'Helvetica Neue', Helvetica, sans-serif",
        attributionLogo: true,
        panes: { separatorColor: "#E3E3E3" },
      },
      grid: { vertLines: { color: "#F2F7FA" }, horzLines: { color: "#F2F7FA" } },
      rightPriceScale: { borderColor: "#E3E3E3" },
      timeScale: {
        borderColor: "#E3E3E3",
        timeVisible: true,
        tickMarkFormatter: (t: Time, type: number) => {
          const d = new Date((t as number) * 1000);
          return type >= 3 ? nyClock.format(d) : type === 2 ? nyDay.format(d) : nyMonth.format(d);
        },
      },
      localization: { timeFormatter: (t: Time) => nyTime.format(new Date((t as number) * 1000)) },
    });
    // The browser's own clicks: the library's click handler swallows the second of two quick taps
    // as a double-click, and a trendline needs exactly two taps.
    const el = box.current!;
    const click = (e: MouseEvent) => {
      const s = priceSeries.current;
      if (!s || !tap.current) return;
      const r = el.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      if (y > c.panes()[0].getHeight()) return; // taps in the indicator panes don't place drawings
      const time = c.timeScale().coordinateToTime(x);
      const price = s.coordinateToPrice(y);
      if (time !== null && price !== null) tap.current(time as number, price);
    };
    el.addEventListener("click", click);

    // Dragging a leg of the structure being adjusted. Caught before the chart sees it, so the chart doesn't pan.
    let drag: { id: string; leg: number } | null = null;
    const grab = (e: PointerEvent | MouseEvent | TouchEvent) => {
      const s = priceSeries.current, pos = editing.current.pos;
      if (!s || !pos || !editing.current.drag) return;
      if (e.type !== "pointerdown") { if (drag) { e.stopPropagation(); if (e.cancelable) e.preventDefault(); } return; }
      const pe = e as PointerEvent;
      const r = el.getBoundingClientRect();
      const y = pe.clientY - r.top;
      if (y > c.panes()[0].getHeight()) return;
      const reach = pe.pointerType === "touch" ? 18 : 8;
      let best = -1, dist = reach + 1;
      pos.legs.forEach((l, i) => {
        const ly = s.priceToCoordinate(l.strike);
        if (ly !== null && Math.abs(ly - y) < dist) { dist = Math.abs(ly - y); best = i; }
      });
      if (best < 0) return;
      drag = { id: pos.id, leg: best };
      e.stopPropagation();
      e.preventDefault();
      c.applyOptions({ handleScroll: false, handleScale: false });
    };
    const move = (e: PointerEvent) => {
      const s = priceSeries.current;
      if (!drag || !s) return;
      const price = s.coordinateToPrice(e.clientY - el.getBoundingClientRect().top);
      if (price !== null) editing.current.drag?.(drag.id, drag.leg, price);
    };
    const drop = () => {
      if (!drag) return;
      drag = null;
      if (!still) c.applyOptions({ handleScroll: true, handleScale: true });
    };
    for (const t of ["pointerdown", "mousedown", "touchstart"] as const) el.addEventListener(t, grab, { capture: true, passive: false });
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", drop);
    window.addEventListener("pointercancel", drop);
    if (still) c.applyOptions({ handleScroll: false, handleScale: false, crosshair: { mode: 2 } });
    chart.current = c;
    return () => {
      el.removeEventListener("click", click);
      for (const t of ["pointerdown", "mousedown", "touchstart"] as const) el.removeEventListener(t, grab, { capture: true });
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", drop);
      window.removeEventListener("pointercancel", drop);
      c.remove();
      chart.current = null;
    };
  }, []);

  // Candles and indicators: rebuild the series, keep the view unless the symbol or timeframe changed.
  useEffect(() => {
    const c = chart.current!;
    const keep: LogicalRange | null = lastKey.current === viewKey ? c.timeScale().getVisibleLogicalRange() : null;
    drawn.current = { lines: [], series: [] };
    for (let i = c.panes().length - 1; i > 0; i--) c.removePane(i);
    for (const s of c.panes()[0]?.getSeries() ?? []) c.removeSeries(s);
    priceSeries.current = null;
    if (!candles.time.length) return;

    const t = candles.time as UTCTimestamp[];
    const daily = timeframe === "1d";
    c.applyOptions({ timeScale: { timeVisible: !daily, secondsVisible: false } });

    const price = c.addSeries(CandlestickSeries, {
      upColor: UP, downColor: DOWN, borderUpColor: UP, borderDownColor: DOWN, wickUpColor: UP, wickDownColor: DOWN,
    });
    price.setData(t.map((time, i) => ({ time, open: candles.open[i], high: candles.high[i], low: candles.low[i], close: candles.close[i] })));
    price.applyOptions({
      autoscaleInfoProvider: (base: () => { priceRange: { minValue: number; maxValue: number } } | null) => {
        const r = base();
        if (!r || !strikes.current.length) return r;
        return { ...r, priceRange: {
          minValue: Math.min(r.priceRange.minValue, ...strikes.current), maxValue: Math.max(r.priceRange.maxValue, ...strikes.current),
        } };
      },
    });
    priceSeries.current = price;

    let pane = 0;
    for (const inst of indicators) {
      const def = REGISTRY[inst.name];
      if (!def || unavailable(def, inst.params, timeframe)) continue;
      let out;
      try {
        out = def.run(candles, { ...def.defaults, ...inst.params }, timeframe);
      } catch {
        continue;
      }
      const target = def.placement === "price" ? 0 : ++pane;
      for (const style of def.lines) {
        const values = out[style.column];
        if (style.kind === "histogram") {
          const s = c.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false }, target);
          s.setData(t.map((time, i) => (Number.isNaN(values[i]) ? { time } : { time, value: values[i], color: histogramColour(values, i) })));
        } else if (style.kind === "dots") {
          const s = c.addSeries(LineSeries, {
            lineVisible: false, pointMarkersVisible: true, pointMarkersRadius: 2.5,
            priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
          }, target);
          s.setData(t.map((time, i) => (Number.isNaN(values[i]) ? { time } : { time, value: 0, color: values[i] ? style.colour : "#237F35" })));
        } else {
          const s = c.addSeries(LineSeries, {
            color: style.colour, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
          }, target);
          s.setData(t.map((time, i) => (Number.isNaN(values[i]) ? { time } : { time, value: values[i] })));
        }
      }
    }
    const panes = c.panes();
    panes.forEach((p, i) => p.setStretchFactor(i === 0 ? Math.max(2, panes.length) : 1));

    if (keep) c.timeScale().setVisibleLogicalRange(keep);
    else c.timeScale().setVisibleLogicalRange({ from: Math.max(0, t.length - (still ? 90 : 150)), to: t.length + 3 } as LogicalRange);
    lastKey.current = viewKey;
  }, [candles, timeframe, indicators, viewKey]);

  // Drawings: horizontal levels and trendlines, laid over the price.
  useEffect(() => {
    const c = chart.current, price = priceSeries.current;
    if (!c || !price) return;
    drawn.current.lines.forEach((l) => price.removePriceLine(l));
    drawn.current.series.forEach((s) => c.removeSeries(s));
    drawn.current = { lines: [], series: [] };
    for (const d of drawings) {
      if (d.kind === "level") {
        drawn.current.lines.push(
          price.createPriceLine({ price: d.price, color: "#00287B", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "" }),
        );
      } else {
        const [a, b] = d.a.time <= d.b.time ? [d.a, d.b] : [d.b, d.a];
        if (a.time === b.time) continue;
        const s = c.addSeries(LineSeries, {
          color: "#00287B", lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
        }, 0);
        s.setData([{ time: a.time as UTCTimestamp, value: a.price }, { time: b.time as UTCTimestamp, value: b.price }]);
        drawn.current.series.push(s);
      }
    }
  }, [drawings, candles, timeframe, indicators, viewKey]);

  // Option structures: a price line per leg. Short legs solid, long legs (the wings) dotted.
  useEffect(() => {
    const price = priceSeries.current;
    if (!price) return;
    optionLines.current.forEach((l) => price.removePriceLine(l));
    optionLines.current = [];
    for (const p of positions ?? []) {
      const colour = p.status === "bought" ? BOUGHT : PLANNED;
      const bold = p.id === editId;
      for (const l of p.legs) {
        optionLines.current.push(price.createPriceLine({
          price: l.strike, color: colour, lineWidth: bold ? 3 : 1,
          lineStyle: l.side === "sell" ? LineStyle.Solid : LineStyle.Dotted,
          axisLabelVisible: true, title: still ? "" : `${legName(l)} · ${expiryLabel(p.expiry)}`,
        }));
      }
    }
    // Where the adjustable legs sit on screen right now (the browser test drags them).
    const ed = positions?.find((p) => p.id === editId);
    if (box.current) box.current.dataset.legs = ed ? JSON.stringify(ed.legs.map((l) => price.priceToCoordinate(l.strike))) : "";
  }, [positions, editId, candles, timeframe, indicators, viewKey, still]);

  return <div className="chartbox" ref={box} data-testid="chart" />;
}
