// Bar replay (Ben, 19 Nov 2026; like TradingView's): pick a day, everything after it is hidden,
// then step forward a candle at a time or play at a chosen speed, and practise trading as if
// it were live. The chart and its indicators only ever get the candles shown so far, so nothing
// can peek ahead (the indicators are causal and truncation-tested already). Practice trades are
// scored at the replayed closes and kept on this screen only: they're never paper orders.

import { Candles, sliceCandles } from "./candles";

export interface PracticeTrade { side: "long" | "short"; entry: number; exit: number; from: number; to: number; pct: number }

export interface Replay {
  /** How many candles are showing (the last one is "now"). */
  at: number;
  /** The candle count when the replay started, for Back to start. */
  start: number;
  playing: boolean;
  /** Candles a second while playing. */
  speed: number;
  open: { side: "long" | "short"; entry: number; from: number } | null;
  trades: PracticeTrade[];
}

export const SPEEDS = [1, 2, 5, 10];
/** Candles kept before the starting day, so indicators have their history. */
export const MIN_SHOWN = 30;

/** A replay starting on the candle at or after `time`: that candle is "now", everything after it hidden. */
export function startAt(c: Candles, time: number): Replay {
  let i = c.time.findIndex((t) => t >= time);
  if (i < 0) i = c.time.length - 1;
  const at = Math.min(c.time.length, Math.max(MIN_SHOWN, i + 1));
  return { at, start: at, playing: false, speed: 1, open: null, trades: [] };
}

export function step(r: Replay, n: number, total: number): Replay {
  const at = Math.min(total, Math.max(MIN_SHOWN, r.at + n));
  return { ...r, at, playing: r.playing && at < total };
}

export function shown(c: Candles, r: Replay | null): Candles {
  return r ? sliceCandles(c, r.at) : c;
}

/** The latest close showing: where a practice trade opens or closes. */
export const nowPrice = (c: Candles, r: Replay) => c.close[r.at - 1];

export function openTrade(c: Candles, r: Replay, side: "long" | "short"): Replay {
  if (r.open) return r;
  return { ...r, open: { side, entry: nowPrice(c, r), from: c.time[r.at - 1] } };
}

export const pctOf = (side: "long" | "short", entry: number, exit: number) =>
  (side === "long" ? exit / entry - 1 : entry / exit - 1) * 100;

export function closeTrade(c: Candles, r: Replay): Replay {
  if (!r.open) return r;
  const exit = nowPrice(c, r);
  const t: PracticeTrade = { side: r.open.side, entry: r.open.entry, exit, from: r.open.from, to: c.time[r.at - 1], pct: pctOf(r.open.side, r.open.entry, exit) };
  return { ...r, open: null, trades: [...r.trades, t] };
}

export function summary(r: Replay): { trades: number; won: number; total: number } {
  return { trades: r.trades.length, won: r.trades.filter((t) => t.pct > 0).length, total: r.trades.reduce((a, t) => a + t.pct, 0) };
}
