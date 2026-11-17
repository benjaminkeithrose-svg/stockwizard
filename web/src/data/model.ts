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

// --- scanner (read-only in the app; the server writes) ---

export interface ScanDef {
  id: string;
  label: string;
  rule: string;
  timeframe: Timeframe;
  params: Record<string, number>;
  symbols: string[] | null;
  tab: "squeeze_on" | "squeeze_fired" | "breakout" | "spy" | "custom";
  position: number;
}

export interface ScanResult {
  symbol: string;
  candle_ts: string;
  direction: "up" | "down" | null;
  vals: Record<string, number | null>;
  context: Record<string, number | null>;
}

export interface ScanRun {
  id: number;
  scan_id: string;
  ran_at: string;
  as_of: string;
  symbols: string[];
  source: string;
  matches: number;
  notes: string | null;
  results: ScanResult[];
}

// --- chart pages ---

import type { Card } from "./grid";

export interface ChartView {
  id: string;
  name: string;
  position: number;
  cards: Card[];
  updated_at?: string;
}

// --- backtests (read-only in the app; the server writes) ---

export interface StrategyDef {
  id: string;
  label: string;
  family: string;
  config: Record<string, unknown> & { study?: boolean; trade_symbol: string; signal_symbol: string };
  version: number;
  start_date: string;
  split_date: string;
  position: number;
  notes: string | null;
}

/** A period's results. Numbers, plus `exits` (count by reason) and, for windows, `period` (build, held_back or both). */
export interface Metrics {
  [key: string]: number | null | string | Record<string, number> | undefined;
  exits?: Record<string, number>;
  period?: string;
}

export interface BacktestRun {
  id: number;
  strategy_id: string;
  ran_at: string;
  as_of: string;
  start_date: string;
  split_date: string;
  source: string;
  warnings: string[];
  held_back_burned: boolean;
  skipped: Record<string, number>;
  metrics: { period: string; kind: "build" | "held_back" | "window"; metrics: Metrics; position: number }[];
}

export interface BacktestTrade {
  n: number;
  period: "build" | "held_back";
  signal_ts: string;
  entry_ts: string;
  entry_price: number;
  exit_ts: string | null;
  exit_price: number | null;
  exit_reason: "target" | "stop" | "time" | "open";
  bars: number;
  return_pct: number | null;
}

// --- pattern lab (read-only in the app; the server writes) ---

export interface PatternCandidate {
  n: number;
  label: string;
  status: "survivor" | "stable" | "unstable" | "not_significant" | "too_rare";
  discovery: { episodes: number; hits: number; rate: number | null; lift: number | null; p: number | null; q: number | null; stable: boolean };
  sealed: { trades?: number; hits?: number; rate?: number | null; base_rate?: number | null; lift?: number | null; p?: number | null };
}

export interface PatternRun {
  id: number;
  question: string;
  settings: { rise_pct: number; days: number; min_episodes: number; fdr_q: number; survivors: number };
  start_date: string;
  split_date: string;
  ran_at: string;
  as_of: string;
  source: string;
  counts: { tried: number; enough_episodes: number; passed_fdr: number; stable: number; survivors: number; base_rate: number | null; sealed_base_rate: number | null };
  sealed_burned: boolean;
  candidates: PatternCandidate[];
}
