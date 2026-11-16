import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { APP_BUILD } from "../src/config";
import { duplicateWorkspace, newWorkspace } from "../src/data/model";
import { madeUpCandles } from "../src/data/candles";

describe("build version", () => {
  it("the service worker's cache name moves with APP_BUILD", () => {
    const sw = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
    expect(sw).toContain(`const CACHE = "stockwizard-${APP_BUILD}";`);
  });
});

describe("workspaces", () => {
  it("a new tab starts with an EMA and the squeeze", () => {
    const w = newWorkspace("SPY", "1d", 0);
    expect(w.name).toBe("SPY 1d");
    expect(w.indicators.map((i) => i.name)).toEqual(["ema", "squeeze"]);
    expect(w.indicators[0].code_version).toBe("ema@1");
  });

  it("a duplicate is a separate copy with new ids", () => {
    const w = newWorkspace("SPY", "1h", 0);
    w.drawings.push({ id: "d1", kind: "level", price: 500 });
    const c = duplicateWorkspace(w, 1);
    expect(c.id).not.toBe(w.id);
    expect(c.name).toBe("SPY 1h copy");
    expect(c.drawings[0].id).not.toBe("d1");
    expect(c.indicators.map((i) => i.id)).not.toEqual(w.indicators.map((i) => i.id));
    c.drawings.length = 0;
    expect(w.drawings).toHaveLength(1);
  });
});

describe("made-up candles", () => {
  it("are valid candles in time order", () => {
    for (const tf of ["5m", "1d"] as const) {
      const c = madeUpCandles(tf, 300, 7);
      expect(c.time).toHaveLength(300);
      expect(c.source).toBe("made-up");
      c.time.forEach((t, i) => {
        if (i) expect(t).toBeGreaterThan(c.time[i - 1]);
        expect(c.high[i]).toBeGreaterThanOrEqual(Math.max(c.open[i], c.close[i]));
        expect(c.low[i]).toBeLessThanOrEqual(Math.min(c.open[i], c.close[i]));
      });
    }
  });
});

import { describe as describeResult } from "../src/ui/Scanner";
import { latestPerScan } from "../src/data/store";

describe("scanner", () => {
  it("each result reads as one plain line", () => {
    const r = (vals: Record<string, number>, direction: "up" | "down" | null = "up", context = {}) =>
      ({ symbol: "SPY", candle_ts: "2026-11-13T05:00:00Z", direction, vals, context });
    expect(describeResult("squeeze_on", r({ candles_on: 6, momentum: 0.42 }))).toBe("On for 6 candles · momentum +0.42");
    expect(describeResult("breakout", r({ level: 512.3, volume_ratio: 0 }, "down"), { length: 20 })).toBe("Below the 20-candle low of 512.3");
    expect(describeResult("drawdown", r({ drawdown_pct: -5.43, first_day: 1 }, "down", { "^VIX": 19.21 }), { lookback: 60 }))
      .toBe("-5.4% from the 60-day high · first day · VIX 19.2");
    expect(describeResult("trend_break", r({ below_by_pct: -0.83 }, "down"), { length: 50 })).toBe("Closed 0.8% below the 50-day average");
  });

  it("keeps only the newest run of each scan, with its own results", () => {
    const runs = [
      { id: 3, scan_id: "a", ran_at: "2026-11-17", as_of: "", symbols: [], source: "", matches: 1, notes: null },
      { id: 1, scan_id: "a", ran_at: "2026-11-16", as_of: "", symbols: [], source: "", matches: 1, notes: null },
      { id: 2, scan_id: "b", ran_at: "2026-11-16", as_of: "", symbols: [], source: "", matches: 0, notes: null },
    ];
    const res = (run_id: number, symbol: string) => ({ run_id, symbol, candle_ts: "", direction: null, vals: {}, context: {} });
    const out = latestPerScan(runs, [res(3, "Z"), res(3, "A"), res(1, "OLD")]);
    expect(out.a.id).toBe(3);
    expect(out.a.results.map((r) => r.symbol)).toEqual(["A", "Z"]);
    expect(out.b.results).toEqual([]);
  });
});
