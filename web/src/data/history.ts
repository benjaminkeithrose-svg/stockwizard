// "How has this structure done before?" (Ben, 19 Nov 2026: test a structure from the chart).
//
// The structure on the chart is read as a shape: each strike's distance from the last close in daily
// ranges (ATR 14), and the trading days to its expiry. On every past day in the candles the same shape
// is placed around that day's close, priced with the same model as the analysis (Black-Scholes; the VIX
// for SPY, otherwise the last 20 days' moves), with $0.65 a leg and 5c slippage a leg, and held to its
// expiry close. Each day uses only that day's close and earlier; the result uses the close n sessions on.
// Every day counts, so trades overlap: it answers "how often", it isn't a strategy, and it has no
// held-back years, so it is never shown as tested.

import type { Candles } from "./candles";
import { nyParts } from "./candles";
import type { OptionPosition } from "./options";
import { sessions } from "./options";
import { blackScholes, MULT } from "./pricing";

export const COMMISSION = 0.65;   // a leg, per contract, at entry (settled at expiry: none)
export const SLIPPAGE = 0.05;     // a leg, per share
const TRADING_DAYS = 252;
const VOL_DAYS = 20;
const TREND_DAYS = 50;

/** Each candle's New York trading date mapped to a value. */
function byDate(c: Candles, f: (i: number) => number): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < c.time.length; i++) m.set(nyParts(c.time[i]).date, f(i));
  return m;
}

/** Wilder's ATR(14) of daily sessions, one value per session (NaN before there are 14). */
function atrSeries(s: { high: number; low: number; close: number }[], length = 14): number[] {
  const out = new Array<number>(s.length).fill(NaN);
  let atr = 0;
  for (let i = 0; i < s.length; i++) {
    const tr = i === 0 ? s[i].high - s[i].low : Math.max(s[i].high - s[i].low, Math.abs(s[i].high - s[i - 1].close), Math.abs(s[i].low - s[i - 1].close));
    if (i < length) { atr += tr / length; if (i === length - 1) out[i] = atr; }
    else { atr = (atr * (length - 1) + tr) / length; out[i] = atr; }
  }
  return out;
}

/** Annualised volatility of the 20 daily moves up to and including session i. */
function volAt(closes: number[], i: number): number {
  if (i < VOL_DAYS) return NaN;
  const r: number[] = [];
  for (let k = i - VOL_DAYS + 1; k <= i; k++) r.push(Math.log(closes[k] / closes[k - 1]));
  const m = r.reduce((a, b) => a + b, 0) / r.length;
  return Math.sqrt((r.reduce((a, b) => a + (b - m) ** 2, 0) / (r.length - 1)) * TRADING_DAYS);
}

/** +1 above its 50-day average, -1 below, NaN before there are 50 sessions. */
export function trendSide(closes: number[], i: number): number {
  if (i < TREND_DAYS - 1) return NaN;
  let s = 0;
  for (let k = i - TREND_DAYS + 1; k <= i; k++) s += closes[k];
  return closes[i] >= s / TREND_DAYS ? 1 : -1;
}

/** Weekdays after `from` up to and including `to` (YYYY-MM-DD): the sessions to expiry. Holidays aren't known. */
export function weekdaysBetween(from: string, to: string): number {
  let n = 0;
  const d = new Date(`${from}T12:00:00Z`);
  for (;;) {
    d.setUTCDate(d.getUTCDate() + 1);
    const iso = d.toISOString().slice(0, 10);
    if (iso > to) return n;
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) n++;
  }
}

/** Only days like today: the VIX near today's, and chosen symbols on the same side of their 50-day average. */
export interface Likeness {
  vix?: { candles: Candles; within: number };          // e.g. 0.2: within 20% of today's VIX
  trends?: { symbol: string; candles: Candles }[];
}

export interface PastTrade { date: string; expiry: string; spot: number; spotOut: number; vol: number; entry: number; pnl: number }

export interface HistoryResult {
  sessions: number;            // trading days to expiry, as placed now
  trades: PastTrade[];
  skipped: { noVol: number; notLike: number };
  from: string | null;
  to: string | null;
  today: { vix: number | null; trends: Record<string, number> };
}

export interface HistorySummary {
  count: number; wins: number; chance: number; average: number; median: number;
  worst: PastTrade; best: PastTrade; sorted: number[];
}

/**
 * Every past day's result for the structure's shape. `under` is the symbol's daily candles (the last
 * one is "today"); `vix` gives SPY's volatility (null: the last 20 days' moves).
 */
export function testHistory(p: OptionPosition, under: Candles, vix: Candles | null, like: Likeness = {}): HistoryResult {
  const s = sessions(under);
  const last = s.length - 1;
  const empty: HistoryResult = { sessions: 0, trades: [], skipped: { noVol: 0, notLike: 0 }, from: null, to: null, today: { vix: null, trends: {} } };
  if (last < 20 || Number.isNaN(atrSeries(s)[last])) return empty;
  const n = weekdaysBetween(s[last].date, p.expiry);
  if (n < 1) return { ...empty, sessions: n };
  return testShape(shapeOf(p, under), n, p.symbol, under, vix, like);
}

/** Each leg's strike as its distance from the last close, in daily ranges (ATR 14). */
export type Shape = (OptionPosition["legs"][number] & { away: number })[];
export function shapeOf(p: OptionPosition, under: Candles): Shape {
  const s = sessions(under);
  const last = s.length - 1;
  const atr0 = atrSeries(s)[last], spot0 = s[last].close;
  return p.legs.map((l) => ({ ...l, away: (l.strike - spot0) / atr0 }));
}

/** The past days' results for a shape held `n` sessions; the last candle is today. */
export function testShape(shape: Shape, n: number, symbol: string, under: Candles, vix: Candles | null, like: Likeness = {}): HistoryResult {
  const s = sessions(under);
  const closes = s.map((d) => d.close);
  const atr = atrSeries(s);
  const last = s.length - 1;
  const legCount = shape.reduce((a, l) => a + l.qty, 0);
  const useVix = symbol === "SPY" && vix !== null && vix.close.length > 0;
  const vixByDate = useVix ? byDate(vix!, (i) => vix!.close[i]) : null;

  // Days like today.
  const likeVix = like.vix ? byDate(like.vix.candles, (i) => like.vix!.candles.close[i]) : null;
  const vixToday = likeVix ? likeVix.get(s[last].date) ?? [...likeVix.values()].pop() ?? null : null;
  const trendMaps = (like.trends ?? []).map(({ symbol, candles }) => {
    const ss = sessions(candles);
    const cl = ss.map((d) => d.close);
    const m = new Map<string, number>();
    ss.forEach((d, i) => m.set(d.date, trendSide(cl, i)));
    return { symbol, m, today: m.get(s[last].date) ?? trendSide(cl, cl.length - 1) };
  });
  const today = { vix: vixToday, trends: Object.fromEntries(trendMaps.map((t) => [t.symbol, t.today])) };

  const trades: PastTrade[] = [];
  const skipped = { noVol: 0, notLike: 0 };
  for (let i = 20; i + n <= last; i++) {
    if (Number.isNaN(atr[i])) continue;
    const date = s[i].date;
    if (likeVix && vixToday !== null) {
      const v = likeVix.get(date);
      if (v === undefined || Math.abs(v / vixToday - 1) > like.vix!.within) { skipped.notLike++; continue; }
    }
    if (trendMaps.some((t) => t.m.get(date) !== t.today)) { skipped.notLike++; continue; }
    const vol = vixByDate ? (vixByDate.get(date) ?? NaN) / 100 : volAt(closes, i);
    if (!(vol > 0)) { skipped.noVol++; continue; }
    const spot = closes[i], out = closes[i + n], t = n / TRADING_DAYS;
    let entry = 0, settle = 0;
    for (const l of shape) {
      const k = spot + l.away * atr[i];
      const sgn = (l.side === "buy" ? 1 : -1) * l.qty;
      entry += sgn * blackScholes(l.right, spot, k, t, vol).price;
      settle += sgn * Math.max(0, l.right === "C" ? out - k : k - out);
    }
    const pnl = (settle - entry - SLIPPAGE * legCount) * MULT - COMMISSION * legCount;
    trades.push({ date, expiry: s[i + n].date, spot, spotOut: out, vol, entry: entry * MULT, pnl: Math.round(pnl * 100) / 100 });
  }
  return { sessions: n, trades, skipped, from: trades[0]?.date ?? null, to: trades[trades.length - 1]?.date ?? null, today };
}

export function summarise(trades: PastTrade[]): HistorySummary | null {
  if (!trades.length) return null;
  const sorted = trades.map((t) => t.pnl).sort((a, b) => a - b);
  const wins = sorted.filter((x) => x > 0).length;
  const mid = sorted.length >> 1;
  let worst = trades[0], best = trades[0];
  for (const t of trades) { if (t.pnl < worst.pnl) worst = t; if (t.pnl > best.pnl) best = t; }
  return {
    count: trades.length, wins, chance: wins / trades.length,
    average: sorted.reduce((a, b) => a + b, 0) / sorted.length,
    median: sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2,
    worst, best, sorted,
  };
}
