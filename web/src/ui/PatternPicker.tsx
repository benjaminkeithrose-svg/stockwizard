// Pattern markers on the chart (Ben, 19 Nov 2026): which of the 18 patterns to mark, chosen in the
// Indicators sheet and kept on this device. Each mark sits on the candle where the pattern became
// complete (data/patterns.ts, the Python library's twin), above the candle for bearish ones and below
// for bullish ones, grey for doji and inside bars, which lean neither way.

import { useEffect, useMemo, useState } from "react";
import type { Candles } from "../data/candles";
import { CANDLESTICK, CHART_PATTERNS, detect, PATTERNS, PatternName } from "../data/patterns";
import type { ChartMarker } from "../chart/Chart";
import { Info } from "./parts";

const KEY = "stockwizard.patternMarks";
const EVENT = "stockwizard-patternmarks";
/** Doji and inside bars are common (one day in five or so): left out when a whole group is switched on. */
const BUSY: PatternName[] = ["doji", "inside_bar"];

const read = (): PatternName[] => {
  try { return (JSON.parse(localStorage.getItem(KEY) ?? "[]") as string[]).filter((p): p is PatternName => p in PATTERNS); } catch { return []; }
};

export function usePatternMarks(): [PatternName[], (p: PatternName[]) => void] {
  const [on, setOn] = useState(read);
  useEffect(() => {
    const sync = () => setOn(read());
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
  }, []);
  const save = (p: PatternName[]) => {
    setOn(p);
    try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* this visit only */ }
    window.dispatchEvent(new Event(EVENT));
  };
  return [on, save];
}

const GREEN = "#237F35", RED = "#B2232F", GREY = "#6B7785";

/** The markers for the chosen patterns on these candles. */
export function usePatternMarkers(candles: Candles, on: PatternName[]): ChartMarker[] {
  return useMemo(() => {
    if (!on.length || candles.time.length < 30) return [];
    const d = detect(candles);
    const out: ChartMarker[] = [];
    for (const p of on) {
      const meta = PATTERNS[p];
      d[p].forEach((hit, i) => {
        if (!hit) return;
        out.push(meta.side === "up" ? { time: candles.time[i], text: meta.short, color: GREEN, position: "belowBar", shape: "arrowUp" }
          : meta.side === "down" ? { time: candles.time[i], text: meta.short, color: RED, position: "aboveBar", shape: "arrowDown" }
          : { time: candles.time[i], text: meta.short, color: GREY, position: "aboveBar", shape: "circle" });
      });
    }
    return out.sort((a, b) => a.time - b.time);
  }, [candles, on.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** The section in the Indicators sheet: a chip per pattern, and one for each group. */
export function PatternSection() {
  const [on, setOn] = usePatternMarks();
  const toggle = (p: PatternName) => setOn(on.includes(p) ? on.filter((x) => x !== p) : [...on, p]);
  const group = (names: PatternName[]) => {
    const wanted = names.filter((p) => !BUSY.includes(p));
    const all = wanted.every((p) => on.includes(p));
    setOn(all ? on.filter((p) => !names.includes(p)) : [...new Set([...on, ...wanted])]);
  };
  const row = (title: string, names: PatternName[]) => (
    <div style={{ marginBottom: 10 }}>
      <div className="hint" style={{ margin: "0 0 6px" }}>
        {title} · <button className="link" onClick={() => group(names)}>{names.filter((p) => !BUSY.includes(p)).every((p) => on.includes(p)) ? "none" : "all"}</button>
      </div>
      <div className="chips">
        {names.map((p) => (
          <button key={p} className={`chip${on.includes(p) ? " on" : ""}`} aria-pressed={on.includes(p)} onClick={() => toggle(p)}>{PATTERNS[p].label}</button>
        ))}
      </div>
    </div>
  );
  return (
    <>
      <h2>Patterns on the chart <Info term="chartpattern" /></h2>
      {row("Candlesticks", CANDLESTICK)}
      {row("Chart patterns", CHART_PATTERNS)}
      <p className="hint">Marked on the candle where each became complete: green below for bullish, red above for bearish. Kept on this device, for every chart.</p>
    </>
  );
}
