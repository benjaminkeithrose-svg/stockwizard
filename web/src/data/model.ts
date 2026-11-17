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

// --- favourites (user_settings) ---

/** A chip in the favourites row: an indicator with its settings, or an option structure. */
export type Favourite =
  | { kind: "indicator"; name: string; params: Params }
  | { kind: "structure"; structure: import("./options").Structure };

export interface UserSettings { favourites: Favourite[] }

export const MAX_FAVOURITES = 20;

export const DEFAULT_FAVOURITES: Favourite[] = [
  { kind: "indicator", name: "ema", params: { length: 21 } },
  { kind: "indicator", name: "sma", params: { length: 200 } },
  { kind: "indicator", name: "bollinger", params: { length: 20, mult: 2 } },
  { kind: "indicator", name: "rsi", params: { length: 14 } },
  { kind: "indicator", name: "squeeze", params: { ...REGISTRY.squeeze.defaults } },
  { kind: "structure", structure: "iron_condor" },
];

const sameParams = (a: Params, b: Params) => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every((k) => String(a[k] ?? "") === String(b[k] ?? ""));
};

/** The same indicator with the same settings (a favourite matches an indicator on the chart). */
export const sameIndicator = (a: { name: string; params: Params }, b: { name: string; params: Params }) =>
  a.name === b.name && sameParams({ ...REGISTRY[a.name]?.defaults, ...a.params }, { ...REGISTRY[b.name]?.defaults, ...b.params });

// --- safety rails (phase 5) ---

/** The limits the bot checks before every order. The daily limit starts empty: every order is refused until it's set. */
export interface SafetyLimits {
  max_loss_per_trade: number;
  max_loss_per_day: number | null;
  max_open_positions: number;
  max_capital_at_risk: number;
  max_data_age_seconds: number;
  approval_mode: "approval" | "automatic";
  kill_switch: boolean;
  updated_at?: string;
}

export const DEFAULT_LIMITS: SafetyLimits = {
  max_loss_per_trade: 50, max_loss_per_day: null, max_open_positions: 1, max_capital_at_risk: 100,
  max_data_age_seconds: 120, approval_mode: "approval", kill_switch: false,
};

/** An order the bot proposed (paper only), and what became of it. Written by the bot; Ben only decides. */
export interface PaperOrder {
  id: number;
  created_at: string;
  symbol: string;
  structure: string;
  expiry: string;
  legs: { right: "C" | "P"; side: "buy" | "sell"; strike: number; qty: number }[];
  quantity: number;
  limit_price: number;
  price_kind: "credit" | "debit";
  max_loss: number | null;
  status: "proposed" | "refused" | "approved" | "rejected" | "sent" | "filled" | "cancelled" | "closed" | "failed";
  refusals: { rail: string; why: string }[];
  reason: string | null;
  pnl: number | null;
}

/** Ben's request to the bot from the app: order a chart structure (paper) or close a paper position. Not an order. */
export interface BotRequest {
  id: number;
  created_at: string;
  kind: "open" | "close";
  position_id: string | null;
  order_id: number | null;
  quantity: number;
  status: "waiting" | "done" | "failed";
  result: string | null;
}

// --- option-structure backtests (read-only in the app; the server writes) ---

export interface OptionStrategyDef {
  id: string;
  label: string;
  family: string;
  config: { structure: string; dte: number; manage: string; short_atr?: number; wing: number; signal_rule?: string | null; vix_max?: number | null };
  start_date: string;
  split_date: string;
  position: number;
  notes: string | null;
}

export interface OptionMetrics {
  trades: number; wins: number; win_rate: number | null; next_100_wins_low: number | null; next_100_wins_high: number | null;
  avg_win: number | null; avg_loss: number | null; expectancy: number | null; total_pnl: number | null; max_drawdown: number | null;
  worst_trade: number | null; profit_factor: number | null; avg_return_on_risk: number | null; longest_losing_streak: number; take_profit_exits: number;
}

export interface OptionTradeRow {
  signal_day: string; entry_day: string; expiry_day: string; exit_day: string; spot_in: number; spot_out: number;
  legs: { right: "C" | "P"; side: "buy" | "sell"; strike: number; qty: number }[];
  vol: number; credit: number; exit_cost: number; pnl: number; max_loss: number; exit_reason: "expiry" | "take_profit" | "stop";
}

export interface OptionRun {
  id: number;
  strategy_id: string;
  ran_at: string;
  source: string;
  split_date: string;
  held_back_burned: boolean;
  report: { build: OptionMetrics; held_back: OptionMetrics; warnings: string[]; skipped: Record<string, number> };
}

// --- the bot's own strategies (bot_strategies) ---

/** A 0DTE research configuration (backend/stockwizard/zerodte/strategy.Config). */
export interface StrategyConfig {
  instrument: string;
  structure: string;
  entry: string;
  short_delta: number;
  width: number;
  neutral_trade?: string;
  require_inside_range?: boolean;
  profit_target?: number | null;
  stop_mult?: number | null;
  exit_time?: string | null;
  [k: string]: unknown;
}

export interface BotStrategy { id: string; label: string; config: StrategyConfig; enabled: boolean }

// --- 0DTE research runs (research_runs; the server writes) ---

export interface ResearchMetrics {
  trades: number; win_rate?: number | null; expectancy?: number | null; profit_factor?: number | null; largest_loss?: number | null;
  max_drawdown?: number | null; months_positive_pct?: number | null; avg_return_on_risk_pct?: number | null; sharpe?: number | null; p_value?: number | null;
}

export interface ResearchStrategy {
  strategy: string;
  development?: ResearchMetrics;
  validation?: ResearchMetrics;
  walk_forward?: number[];
  by_regime?: Record<string, ResearchMetrics>;
}

export interface ResearchRun {
  id: number;
  ran_at: string;
  title: string;
  modelled: boolean;
  result: {
    notes: string[];
    periods: { start: string; dev_end: string; val_end: string; end: string };
    tried: number;
    q: number;
    final_used: boolean;
    survivors: ResearchStrategy[];
    best_in_development: ResearchStrategy[];
  };
}
