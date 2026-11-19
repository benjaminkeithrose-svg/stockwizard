import { describe, expect, it } from "vitest";
import type { Candles } from "../src/data/candles";
import { closeTrade, MIN_SHOWN, openTrade, shown, startAt, step, summary } from "../src/data/replay";

const candles = (n: number): Candles => ({
  time: Array.from({ length: n }, (_, i) => 1_700_000_000 + i * 86400),
  open: Array.from({ length: n }, (_, i) => 100 + i), high: Array.from({ length: n }, (_, i) => 101 + i),
  low: Array.from({ length: n }, (_, i) => 99 + i), close: Array.from({ length: n }, (_, i) => 100 + i),
  volume: Array.from({ length: n }, () => 1), source: "made-up",
});

describe("bar replay", () => {
  it("starts on the tapped candle and hides everything after it", () => {
    const c = candles(200);
    const r = startAt(c, c.time[120]);
    expect(r.at).toBe(121);
    const s = shown(c, r);
    expect(s.time.length).toBe(121);
    expect(s.time[s.time.length - 1]).toBe(c.time[120]);
    expect(shown(c, null)).toBe(c);
  });
  it("keeps enough history for the indicators, and never runs past the last candle", () => {
    const c = candles(200);
    expect(startAt(c, c.time[3]).at).toBe(MIN_SHOWN);
    const r = startAt(c, c.time[195]);
    expect(step(r, 10, 200).at).toBe(200);
    expect(step({ ...r, playing: true }, 10, 200).playing).toBe(false);
    expect(step(r, -500, 200).at).toBe(MIN_SHOWN);
  });
  it("scores practice trades at the replayed closes, long and short", () => {
    const c = candles(200);
    let r = startAt(c, c.time[99]);          // close 199
    r = openTrade(c, r, "long");
    r = step(r, 10, 200);                    // close 209
    r = closeTrade(c, r);
    expect(r.trades[0].pct).toBeCloseTo((209 / 199 - 1) * 100);
    r = openTrade(c, r, "short");
    r = step(r, 5, 200);                     // close 214
    r = closeTrade(c, r);
    expect(r.trades[1].pct).toBeCloseTo((209 / 214 - 1) * 100);
    const s = summary(r);
    expect([s.trades, s.won]).toEqual([2, 1]);
  });
});
