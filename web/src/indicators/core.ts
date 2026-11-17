// The browser's copy of backend/stockwizard/indicators/core.py.
//
// Every function here must give the same numbers as its Python twin:
// tests/golden.test.ts checks them against golden.json, which the Python
// library writes. Change both sides together and regenerate golden.json.
// As in Python, each value uses only its own candle and earlier ones, and
// warm-up values are NaN.

import { Candles, nyParts, TIMEFRAME_MINUTES, Timeframe } from "../data/candles.ts";

export type Series = number[]; // NaN = no value
export type Output = Record<string, Series>;

const filled = (n: number): Series => new Array<number>(n).fill(NaN);

// --- building blocks -------------------------------------------------------

function seededEwm(x: ArrayLike<number>, alpha: number, length: number): Series {
  const out = filled(x.length);
  let start = -1;
  for (let i = 0; i < x.length; i++) if (!Number.isNaN(x[i])) { start = i; break; }
  if (start < 0 || x.length - start < length) return out;
  const seedAt = start + length - 1;
  let prev = 0;
  for (let i = start; i <= seedAt; i++) prev += x[i];
  prev /= length;
  out[seedAt] = prev;
  for (let i = seedAt + 1; i < x.length; i++) {
    prev = alpha * x[i] + (1 - alpha) * prev;
    out[i] = prev;
  }
  return out;
}

export const emaOf = (x: ArrayLike<number>, length: number) => seededEwm(x, 2 / (length + 1), length);
export const rmaOf = (x: ArrayLike<number>, length: number) => seededEwm(x, 1 / length, length);

function rolling(x: ArrayLike<number>, length: number, fn: (w: number[]) => number): Series {
  const out = filled(x.length);
  for (let i = length - 1; i < x.length; i++) {
    const w: number[] = [];
    let ok = true;
    for (let j = i - length + 1; j <= i; j++) {
      if (Number.isNaN(x[j])) { ok = false; break; }
      w.push(x[j]);
    }
    if (ok) out[i] = fn(w);
  }
  return out;
}

const mean = (w: number[]) => w.reduce((a, b) => a + b, 0) / w.length;
export const smaOf = (x: ArrayLike<number>, length: number) => rolling(x, length, mean);
const stdevOf = (x: ArrayLike<number>, length: number) =>
  rolling(x, length, (w) => {
    const m = mean(w);
    return Math.sqrt(w.reduce((a, b) => a + (b - m) ** 2, 0) / w.length);
  });
const maxOf = (x: ArrayLike<number>, length: number) => rolling(x, length, (w) => Math.max(...w));
const minOf = (x: ArrayLike<number>, length: number) => rolling(x, length, (w) => Math.min(...w));

function trueRange(c: Candles): Series {
  const out: Series = new Array<number>(c.close.length).fill(0);
  for (let i = 0; i < out.length; i++) {
    const hl = c.high[i] - c.low[i];
    out[i] = i === 0 ? hl : Math.max(hl, Math.abs(c.high[i] - c.close[i - 1]), Math.abs(c.low[i] - c.close[i - 1]));
  }
  return out;
}

function linregEnd(y: ArrayLike<number>, length: number): Series {
  const out = filled(y.length);
  const xm = (length - 1) / 2;
  let sxx = 0;
  for (let k = 0; k < length; k++) sxx += (k - xm) ** 2;
  const w = Array.from({ length }, (_, k) => 1 / length + ((length - 1 - xm) * (k - xm)) / sxx);
  for (let i = length - 1; i < y.length; i++) {
    let s = 0;
    for (let k = 0; k < length; k++) s += w[k] * y[i - length + 1 + k];
    out[i] = s; // NaN anywhere in the window gives NaN, as in Python
  }
  return out;
}

const map2 = (a: ArrayLike<number>, b: ArrayLike<number>, fn: (x: number, y: number) => number) => Array.from(a, (v, i) => fn(v, b[i]));
const finite = (v: number) => (Number.isFinite(v) ? v : NaN);

// --- trend -----------------------------------------------------------------

export const sma = (c: Candles, p: { length: number }): Output => ({ sma: smaOf(c.close, p.length) });
export const ema = (c: Candles, p: { length: number }): Output => ({ ema: emaOf(c.close, p.length) });

export function macd(c: Candles, p: { fast: number; slow: number; signal: number }): Output {
  const line = map2(emaOf(c.close, p.fast), emaOf(c.close, p.slow), (a, b) => a - b);
  const sig = emaOf(line, p.signal);
  return { macd: line, signal: sig, histogram: map2(line, sig, (a, b) => a - b) };
}

// --- volatility ------------------------------------------------------------

export const atr = (c: Candles, p: { length: number }): Output => ({ atr: rmaOf(trueRange(c), p.length) });

export function bollinger(c: Candles, p: { length: number; mult: number }): Output {
  const mid = smaOf(c.close, p.length);
  const dev = stdevOf(c.close, p.length).map((v) => p.mult * v);
  const upper = map2(mid, dev, (m, d) => m + d);
  const lower = map2(mid, dev, (m, d) => m - d);
  return {
    mid,
    upper,
    lower,
    percent_b: c.close.map((x, i) => finite((x - lower[i]) / (upper[i] - lower[i]))),
    bandwidth: mid.map((m, i) => finite((upper[i] - lower[i]) / m)),
  };
}

export function keltner(c: Candles, p: { length: number; atr_length: number; mult: number }): Output {
  const mid = emaOf(c.close, p.length);
  const band = rmaOf(trueRange(c), p.atr_length).map((v) => p.mult * v);
  return { mid, upper: map2(mid, band, (m, b) => m + b), lower: map2(mid, band, (m, b) => m - b) };
}

/** Squeeze from the publicly described method. Booleans are 1/0, NaN while warming up. */
export function squeeze(c: Candles, p: { length: number; bb_mult: number; kc_mult: number }): Output {
  const n = c.close.length;
  const basis = smaOf(c.close, p.length);
  const dev = stdevOf(c.close, p.length);
  const rangeMa = smaOf(trueRange(c), p.length);
  const on: Series = new Array<number>(n).fill(0);
  const ready = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const bu = basis[i] + p.bb_mult * dev[i], bl = basis[i] - p.bb_mult * dev[i];
    const ku = basis[i] + p.kc_mult * rangeMa[i], kl = basis[i] - p.kc_mult * rangeMa[i];
    ready[i] = !Number.isNaN(bu) && !Number.isNaN(ku) ? 1 : 0;
    on[i] = bl > kl && bu < ku ? 1 : 0;
  }
  const hh = maxOf(c.high, p.length), ll = minOf(c.low, p.length);
  const dist = c.close.map((x, i) => x - ((hh[i] + ll[i]) / 2 + basis[i]) / 2);
  const momentum = linregEnd(dist, p.length);
  const squeezeOn = filled(n), fired = filled(n), rising = filled(n);
  for (let i = 0; i < n; i++) {
    if (ready[i]) {
      squeezeOn[i] = on[i];
      fired[i] = i > 0 && ready[i - 1] && on[i - 1] && !on[i] ? 1 : 0;
    }
    if (i > 0 && !Number.isNaN(momentum[i]) && !Number.isNaN(momentum[i - 1])) {
      rising[i] = momentum[i] > momentum[i - 1] ? 1 : 0;
    }
  }
  return { squeeze_on: squeezeOn, squeeze_fired: fired, momentum, momentum_rising: rising };
}

// --- momentum --------------------------------------------------------------

export function rsi(c: Candles, p: { length: number }): Output {
  const n = c.close.length;
  const change = filled(n);
  for (let i = 1; i < n; i++) change[i] = c.close[i] - c.close[i - 1];
  const gain = rmaOf(change.map((v) => (Number.isNaN(v) ? v : Math.max(v, 0))), p.length);
  const loss = rmaOf(change.map((v) => (Number.isNaN(v) ? v : Math.max(-v, 0))), p.length);
  const out = filled(n);
  for (let i = 0; i < n; i++) {
    const g = gain[i], l = loss[i];
    if (Number.isNaN(g) || (g === 0 && l === 0)) continue;
    out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  }
  return { rsi: out };
}

// --- volume and levels -----------------------------------------------------

function requireIntraday(tf: Timeframe, name: string): number {
  const m = TIMEFRAME_MINUTES[tf];
  if (m >= 1440) throw new Error(`${name} needs intraday candles, not ${tf}`);
  return m;
}

export function vwap(c: Candles, _p: object, tf: Timeframe): Output {
  requireIntraday(tf, "VWAP");
  const out = filled(c.close.length);
  let day = "", pv = 0, vol = 0;
  for (let i = 0; i < out.length; i++) {
    const d = nyParts(c.time[i]).date;
    if (d !== day) { day = d; pv = 0; vol = 0; }
    pv += ((c.high[i] + c.low[i] + c.close[i]) / 3) * c.volume[i];
    vol += c.volume[i];
    out[i] = finite(pv / vol);
  }
  return { vwap: out };
}

export function anchoredVwap(c: Candles, p: { anchor: string }): Output {
  const start = Date.parse(p.anchor) / 1000;
  const out = filled(c.close.length);
  let pv = 0, vol = 0;
  for (let i = 0; i < out.length; i++) {
    if (c.time[i] < start) continue;
    pv += ((c.high[i] + c.low[i] + c.close[i]) / 3) * c.volume[i];
    vol += c.volume[i];
    out[i] = finite(pv / vol);
  }
  return { anchored_vwap: out };
}

export function openingRange(c: Candles, p: { minutes: number }, tf: Timeframe): Output {
  const bar = requireIntraday(tf, "Opening range");
  if (p.minutes % bar !== 0 || p.minutes < bar) {
    throw new Error(`Opening range of ${p.minutes} minutes does not fit ${tf} candles`);
  }
  const expected = p.minutes / bar;
  const OPEN = 9 * 60 + 30;
  const hi = filled(c.close.length), lo = filled(c.close.length);
  let day = "", h = NaN, l = NaN, count = 0;
  for (let i = 0; i < hi.length; i++) {
    const t = nyParts(c.time[i]);
    if (t.date !== day) { day = t.date; h = NaN; l = NaN; count = 0; }
    if (t.minutes >= OPEN && t.minutes < OPEN + p.minutes) {
      h = Number.isNaN(h) ? c.high[i] : Math.max(h, c.high[i]);
      l = Number.isNaN(l) ? c.low[i] : Math.min(l, c.low[i]);
      count++;
    }
    if (t.minutes + bar >= OPEN + p.minutes && count === expected) { hi[i] = h; lo[i] = l; }
  }
  return { or_high: hi, or_low: lo };
}

export function priorDay(c: Candles): Output {
  const n = c.close.length;
  const out = { prior_high: filled(n), prior_low: filled(n), prior_close: filled(n), gap: filled(n) };
  let day = "", prev: { high: number; low: number; close: number } | null = null;
  let cur = { high: NaN, low: NaN, close: NaN };
  let gap = NaN;
  for (let i = 0; i < n; i++) {
    const d = nyParts(c.time[i]).date;
    if (d !== day) {
      if (day) prev = cur;
      day = d;
      cur = { high: c.high[i], low: c.low[i], close: c.close[i] };
      gap = prev ? c.open[i] / prev.close - 1 : NaN;
    } else {
      cur.high = Math.max(cur.high, c.high[i]);
      cur.low = Math.min(cur.low, c.low[i]);
      cur.close = c.close[i];
    }
    if (prev) {
      out.prior_high[i] = prev.high;
      out.prior_low[i] = prev.low;
      out.prior_close[i] = prev.close;
      out.gap[i] = gap;
    }
  }
  return out;
}
