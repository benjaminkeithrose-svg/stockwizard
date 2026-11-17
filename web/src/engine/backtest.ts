// The browser's (and the Claude function's) copy of backend/stockwizard/backtest.py.
//
// Same rules: candles in time order; a signal is judged at its candle's
// close; entries fill at the next candle's open; stop before target inside one
// candle; costs on every fill; one position at a time. tests/engine.test.ts
// checks trades and metrics against the Python library's (golden.json).

import { Candles, nyParts } from "../data/candles.ts";
import { evaluate, Hit } from "./scans.ts";

export interface Strategy {
  signal_symbol: string;
  signal_rule: string;
  signal_params: Record<string, number>;
  trade_symbol: string;
  target_pct?: number | null;
  target_level?: number | null;
  stop_pct?: number | null;
  max_bars?: number;
  cost_pct?: number;
  study?: boolean;
  filter_symbol?: string | null;   // take a signal only when this symbol's close that day is...
  filter_max?: number | null;      // ...at or below this (e.g. the VIX at or below 15)
  filter_min?: number | null;      // ...and/or at or above this
}

export interface Trade {
  signal_ts: number;   // seconds, UTC
  entry_ts: number;
  entry_price: number;
  exit_ts: number | null;
  exit_price: number | null;
  exit_reason: "target" | "stop" | "time" | "open" | null;
  bars: number;
  return_pct: number | null;
  best_pct: number;
  signal_vals: Record<string, number | null>;
}

export interface Result {
  trades: Trade[];
  skipped: { already_in_trade: number; already_past_target: number; no_next_candle: number; filtered_out: number };
  inMarket: boolean[];   // per traded candle
  times: number[];       // the traded candles' times
}

const ret = (entry: number, exit: number, cost: number) => ((exit * (1 - cost / 100)) / (entry * (1 + cost / 100))) * 100 - 100;

/** The filter symbol's close on each trading date (matched by date: daily candles are stamped in each exchange's own time zone). */
function closesByDate(c: Candles): Map<string, number> {
  const m = new Map<string, number>();
  c.time.forEach((t, i) => m.set(nyParts(t).date, c.close[i]));
  return m;
}

export function run(s: Strategy, signal: Candles, trade: Candles, start: number, signals?: { hit: Hit[] }, filter?: Candles): Result {
  const sig = signals ? { hit: signals.hit, values: {} as Record<string, number[]> } : evaluate(s.signal_rule, signal, s.signal_params);
  if (s.filter_symbol && !filter) throw new Error(`The strategy filters on ${s.filter_symbol} but no candles were given for it`);
  const filterBy = s.filter_symbol && filter ? closesByDate(filter) : null;
  const passes = (t: number) => {
    if (!filterBy) return true;
    const v = filterBy.get(nyParts(t).date);
    if (v === undefined || Number.isNaN(v)) return false;
    return (s.filter_max == null || v <= s.filter_max) && (s.filter_min == null || v >= s.filter_min);
  };
  let filteredOut = 0;
  const queue: { ts: number; vals: Record<string, number | null> }[] = [];
  sig.hit.forEach((h, i) => {
    if (h && signal.time[i] >= start) {
      if (!passes(signal.time[i])) { filteredOut++; return; }
      const vals: Record<string, number | null> = {};
      for (const [k, v] of Object.entries(sig.values)) vals[k] = Number.isNaN(v[i]) ? null : v[i];
      queue.push({ ts: signal.time[i], vals });
    }
  });
  const maxBars = s.max_bars ?? 20, cost = s.cost_pct ?? 0;
  const trades: Trade[] = [];
  const skipped = { already_in_trade: 0, already_past_target: 0, no_next_candle: 0, filtered_out: filteredOut };
  const inMarket = new Array<boolean>(trade.time.length).fill(false);
  let pos: Trade | null = null;
  let pending: { ts: number; vals: Record<string, number | null> } | null = null;
  let qi = 0;

  for (let j = 0; j < trade.time.length; j++) {
    const ts = trade.time[j], o = trade.open[j], h = trade.high[j], l = trade.low[j], c = trade.close[j];

    if (pending && !pos) {
      const p: { ts: number; vals: Record<string, number | null> } = pending;
      pending = null;
      if (s.target_level != null && o >= s.target_level) skipped.already_past_target++;
      else pos = { signal_ts: p.ts, entry_ts: ts, entry_price: o, exit_ts: null, exit_price: null, exit_reason: null, bars: 0, return_pct: null, best_pct: 0, signal_vals: p.vals };
    }

    if (pos) {
      inMarket[j] = true;
      pos.bars++;
      const stop = s.stop_pct != null ? pos.entry_price * (1 - s.stop_pct / 100) : null;
      const target = s.target_level != null ? s.target_level : s.target_pct != null ? pos.entry_price * (1 + s.target_pct / 100) : null;
      pos.best_pct = Math.max(pos.best_pct, (h / pos.entry_price - 1) * 100);
      let exit: number | null = null, reason: Trade["exit_reason"] = null;
      if (stop !== null && l <= stop) { exit = o <= stop ? o : stop; reason = "stop"; }       // stop first
      else if (target !== null && h >= target) { exit = o >= target ? o : target; reason = "target"; }
      else if (pos.bars >= maxBars) { exit = c; reason = "time"; }
      if (reason) {
        pos.exit_ts = ts; pos.exit_price = exit; pos.exit_reason = reason;
        pos.return_pct = ret(pos.entry_price, exit!, cost);
        trades.push(pos);
        pos = null;
      }
    }

    while (qi < queue.length && queue[qi].ts <= ts) {
      const q = queue[qi++];
      if (pos || pending) skipped.already_in_trade++;
      else if (j + 1 >= trade.time.length) skipped.no_next_candle++;
      else pending = q;
    }
  }
  if (pos) { pos.exit_reason = "open"; trades.push(pos); }
  return { trades, skipped, inMarket, times: trade.time };
}

// --- metrics ------------------------------------------------------------------

/** log Γ(x), Lanczos approximation (g = 7, n = 9): JavaScript has no built-in. */
export function lgamma(x: number): number {
  const g = 7;
  const cf = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lgamma(1 - x);
  x -= 1;
  let a = cf[0];
  const t = x + g + 0.5;
  for (let i = 1; i < 9; i++) a += cf[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

export function betaBinomialRange(wins: number, losses: number, n = 100, lo = 0.05, hi = 0.95): [number, number] {
  const a = wins + 1, b = losses + 1;
  const p: number[] = [];
  for (let k = 0; k <= n; k++) {
    p.push(Math.exp(lgamma(n + 1) - lgamma(k + 1) - lgamma(n - k + 1) + lgamma(k + a) + lgamma(n - k + b) - lgamma(n + a + b)
      - (lgamma(a) + lgamma(b) - lgamma(a + b))));
  }
  const total = p.reduce((x, y) => x + y, 0);
  let cum = 0, low: number | null = null, high: number | null = null;
  p.forEach((pk, k) => { cum += pk / total; if (low === null && cum >= lo) low = k; if (high === null && cum >= hi) high = k; });
  return [low!, high!];
}

const r6 = (v: number | null) => (v === null || !Number.isFinite(v) ? v : Number(v.toPrecision(6)));

export function metrics(trades: Trade[], bars: number, barsInMarket: number) {
  const done = trades.filter((t) => t.exit_reason !== "open");
  const rets = done.map((t) => t.return_pct!);
  const wins = rets.filter((r) => r > 0), losses = rets.filter((r) => r <= 0);
  let equity = 1, peak = 1, maxDd = 0, streak = 0, longest = 0;
  for (const r of rets) {
    equity *= 1 + r / 100;
    peak = Math.max(peak, equity);
    maxDd = Math.min(maxDd, (equity / peak - 1) * 100);
    streak = r <= 0 ? streak + 1 : 0;
    longest = Math.max(longest, streak);
  }
  const n = rets.length;
  const sum = (x: number[]) => x.reduce((a, b) => a + b, 0);
  const [low, high] = n ? betaBinomialRange(wins.length, losses.length) : [null, null];
  const hits = done.filter((t) => t.exit_reason === "target").length;
  const [hLow, hHigh] = n ? betaBinomialRange(hits, n - hits) : [null, null];
  return {
    trades: n,
    targets_hit: hits,
    target_rate: r6(n ? (hits / n) * 100 : null),
    next_100_targets_low: hLow,
    next_100_targets_high: hHigh,
    wins: wins.length,
    win_rate: r6(n ? (wins.length / n) * 100 : null),
    next_100_wins_low: low,
    next_100_wins_high: high,
    avg_win_pct: r6(wins.length ? sum(wins) / wins.length : null),
    avg_loss_pct: r6(losses.length ? sum(losses) / losses.length : null),
    profit_factor: r6(losses.length && sum(losses) < 0 ? sum(wins) / -sum(losses) : null),
    expectancy_pct: r6(n ? sum(rets) / n : null),
    return_pct: r6(n ? (equity - 1) * 100 : null),
    max_drawdown_pct: r6(n ? maxDd : null),
    longest_losing_streak: longest,
    time_in_market_pct: r6(bars ? (barsInMarket / bars) * 100 : null),
    avg_bars_held: r6(n ? sum(done.map((t) => t.bars)) / n : null),
    exits: { target: hits, stop: done.filter((t) => t.exit_reason === "stop").length, time: done.filter((t) => t.exit_reason === "time").length },
  };
}
export type Metrics = ReturnType<typeof metrics>;

const DAY = 86400;
const isoDate = (s: number) => new Date(s * 1000).toISOString().slice(0, 10);
function addYears(s: number, years: number) {
  const d = new Date(s * 1000);
  return Date.UTC(d.getUTCFullYear() + years, d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()) / 1000;
}

export function report(res: Result, start: number, split: number, windowYears = 3) {
  const idx: number[] = [], im: boolean[] = [];
  res.times.forEach((t, i) => { if (t >= start) { idx.push(t); im.push(res.inMarket[i]); } });
  const part = (lo: number, hi: number) => {
    const ts = res.trades.filter((t) => lo <= t.entry_ts && t.entry_ts < hi);
    let bars = 0, inm = 0;
    idx.forEach((t, i) => { if (t >= lo && t < hi) { bars++; if (im[i]) inm++; } });
    return metrics(ts, bars, inm);
  };
  const end = idx.length ? idx[idx.length - 1] + DAY : split;
  const windows: (Metrics & { from: string; to: string; period: string })[] = [];
  for (let lo = start; lo < end;) {
    const hi = Math.min(addYears(lo, windowYears), end);
    const period = hi <= split ? "build" : lo >= split ? "held_back" : "both";
    windows.push({ from: isoDate(lo), to: isoDate(hi - DAY), period, ...part(lo, hi) });
    lo = hi;
  }
  const out = { build: part(start, split), held_back: part(split, end), windows, warnings: [] as string[] };
  out.warnings = warnings(out.build, out.held_back);
  return out;
}

export function warnings(b: Metrics, h: Metrics): string[] {
  const w: string[] = [];
  if (b.trades < 30 || h.trades < 30) w.push("Few trades: the win-rate ranges are wide, so treat the win rates as rough.");
  for (const [key, what] of [["target_rate", "target rate"], ["win_rate", "win rate"]] as const) {
    const bv = b[key], hv = h[key];
    if (bv !== null && hv !== null && h.trades >= 5 && hv > bv + 15) {
      w.push(`The held-back ${what} is far better than the build period's. The spec treats that as something to investigate, not a win.`);
    }
  }
  return w;
}
