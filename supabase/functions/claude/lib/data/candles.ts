// Candles in the browser: one array per field, times in UTC seconds (candle OPEN time).

export type Timeframe = "1m" | "5m" | "15m" | "30m" | "1h" | "1d";
export const TIMEFRAMES: Timeframe[] = ["1m", "5m", "15m", "30m", "1h", "1d"];
export const TIMEFRAME_MINUTES: Record<Timeframe, number> = { "1m": 1, "5m": 5, "15m": 15, "30m": 30, "1h": 60, "1d": 1440 };

export interface Candles {
  time: number[];
  open: number[];
  high: number[];
  low: number[];
  close: number[];
  volume: number[];
  /** Where the candles came from, e.g. "yahoo-unofficial" or "made-up". */
  source: string;
}

export const emptyCandles = (source = ""): Candles => ({
  time: [], open: [], high: [], low: [], close: [], volume: [], source,
});

export function sliceCandles(c: Candles, end: number): Candles {
  return {
    time: c.time.slice(0, end), open: c.open.slice(0, end), high: c.high.slice(0, end),
    low: c.low.slice(0, end), close: c.close.slice(0, end), volume: c.volume.slice(0, end), source: c.source,
  };
}

const nyFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});
const nyCache = new Map<number, { date: string; minutes: number }>();

/** The US trading date and minutes after New York midnight for a UTC time in seconds. */
export function nyParts(t: number): { date: string; minutes: number } {
  let r = nyCache.get(t);
  if (!r) {
    const p = Object.fromEntries(nyFormat.formatToParts(new Date(t * 1000)).map((x) => [x.type, x.value]));
    r = { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
    if (nyCache.size > 200_000) nyCache.clear();
    nyCache.set(t, r);
  }
  return r;
}

/** Made-up candles for trying the app without data. Never real prices. */
export function madeUpCandles(tf: Timeframe, count = 600, seed = 1): Candles {
  let s = seed >>> 0 || 1;
  const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const normal = () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());
  const out = emptyCandles("made-up");
  const step = TIMEFRAME_MINUTES[tf] * 60;
  // Weekday US-session candles ending at the most recent session close.
  const times: number[] = [];
  let day = new Date();
  day.setUTCHours(0, 0, 0, 0);
  while (times.length < count) {
    const dow = day.getUTCDay();
    if (dow !== 0 && dow !== 6) {
      if (tf === "1d") times.push(day.getTime() / 1000 + 5 * 3600);
      else {
        const open = day.getTime() / 1000 + 14.5 * 3600; // 09:30 New York in winter
        const bars: number[] = [];
        for (let t = open; t < open + 6.5 * 3600; t += step) bars.push(t);
        times.push(...bars.reverse());
      }
    }
    day = new Date(day.getTime() - 86_400_000);
  }
  times.length = count;
  times.reverse();
  let price = 100;
  times.forEach((t, i) => {
    const vol = 0.003 + 0.006 * Math.sin(i / 37) ** 2;
    const open = price * Math.exp(normal() * vol * 0.25);
    const close = open * Math.exp(normal() * vol);
    out.time.push(t);
    out.open.push(open);
    out.close.push(close);
    out.high.push(Math.max(open, close) * (1 + Math.abs(normal()) * vol * 0.5));
    out.low.push(Math.min(open, close) * (1 - Math.abs(normal()) * vol * 0.5));
    out.volume.push(Math.round(5000 + rand() * 45000));
    price = close;
  });
  return out;
}

/** New York midnight of the trading date `t` falls on, in UTC seconds: where daily candles open. */
export function nyMidnight(t: number): number {
  const { minutes } = nyParts(t);
  return t - (t % 60) - minutes * 60;
}

/** The open time of the `tf` candle a minute starting at `t` belongs to: IBKR's grid, from 9:30, then on the hour for 1h. */
export function bucket(t: number, tf: Timeframe): number {
  const midnight = nyMidnight(t);
  if (tf === "1d") return midnight;
  const m = nyParts(t).minutes;
  const n = TIMEFRAME_MINUTES[tf];
  const start = n === 60 && m < 600 ? 570 : Math.floor(m / n) * n;
  return midnight + start * 60;
}

/** Candles of a longer timeframe built from shorter ones (15m and 30m from 5m), on IBKR's grid from 9:30. */
export function resample(c: Candles, tf: Timeframe): Candles {
  const out: Candles = { time: [], open: [], high: [], low: [], close: [], volume: [], source: c.source };
  for (let i = 0; i < c.time.length; i++) {
    const t = bucket(c.time[i], tf);
    const n = out.time.length - 1;
    if (n >= 0 && out.time[n] === t) {
      out.high[n] = Math.max(out.high[n], c.high[i]);
      out.low[n] = Math.min(out.low[n], c.low[i]);
      out.close[n] = c.close[i];
      out.volume[n] += c.volume[i];
    } else {
      out.time.push(t); out.open.push(c.open[i]); out.high.push(c.high[i]); out.low.push(c.low[i]); out.close.push(c.close[i]); out.volume.push(c.volume[i]);
    }
  }
  return out;
}
