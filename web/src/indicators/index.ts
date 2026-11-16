// The browser's indicator registry. Names, versions and default settings
// match backend/stockwizard/indicators/__init__.py; tests check they agree.

import type { Candles, Timeframe } from "../data/candles";
import { TIMEFRAME_MINUTES } from "../data/candles";
import * as core from "./core";

export type Params = Record<string, number | string>;
export type Placement = "price" | "pane";

export interface LineStyle {
  column: string;
  /** "line" a line; "histogram" bars below the price; "dots" a marker where the value is 1. */
  kind: "line" | "histogram" | "dots";
  colour: string;
}

export interface IndicatorDef {
  name: string;
  label: string;
  group: "trend" | "volatility" | "momentum" | "volume" | "levels";
  version: number;
  defaults: Params;
  intradayOnly: boolean;
  placement: Placement;
  lines: LineStyle[];
  /** Short text for the indicator's chip, e.g. "EMA 21". */
  short: (p: Params) => string;
  run: (c: Candles, p: Params, tf: Timeframe) => core.Output;
}

const n = (p: Params, k: string) => Number(p[k]);

export const REGISTRY: Record<string, IndicatorDef> = Object.fromEntries(
  ([
    {
      name: "sma", label: "Simple moving average", group: "trend", version: 1, defaults: { length: 200 },
      intradayOnly: false, placement: "price", lines: [{ column: "sma", kind: "line", colour: "#4D4D4F" }],
      short: (p) => `SMA ${p.length}`, run: (c, p) => core.sma(c, { length: n(p, "length") }),
    },
    {
      name: "ema", label: "Exponential moving average", group: "trend", version: 1, defaults: { length: 21 },
      intradayOnly: false, placement: "price", lines: [{ column: "ema", kind: "line", colour: "#0F6FA8" }],
      short: (p) => `EMA ${p.length}`, run: (c, p) => core.ema(c, { length: n(p, "length") }),
    },
    {
      name: "macd", label: "MACD", group: "trend", version: 1, defaults: { fast: 12, slow: 26, signal: 9 },
      intradayOnly: false, placement: "pane",
      lines: [
        { column: "histogram", kind: "histogram", colour: "#ACD3E1" },
        { column: "macd", kind: "line", colour: "#00287B" },
        { column: "signal", kind: "line", colour: "#E36C00" },
      ],
      short: (p) => `MACD ${p.fast},${p.slow},${p.signal}`,
      run: (c, p) => core.macd(c, { fast: n(p, "fast"), slow: n(p, "slow"), signal: n(p, "signal") }),
    },
    {
      name: "atr", label: "Average true range", group: "volatility", version: 1, defaults: { length: 14 },
      intradayOnly: false, placement: "pane", lines: [{ column: "atr", kind: "line", colour: "#00708D" }],
      short: (p) => `ATR ${p.length}`, run: (c, p) => core.atr(c, { length: n(p, "length") }),
    },
    {
      name: "bollinger", label: "Bollinger Bands", group: "volatility", version: 1, defaults: { length: 20, mult: 2 },
      intradayOnly: false, placement: "price",
      lines: [
        { column: "upper", kind: "line", colour: "#479EBC" },
        { column: "mid", kind: "line", colour: "#ACD3E1" },
        { column: "lower", kind: "line", colour: "#479EBC" },
      ],
      short: (p) => `BB ${p.length},${p.mult}`,
      run: (c, p) => core.bollinger(c, { length: n(p, "length"), mult: n(p, "mult") }),
    },
    {
      name: "keltner", label: "Keltner Channel", group: "volatility", version: 1,
      defaults: { length: 20, atr_length: 10, mult: 2 }, intradayOnly: false, placement: "price",
      lines: [
        { column: "upper", kind: "line", colour: "#6B4E9B" },
        { column: "mid", kind: "line", colour: "#A992CC" },
        { column: "lower", kind: "line", colour: "#6B4E9B" },
      ],
      short: (p) => `KC ${p.length},${p.mult}`,
      run: (c, p) => core.keltner(c, { length: n(p, "length"), atr_length: n(p, "atr_length"), mult: n(p, "mult") }),
    },
    {
      name: "squeeze", label: "Squeeze", group: "volatility", version: 1,
      defaults: { length: 20, bb_mult: 2, kc_mult: 1.5 }, intradayOnly: false, placement: "pane",
      lines: [
        { column: "momentum", kind: "histogram", colour: "#479EBC" },
        { column: "squeeze_on", kind: "dots", colour: "#B2232F" },
      ],
      short: (p) => `Squeeze ${p.length}`,
      run: (c, p) => core.squeeze(c, { length: n(p, "length"), bb_mult: n(p, "bb_mult"), kc_mult: n(p, "kc_mult") }),
    },
    {
      name: "rsi", label: "RSI", group: "momentum", version: 1, defaults: { length: 14 },
      intradayOnly: false, placement: "pane", lines: [{ column: "rsi", kind: "line", colour: "#6B4E9B" }],
      short: (p) => `RSI ${p.length}`, run: (c, p) => core.rsi(c, { length: n(p, "length") }),
    },
    {
      name: "vwap", label: "VWAP", group: "volume", version: 1, defaults: {}, intradayOnly: true,
      placement: "price", lines: [{ column: "vwap", kind: "line", colour: "#E36C00" }],
      short: () => "VWAP", run: (c, p, tf) => core.vwap(c, p, tf),
    },
    {
      name: "anchored_vwap", label: "Anchored VWAP", group: "volume", version: 1, defaults: { anchor: "" },
      intradayOnly: false, placement: "price", lines: [{ column: "anchored_vwap", kind: "line", colour: "#FFA400" }],
      short: () => "Anchored VWAP", run: (c, p) => core.anchoredVwap(c, { anchor: String(p.anchor) }),
    },
    {
      name: "opening_range", label: "Opening range", group: "levels", version: 1, defaults: { minutes: 30 },
      intradayOnly: true, placement: "price",
      lines: [
        { column: "or_high", kind: "line", colour: "#237F35" },
        { column: "or_low", kind: "line", colour: "#B2232F" },
      ],
      short: (p) => `Opening range ${p.minutes}m`,
      run: (c, p, tf) => core.openingRange(c, { minutes: n(p, "minutes") }, tf),
    },
    {
      name: "prior_day", label: "Prior day high, low, close", group: "levels", version: 1, defaults: {},
      intradayOnly: false, placement: "price",
      lines: [
        { column: "prior_high", kind: "line", colour: "#77787A" },
        { column: "prior_low", kind: "line", colour: "#77787A" },
        { column: "prior_close", kind: "line", colour: "#222222" },
      ],
      short: () => "Prior day", run: (c) => core.priorDay(c),
    },
  ] as IndicatorDef[]).map((d) => [d.name, d]),
);

/** Can this indicator run on this timeframe with these settings? Returns the reason if not. */
export function unavailable(def: IndicatorDef, p: Params, tf: Timeframe): string | null {
  if (def.intradayOnly && TIMEFRAME_MINUTES[tf] >= 1440) return "Intraday charts only";
  if (def.name === "opening_range") {
    const m = n(p, "minutes"), bar = TIMEFRAME_MINUTES[tf];
    if (m % bar !== 0 || m < bar) return `Doesn't fit ${tf} candles`;
  }
  if (def.name === "anchored_vwap" && !p.anchor) return "Choose the candle to start from";
  return null;
}

export function compute(name: string, c: Candles, tf: Timeframe, params: Params = {}): core.Output {
  const def = REGISTRY[name];
  if (!def) throw new Error(`No indicator called ${name}`);
  return def.run(c, { ...def.defaults, ...params }, tf);
}

export const codeVersion = (name: string) => `${name}@${REGISTRY[name].version}`;
