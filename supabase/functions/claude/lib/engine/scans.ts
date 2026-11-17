// The browser's (and the Claude function's) copy of backend/stockwizard/scans.py.
//
// Each rule gives a signal for every candle from that candle and earlier ones
// only. tests/engine.test.ts checks every rule against the Python library's
// numbers (golden.json) and runs the truncation test. Change both together.

import type { Candles } from "../data/candles.ts";
import * as core from "../indicators/core.ts";

export type Hit = boolean | null; // null while warming up
export interface RuleOutput {
  hit: Hit[];
  direction: ("up" | "down" | null)[];
  values: Record<string, number[]>;
}

const nan = (n: number) => new Array<number>(n).fill(NaN);
const ok = (v: number) => !Number.isNaN(v);

function rollingMax(x: number[], len: number, skipNaN = false, minPeriods = len): number[] {
  const out = nan(x.length);
  for (let i = 0; i < x.length; i++) {
    let m = -Infinity, count = 0, bad = false;
    for (let j = Math.max(0, i - len + 1); j <= i; j++) {
      if (Number.isNaN(x[j])) { if (!skipNaN) bad = true; continue; }
      count++;
      if (x[j] > m) m = x[j];
    }
    if (!bad && count >= minPeriods && i - len + 1 >= (skipNaN ? -Infinity : 0)) out[i] = m;
  }
  return out;
}
function rollingMin(x: number[], len: number): number[] {
  return rollingMax(x.map((v) => -v), len).map((v) => -v);
}
function rollingMean(x: number[], len: number): number[] {
  const out = nan(x.length);
  for (let i = len - 1; i < x.length; i++) {
    let s = 0, bad = false;
    for (let j = i - len + 1; j <= i; j++) { if (Number.isNaN(x[j])) { bad = true; break; } s += x[j]; }
    if (!bad) out[i] = s / len;
  }
  return out;
}
const shift = (x: number[], k = 1) => x.map((_, i) => (i - k >= 0 && i - k < x.length ? x[i - k] : NaN));

function directions(hit: Hit[], up: boolean[]): ("up" | "down" | null)[] {
  return hit.map((h, i) => (h ? (up[i] ? "up" : "down") : null));
}

export function squeezeOn(c: Candles, p: { length: number; bb_mult: number; kc_mult: number }): RuleOutput {
  const sq = core.squeeze(c, p);
  const n = c.close.length;
  const hit: Hit[] = sq.squeeze_on.map((v) => (ok(v) ? v === 1 : null));
  const candlesOn = nan(n);
  let streak = 0;
  for (let i = 0; i < n; i++) {
    streak = hit[i] ? streak + 1 : 0;
    if (hit[i] !== null) candlesOn[i] = streak;
  }
  return { hit, direction: directions(hit, sq.momentum.map((m) => m >= 0)), values: { candles_on: candlesOn, momentum: sq.momentum } };
}

export function squeezeFired(c: Candles, p: { length: number; bb_mult: number; kc_mult: number }): RuleOutput {
  const sq = core.squeeze(c, p);
  const hit: Hit[] = sq.squeeze_fired.map((v) => (ok(v) ? v === 1 : null));
  return { hit, direction: directions(hit, sq.momentum.map((m) => m >= 0)), values: { momentum: sq.momentum } };
}

export function breakout(c: Candles, p: { length: number; volume_mult: number }): RuleOutput {
  const n = c.close.length;
  const priorHigh = rollingMax(shift(c.high), p.length);
  const priorLow = rollingMin(shift(c.low), p.length);
  const avgVol = rollingMean(shift(c.volume), p.length);
  const volRatio = c.volume.map((v, i) => { const r = v / avgVol[i]; return Number.isFinite(r) ? r : NaN; });
  const up = c.close.map((x, i) => x > priorHigh[i]);
  const down = c.close.map((x, i) => x < priorLow[i]);
  const hit: Hit[] = [];
  for (let i = 0; i < n; i++) {
    let ready = ok(priorHigh[i]);
    let h = up[i] || down[i];
    if (p.volume_mult > 0) { h = h && volRatio[i] >= p.volume_mult; ready = ready && ok(volRatio[i]); }
    hit.push(ready ? h : null);
  }
  return {
    hit,
    direction: directions(hit, up),
    values: { level: priorHigh.map((v, i) => (up[i] ? v : priorLow[i])), volume_ratio: volRatio },
  };
}

export function trendBreak(c: Candles, p: { length: number }): RuleOutput {
  const avg = core.sma(c, p).sma;
  const n = c.close.length;
  const hit: Hit[] = [];
  for (let i = 0; i < n; i++) {
    const ready = ok(avg[i]) && i > 0 && ok(avg[i - 1]);
    hit.push(ready ? c.close[i] < avg[i] && c.close[i - 1] >= avg[i - 1] : null);
  }
  return {
    hit,
    direction: directions(hit, new Array(n).fill(false)),
    values: { average: avg, below_by_pct: c.close.map((x, i) => (x / avg[i] - 1) * 100) },
  };
}

export function drawdown(c: Candles, p: { lookback: number; pct: number }): RuleOutput {
  const peak = rollingMax(c.close, p.lookback);
  const dd = c.close.map((x, i) => (x / peak[i] - 1) * 100);
  const cond = dd.map((v) => v <= -p.pct);
  const hit: Hit[] = peak.map((v, i) => (ok(v) ? cond[i] : null));
  const first = cond.map((v, i) => v && !(i > 0 && cond[i - 1]));
  return {
    hit,
    direction: directions(hit, new Array(hit.length).fill(false)),
    values: { drawdown_pct: dd, first_day: first.map((v, i) => (ok(peak[i]) ? (v ? 1 : 0) : NaN)) },
  };
}

export function rsiDivergence(
  c: Candles, p: { high_lookback: number; rsi_length: number; window: number; gap: number; min_drop: number },
): RuleOutput {
  const rsi = core.rsi(c, { length: p.rsi_length }).rsi;
  const highMax = rollingMax(c.close, p.high_lookback);
  const newHigh = c.close.map((x, i) => x >= highMax[i]);
  const rsiAtHighs = rsi.map((v, i) => (newHigh[i] ? v : NaN));
  // pandas: shift(gap).rolling(window - gap, min_periods=1).max() skips NaN inside the window
  const earlier = rollingMax(shift(rsiAtHighs, p.gap), p.window - p.gap, true, 1);
  const hit: Hit[] = rsi.map((r, i) => {
    const ready = ok(r) && ok(highMax[i]);
    return ready ? newHigh[i] && ok(earlier[i]) && r <= earlier[i] - p.min_drop : null;
  });
  return { hit, direction: directions(hit, new Array(hit.length).fill(false)), values: { rsi, earlier_rsi: earlier } };
}

type Rule = { version: number; defaults: Record<string, number>; run: (c: Candles, p: Record<string, number>) => RuleOutput };
const n = (p: Record<string, number>, k: string) => Number(p[k]);

export const RULES: Record<string, Rule> = {
  squeeze_on: { version: 1, defaults: { length: 20, bb_mult: 2, kc_mult: 1.5 }, run: (c, p) => squeezeOn(c, { length: n(p, "length"), bb_mult: n(p, "bb_mult"), kc_mult: n(p, "kc_mult") }) },
  squeeze_fired: { version: 1, defaults: { length: 20, bb_mult: 2, kc_mult: 1.5 }, run: (c, p) => squeezeFired(c, { length: n(p, "length"), bb_mult: n(p, "bb_mult"), kc_mult: n(p, "kc_mult") }) },
  breakout: { version: 1, defaults: { length: 20, volume_mult: 0 }, run: (c, p) => breakout(c, { length: n(p, "length"), volume_mult: n(p, "volume_mult") }) },
  trend_break: { version: 1, defaults: { length: 50 }, run: (c, p) => trendBreak(c, { length: n(p, "length") }) },
  drawdown: { version: 1, defaults: { lookback: 60, pct: 5 }, run: (c, p) => drawdown(c, { lookback: n(p, "lookback"), pct: n(p, "pct") }) },
  rsi_divergence: {
    version: 1, defaults: { high_lookback: 20, rsi_length: 14, window: 60, gap: 5, min_drop: 2 },
    run: (c, p) => rsiDivergence(c, { high_lookback: n(p, "high_lookback"), rsi_length: n(p, "rsi_length"), window: n(p, "window"), gap: n(p, "gap"), min_drop: n(p, "min_drop") }),
  },
};

export function evaluate(rule: string, c: Candles, params: Record<string, number> = {}): RuleOutput {
  const r = RULES[rule];
  if (!r) throw new Error(`No scan rule called ${rule}`);
  return r.run(c, { ...r.defaults, ...params });
}
