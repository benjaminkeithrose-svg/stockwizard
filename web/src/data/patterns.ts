// The browser's copy of backend/stockwizard/patterns.py (Ben, 19 Nov 2026: pattern markers on the
// chart). The same 18 candlestick and chart patterns, each true only on the day it's complete, from
// that candle and earlier ones only. web/tests/patterns.test.ts checks this copy finds exactly the
// patterns the Python library finds (web/src/data/patterns-golden.json, written by
// backend/tools/make_pattern_golden.py). Change both together and regenerate the file.

import type { Candles } from "./candles";
import { atr } from "../indicators/core";

export const PATTERNS = {
  bull_engulf: { label: "Bullish engulfing", short: "Engulf", side: "up" },
  bear_engulf: { label: "Bearish engulfing", short: "Engulf", side: "down" },
  hammer: { label: "Hammer after a fall", short: "Hammer", side: "up" },
  shooting_star: { label: "Shooting star after a rise", short: "Star", side: "down" },
  doji: { label: "Doji", short: "Doji", side: "neutral" },
  morning_star: { label: "Morning star", short: "M star", side: "up" },
  evening_star: { label: "Evening star", short: "E star", side: "down" },
  inside_bar: { label: "Inside bar", short: "Inside", side: "neutral" },
  three_soldiers: { label: "Three white soldiers", short: "3 up", side: "up" },
  three_crows: { label: "Three black crows", short: "3 down", side: "down" },
  bull_flag: { label: "Bull flag breaking out", short: "Flag", side: "up" },
  bear_flag: { label: "Bear flag breaking down", short: "Flag", side: "down" },
  double_bottom: { label: "Double bottom confirmed", short: "Dbl bottom", side: "up" },
  double_top: { label: "Double top confirmed", short: "Dbl top", side: "down" },
  triangle_up: { label: "Ascending triangle breaking out", short: "Triangle", side: "up" },
  triangle_down: { label: "Descending triangle breaking down", short: "Triangle", side: "down" },
  breakout_20: { label: "Close above its 20-day high", short: "Breakout", side: "up" },
  breakdown_20: { label: "Close below its 20-day low", short: "Breakdown", side: "down" },
} as const;
export type PatternName = keyof typeof PATTERNS;
export const PATTERN_NAMES = Object.keys(PATTERNS) as PatternName[];
export const CANDLESTICK: PatternName[] = ["bull_engulf", "bear_engulf", "hammer", "shooting_star", "doji", "morning_star", "evening_star", "inside_bar", "three_soldiers", "three_crows"];
export const CHART_PATTERNS: PatternName[] = ["bull_flag", "bear_flag", "double_bottom", "double_top", "triangle_up", "triangle_down", "breakout_20", "breakdown_20"];

const SWING = 3;
const shift = (x: number[], k: number) => x.map((_, i) => (i - k >= 0 ? x[i - k] : NaN));

/** Every pattern: for each, true on the candles where it's complete. */
export function detect(c: Candles): Record<PatternName, boolean[]> {
  const n = c.time.length;
  const { open: o, high: h, low: l, close: cl } = c;
  const body = o.map((v, i) => Math.abs(cl[i] - v));
  // The usual body: the mean of the 10 bodies before (not today's).
  const avg = body.map((_, i) => {
    if (i < 10) return NaN;
    let s = 0;
    for (let k = i - 10; k < i; k++) s += body[k];
    return s / 10;
  });
  const ret5 = cl.map((v, i) => (i >= 5 ? v / cl[i - 5] - 1 : NaN));
  const up = cl.map((v, i) => v > o[i]);
  const down = cl.map((v, i) => v < o[i]);
  const top = o.map((v, i) => Math.max(v, cl[i]));
  const bot = o.map((v, i) => Math.min(v, cl[i]));
  const rng = h.map((v, i) => v - l[i]);
  const prevRet = shift(ret5, 1);
  const b = (i: number, k: number, x: boolean[]) => (i - k >= 0 ? x[i - k] : false);
  const out = Object.fromEntries(PATTERN_NAMES.map((p) => [p, new Array<boolean>(n).fill(false)])) as Record<PatternName, boolean[]>;

  for (let i = 0; i < n; i++) {
    const falling = prevRet[i] < 0, rising = prevRet[i] > 0;
    const o1 = i >= 1 ? o[i - 1] : NaN, c1 = i >= 1 ? cl[i - 1] : NaN, body1 = i >= 1 ? body[i - 1] : NaN;
    const o2 = i >= 2 ? o[i - 2] : NaN, c2 = i >= 2 ? cl[i - 2] : NaN, body2 = i >= 2 ? body[i - 2] : NaN, avg2 = i >= 2 ? avg[i - 2] : NaN;
    const up1 = b(i, 1, up), down1 = b(i, 1, down), up2 = b(i, 2, up), down2 = b(i, 2, down);
    const lower = bot[i] - l[i], upper = h[i] - top[i];
    const small = 0.5 * Math.max(body[i], rng[i] * 0.05);
    out.bull_engulf[i] = down1 && up[i] && o[i] <= c1 && cl[i] >= o1 && body[i] > body1 && falling;
    out.bear_engulf[i] = up1 && down[i] && o[i] >= c1 && cl[i] <= o1 && body[i] > body1 && rising;
    out.hammer[i] = rng[i] > 0 && lower >= 2 * body[i] && upper <= small && falling;
    out.shooting_star[i] = rng[i] > 0 && upper >= 2 * body[i] && lower <= small && rising;
    out.doji[i] = rng[i] > 0 && body[i] <= 0.1 * rng[i];
    out.morning_star[i] = down2 && body2 > avg2 && body1 < 0.3 * avg2 && up[i] && cl[i] > (o2 + c2) / 2;
    out.evening_star[i] = up2 && body2 > avg2 && body1 < 0.3 * avg2 && down[i] && cl[i] < (o2 + c2) / 2;
    out.inside_bar[i] = i >= 1 && h[i] < h[i - 1] && l[i] > l[i - 1];
    const strong = (k: number) => i - k >= 0 && body[i - k] > 0.5 * avg[i];
    out.three_soldiers[i] = up[i] && up1 && up2 && cl[i] > c1 && c1 > c2 && strong(0) && strong(1) && strong(2) && o[i] > o1 && o1 > o2;
    out.three_crows[i] = down[i] && down1 && down2 && cl[i] < c1 && c1 < c2 && strong(0) && strong(1) && strong(2) && o[i] < o1 && o1 < o2;
  }

  // 20-day breakouts: today's close beyond the 20 days before.
  for (let i = 20; i < n; i++) {
    let hi = -Infinity, lo = Infinity;
    for (let k = i - 20; k < i; k++) { hi = Math.max(hi, h[k]); lo = Math.min(lo, l[k]); }
    out.breakout_20[i] = cl[i] > hi;
    out.breakdown_20[i] = cl[i] < lo;
  }

  // Flags: a pole (a 5-day move of at least 3 daily ranges ending at p), 3 to 15 quiet candles, then the break.
  const a = atr(c, { length: 14 }).atr;
  for (let t = 25; t < n; t++) {
    for (let p = t - 15; p < t - 2; p++) {
      if (p < 6 || Number.isNaN(a[p])) continue;
      const rise = cl[p] - cl[p - 5], fall = cl[p - 5] - cl[p];
      let ph = -Infinity, pl = Infinity;
      for (let k = p + 1; k < t; k++) { ph = Math.max(ph, h[k]); pl = Math.min(pl, l[k]); }
      const hiLine = Math.max(ph, h[p]), loLine = Math.min(pl, l[p]);
      if (rise >= 3 * a[p] && ph <= h[p] && h[p] - pl <= 0.5 * rise && cl[t] > hiLine && cl[t - 1] <= hiLine) out.bull_flag[t] = true;
      if (fall >= 3 * a[p] && pl >= l[p] && ph - l[p] <= 0.5 * fall && cl[t] < loLine && cl[t - 1] >= loLine) out.bear_flag[t] = true;
    }
  }

  // Swing lows and highs: the lowest (highest) of SWING candles each side, known SWING candles later.
  const swings = (v: number[], low: boolean): [number, number][] => {
    const res: [number, number][] = [];
    for (let i = SWING; i < n - SWING; i++) {
      const w = v.slice(i - SWING, i + SWING + 1);
      const ext = low ? Math.min(...w) : Math.max(...w);
      if (v[i] === ext && w.filter((x) => x === v[i]).length === 1) res.push([i, i + SWING]);
    }
    return res;
  };
  const lows = swings(l, true), highs = swings(h, false);
  for (let t = 0; t < n; t++) {
    const kl = lows.filter(([i, k]) => k <= t && t - i <= 80).map(([i]) => i);
    const kh = highs.filter(([i, k]) => k <= t && t - i <= 80).map(([i]) => i);
    if (kl.length >= 2) {
      const [x, y] = kl.slice(-2);
      if (y - x >= 10 && Math.abs(l[y] - l[x]) <= 0.02 * l[x]) {
        const neck = Math.max(...h.slice(x, y + 1));
        if (cl[t] > neck && (t === 0 || cl[t - 1] <= neck) && t > y) out.double_bottom[t] = true;
      }
    }
    if (kh.length >= 2) {
      const [x, y] = kh.slice(-2);
      if (y - x >= 10 && Math.abs(h[y] - h[x]) <= 0.02 * h[x]) {
        const neck = Math.min(...l.slice(x, y + 1));
        if (cl[t] < neck && (t === 0 || cl[t - 1] >= neck) && t > y) out.double_top[t] = true;
      }
    }
    if (kh.length >= 2 && kl.length >= 2) {
      const [ha, hb] = kh.slice(-2), [la, lb] = kl.slice(-2);
      const topLine = Math.max(h[ha], h[hb]);
      if (Math.abs(h[hb] - h[ha]) <= 0.01 * h[ha] && l[lb] > l[la] && cl[t] > topLine && cl[t - 1] <= topLine && t > Math.max(hb, lb)) out.triangle_up[t] = true;
      const bottom = Math.min(l[la], l[lb]);
      if (Math.abs(l[lb] - l[la]) <= 0.01 * l[la] && h[hb] < h[ha] && cl[t] < bottom && cl[t - 1] >= bottom && t > Math.max(hb, lb)) out.triangle_down[t] = true;
    }
  }
  return out;
}
