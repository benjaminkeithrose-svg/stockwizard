// The scan rules and the backtester, against the Python library's numbers (golden.json),
// plus the truncation test on the browser copy of the rules.

import { describe, expect, it } from "vitest";
import golden from "../src/indicators/golden.json";
import { evaluate, RULES } from "../src/engine/scans";
import { betaBinomialRange, lgamma, report, run, Strategy } from "../src/engine/backtest";
import { Candles, sliceCandles } from "../src/data/candles";

const TOL = 1e-9;
const same = (a: number | null, b: number | null) =>
  (a === null && b === null) || (a !== null && b !== null && Math.abs(a - b) <= TOL * Math.max(1, Math.abs(a), Math.abs(b)));
const num = (v: number) => (Number.isNaN(v) ? null : v);

const g = golden as any;
const daily: Candles = { ...g.frames["1d"].candles, source: "made-up" };

describe("scan rules match the Python library", () => {
  for (const [name, want] of Object.entries<any>(g.scans)) {
    it(name, () => {
      const got = evaluate(name, daily, want.params);
      const badHit = want.hit.findIndex((h: boolean | null, i: number) => h !== got.hit[i]);
      expect(badHit, `${name} hit differs at ${badHit}: ${want.hit[badHit]} vs ${got.hit[badHit]}`).toBe(-1);
      const badDir = want.direction.findIndex((d: string | null, i: number) => d !== got.direction[i]);
      expect(badDir, `${name} direction differs at ${badDir}`).toBe(-1);
      for (const [col, vals] of Object.entries<(number | null)[]>(want.values)) {
        const bad = vals.findIndex((v, i) => !same(v, num(got.values[col][i])));
        expect(bad, `${name}.${col} differs at ${bad}: ${vals[bad]} vs ${got.values[col][bad]}`).toBe(-1);
      }
      expect(want.hit.some(Boolean), `${name} fires somewhere`).toBe(true);
    });

    it(`${name} does not look ahead`, () => {
      const full = evaluate(name, daily, want.params);
      for (const k of [40, 120, 250, daily.time.length - 1]) {
        const cut = evaluate(name, sliceCandles(daily, k), want.params);
        expect(cut.hit.every((h, i) => h === full.hit[i]), `${name} cut at ${k}`).toBe(true);
      }
    });
  }

  it("every rule is covered", () => expect(Object.keys(g.scans).sort()).toEqual(Object.keys(RULES).sort()));
});

describe("backtester matches the Python library", () => {
  const spy: Candles = { ...g.backtest.candles.SPY, source: "made-up" };
  const vix: Candles = { ...g.backtest.candles.VIX, source: "made-up" };
  for (const [i, c] of (g.backtest.cases as any[]).entries()) {
    it(`case ${i}: ${c.config.signal_rule}`, () => {
      const res = run(c.config as Strategy, spy, vix, g.backtest.start);
      expect(res.trades.length).toBe(c.trades.length);
      expect(c.trades.length).toBeGreaterThan(5);
      res.trades.forEach((t, k) => {
        const w = c.trades[k];
        expect([t.signal_ts, t.entry_ts, t.exit_ts, t.exit_reason, t.bars], `trade ${k}`).toEqual([w.signal_ts, w.entry_ts, w.exit_ts, w.exit_reason, w.bars]);
        for (const key of ["entry_price", "exit_price", "return_pct", "best_pct"] as const) {
          expect(same(t[key], w[key]), `trade ${k} ${key}: ${t[key]} vs ${w[key]}`).toBe(true);
        }
      });
      expect(res.skipped).toEqual(c.skipped);
      const rep = report(res, g.backtest.start, g.backtest.split);
      for (const period of ["build", "held_back"] as const) {
        for (const [k, v] of Object.entries<any>(c.report[period])) {
          const mine = (rep[period] as any)[k];
          if (typeof v === "number") expect(same(mine, v), `${period}.${k}: ${mine} vs ${v}`).toBe(true);
          else expect(mine, `${period}.${k}`).toEqual(v);
        }
      }
      expect(rep.windows.map((w) => [w.from, w.to, w.period, w.trades])).toEqual(c.report.windows.map((w: any) => [w.from, w.to, w.period, w.trades]));
      expect(rep.warnings).toEqual(c.report.warnings);
    });
  }

  it("no finished trade changes when later candles are removed", () => {
    const c = g.backtest.cases[0];
    const full = run(c.config, spy, vix, g.backtest.start).trades.filter((t) => t.exit_reason !== "open");
    for (const k of [400, 900, 1300]) {
      const cut = run(c.config, sliceCandles(spy, k), sliceCandles(vix, k), g.backtest.start).trades.filter((t) => t.exit_reason !== "open");
      expect(cut).toEqual(full.filter((t) => t.exit_ts! < vix.time[k]));
    }
  });

  it("lgamma and the likely range", () => {
    expect(lgamma(5)).toBeCloseTo(Math.log(24), 12);
    expect(lgamma(0.5)).toBeCloseTo(Math.log(Math.sqrt(Math.PI)), 12);
    const [lo, hi] = betaBinomialRange(50, 50);
    expect(lo).toBeGreaterThanOrEqual(38);
    expect(hi).toBeLessThanOrEqual(62);
  });
});
