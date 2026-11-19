// Live bars (Ben, 18 Nov 2026): during the US session the data program on Ben's PC
// writes today's 1-minute bars from Interactive Brokers to Supabase (`live_bars`)
// every few seconds. The open chart reads them and folds them into its candles,
// so its last candle moves. A bar may still be forming; `delayed` means IBKR sent
// prices about 15 minutes behind (no real-time subscription).

import { bucket, Candles, nyMidnight, nyParts, Timeframe } from "./candles";
// bucket and resample live in candles.ts (shared with the Claude function); kept importable from here.
export { bucket, resample } from "./candles";

export interface LiveBar {
  time: number;     // the minute's open, UTC seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  delayed: boolean;
}

/** Seconds between checks for new live bars while the market is open and the chart is showing. */
export const LIVE_EVERY_MS = 5_000;

/** Whether the US regular session is on (9:30 to 16:00 New York, weekdays). Holidays aren't known here: the data program simply sends nothing. */
export function sessionOpen(now: Date): boolean {
  const t = Math.floor(now.getTime() / 1000);
  const { minutes } = nyParts(t);
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short" }).format(now);
  return !["Sat", "Sun"].includes(weekday) && minutes >= 570 && minutes < 960;
}

/** The chart's candles with today's live bars folded in after the last stored candle.
 *  Stored candles are always finished ones, so a live bar inside a stored candle's period is already
 *  counted and is skipped; later live bars build the candles still to come, the last one still forming. */
export function withLive(c: Candles, bars: LiveBar[], tf: Timeframe): Candles {
  const last = c.time.length ? c.time[c.time.length - 1] : -Infinity;
  const fresh = bars.filter((b) => bucket(b.time, tf) > last).sort((x, y) => x.time - y.time);
  if (!fresh.length) return c;
  const out: Candles = { time: [...c.time], open: [...c.open], high: [...c.high], low: [...c.low], close: [...c.close], volume: [...c.volume], source: c.source };
  for (const b of fresh) {
    const t = bucket(b.time, tf);
    const i = out.time.length - 1;
    if (out.time[i] === t) {
      out.high[i] = Math.max(out.high[i], b.high);
      out.low[i] = Math.min(out.low[i], b.low);
      out.close[i] = b.close;
      out.volume[i] += b.volume;
    } else {
      out.time.push(t); out.open.push(b.open); out.high.push(b.high); out.low.push(b.low); out.close.push(b.close); out.volume.push(b.volume);
    }
  }
  return out;
}

/** Whether any of the bars came in delayed. */
export const anyDelayed = (bars: LiveBar[]) => bars.some((b) => b.delayed);

/** Today's New York midnight as an ISO time: live bars from here on are today's. */
export function todayStartIso(now: Date): string {
  return new Date(nyMidnight(Math.floor(now.getTime() / 1000)) * 1000).toISOString();
}
