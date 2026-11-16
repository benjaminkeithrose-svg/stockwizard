// What the app saves: workspace tabs and watchlists. Shapes match the
// Supabase tables (supabase/migrations/).

import type { Timeframe } from "./candles";
import { codeVersion, Params, REGISTRY } from "../indicators";

export interface IndicatorInstance {
  id: string;
  name: string;
  params: Params;
  code_version: string;
}

export type Drawing =
  | { id: string; kind: "level"; price: number }
  | { id: string; kind: "trendline"; a: { time: number; price: number }; b: { time: number; price: number } };

export interface Workspace {
  id: string;
  name: string;
  position: number;
  symbol: string;
  timeframe: Timeframe;
  indicators: IndicatorInstance[];
  drawings: Drawing[];
  layout: Record<string, unknown>;
  updated_at?: string;
}

export interface SymbolInfo {
  symbol: string;
  market: "US" | "ASX";
  instrument_type: string;
  tradable: boolean;
  name: string | null;
}

export interface Watchlist {
  id: number | string;
  name: string;
  is_universe: boolean;
  symbols: string[];
}

export const newId = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;

export function indicator(name: string, params: Params = {}): IndicatorInstance {
  return { id: newId(), name, params: { ...REGISTRY[name].defaults, ...params }, code_version: codeVersion(name) };
}

export function newWorkspace(symbol: string, timeframe: Timeframe, position: number): Workspace {
  return {
    id: newId(),
    name: `${symbol} ${timeframe}`,
    position,
    symbol,
    timeframe,
    indicators: [indicator("ema", { length: 21 }), indicator("squeeze")],
    drawings: [],
    layout: {},
  };
}

/** A copy for editing: new ids, "copy" in the name, placed after the original. */
export function duplicateWorkspace(w: Workspace, position: number): Workspace {
  return {
    ...structuredClone(w),
    id: newId(),
    name: `${w.name} copy`,
    position,
    indicators: w.indicators.map((i) => ({ ...structuredClone(i), id: newId() })),
    drawings: w.drawings.map((d) => ({ ...structuredClone(d), id: newId() })),
    updated_at: undefined,
  };
}
