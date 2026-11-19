import { describe, expect, it } from "vitest";
import type { Candles } from "../src/data/candles";
import { resample } from "../src/data/live";

// Six 5-minute candles from 9:30 New York on 18 Nov 2026 (14:30 UTC).
const t0 = Date.parse("2026-11-18T14:30:00Z") / 1000;
const five: Candles = {
  time: [0, 1, 2, 3, 4, 5].map((i) => t0 + i * 300),
  open: [10, 11, 12, 13, 14, 15], high: [11, 13, 12.5, 14, 16, 15.5], low: [9, 10.5, 11, 12, 13.5, 14],
  close: [11, 12, 13, 14, 15, 15], volume: [1, 2, 3, 4, 5, 6], source: "ibkr",
};

describe("15- and 30-minute candles built from 5-minute ones", () => {
  it("groups by IBKR's grid from 9:30 and keeps open, high, low, close and volume right", () => {
    const q = resample(five, "15m");
    expect(q.time).toEqual([t0, t0 + 900]);
    expect([q.open[0], q.high[0], q.low[0], q.close[0], q.volume[0]]).toEqual([10, 13, 9, 13, 6]);
    expect([q.open[1], q.high[1], q.low[1], q.close[1], q.volume[1]]).toEqual([13, 16, 12, 15, 15]);
    const h = resample(five, "30m");
    expect(h.time).toEqual([t0]);
    expect([h.open[0], h.high[0], h.low[0], h.close[0], h.volume[0]]).toEqual([10, 16, 9, 15, 21]);
    expect(h.source).toBe("ibkr");
  });
});
