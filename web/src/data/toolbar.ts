// Where the chart toolbar sits (Ben, 19 Nov 2026): along the top (the default), down the
// side, floating in front of the charts where it was dragged, or hidden behind one round
// button. Remembered on this device only, since each screen set-up is different.

import { useEffect, useState } from "react";

export type ToolbarMode = "top" | "side" | "float" | "hidden";
export interface ToolbarPlace {
  mode: ToolbarMode;
  /** Where the floating toolbar sits, in pixels from the window's top left. */
  x: number;
  y: number;
  /** The place to go back to when a hidden toolbar is shown again. */
  back: Exclude<ToolbarMode, "hidden">;
}

export const TOOLBAR_KEY = "stockwizard.toolbar";
const EVENT = "stockwizard-toolbar";
export const DEFAULT_PLACE: ToolbarPlace = { mode: "top", x: 80, y: 140, back: "top" };

export function readPlace(): ToolbarPlace {
  try {
    const v = JSON.parse(localStorage.getItem(TOOLBAR_KEY) ?? "null");
    if (v && ["top", "side", "float", "hidden"].includes(v.mode)) return { ...DEFAULT_PLACE, ...v };
  } catch { /* fine: the default */ }
  return DEFAULT_PLACE;
}

/** Keeps a floating toolbar on screen: at least `keep` pixels of it inside the window. */
export function clampPlace(x: number, y: number, win: { w: number; h: number }, keep = 60): { x: number; y: number } {
  return { x: Math.min(Math.max(x, keep - 300), win.w - keep), y: Math.min(Math.max(y, 0), win.h - keep) };
}

/** Moving to a mode; hiding remembers where to come back to. */
export function nextPlace(p: ToolbarPlace, mode: ToolbarMode): ToolbarPlace {
  return mode === "hidden" ? { ...p, mode, back: p.mode === "hidden" ? p.back : p.mode } : { ...p, mode, back: mode };
}

export function useToolbarPlace(): [ToolbarPlace, (p: ToolbarPlace) => void] {
  const [place, setPlace] = useState(readPlace);
  useEffect(() => {
    const sync = () => setPlace(readPlace());
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
  }, []);
  const save = (p: ToolbarPlace) => {
    setPlace(p);
    try { localStorage.setItem(TOOLBAR_KEY, JSON.stringify(p)); } catch { /* fine: this visit only */ }
    window.dispatchEvent(new Event(EVENT));
  };
  return [place, save];
}
