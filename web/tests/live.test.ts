import { describe, expect, it } from "vitest";
import { Candles } from "../src/data/candles";
import { bucket, LiveBar, sessionOpen, todayStartIso, withLive } from "../src/data/live";

// New York time on 18 Nov 2026 (winter, UTC-5) as UTC seconds.
const ny = (hhmm: string, day = "2026-11-18") => Date.parse(`${day}T${hhmm}:00-05:00`) / 1000;
const bar = (hhmm: string, close: number, extra: Partial<LiveBar> = {}): LiveBar =>
  ({ time: ny(hhmm), open: close, high: close + 0.5, low: close - 0.5, close, volume: 100, delayed: false, ...extra });
const candles = (times: number[]): Candles =>
  ({ time: times, open: times.map(() => 600), high: times.map(() => 601), low: times.map(() => 599), close: times.map(() => 600), volume: times.map(() => 1000), source: "ibkr" });

describe("live bars", () => {
  it("fall into IBKR's candles: from 9:30, then on the hour for 1h, and midnight New York for 1d", () => {
    expect(bucket(ny("10:07"), "5m")).toBe(ny("10:05"));
    expect(bucket(ny("09:44"), "15m")).toBe(ny("09:30"));
    expect(bucket(ny("09:59"), "1h")).toBe(ny("09:30"));
    expect(bucket(ny("10:01"), "1h")).toBe(ny("10:00"));
    expect(bucket(ny("15:59"), "1d")).toBe(ny("00:00"));
  });

  it("build the candles after the last stored one, the last still forming", () => {
    const stored = candles([ny("09:55"), ny("10:00")]);                 // 5m candles to 10:00, finished
    const out = withLive(stored, [bar("10:03", 601), bar("10:05", 602), bar("10:06", 603), bar("10:07", 600)], "5m");
    expect(out.time).toEqual([ny("09:55"), ny("10:00"), ny("10:05")]);  // 10:03 is inside the stored 10:00 candle
    const i = 2;
    expect([out.open[i], out.high[i], out.low[i], out.close[i], out.volume[i]]).toEqual([602, 603.5, 599.5, 600, 300]);
    expect(stored.time).toHaveLength(2);                                  // the stored candles aren't changed
  });

  it("make today's daily candle from the morning so far", () => {
    const out = withLive(candles([ny("00:00", "2026-11-17")]), [bar("09:30", 600), bar("11:15", 605)], "1d");
    expect(out.time.at(-1)).toBe(ny("00:00"));
    expect(out.close.at(-1)).toBe(605);
    expect(out.time).toHaveLength(2);
  });

  it("leave the candles as they are with no live bars", () => {
    const stored = candles([ny("10:00")]);
    expect(withLive(stored, [], "5m")).toBe(stored);
  });

  it("are only looked for in US hours on weekdays", () => {
    expect(sessionOpen(new Date(ny("09:30") * 1000))).toBe(true);
    expect(sessionOpen(new Date(ny("15:59") * 1000))).toBe(true);
    expect(sessionOpen(new Date(ny("16:00") * 1000))).toBe(false);
    expect(sessionOpen(new Date(ny("09:29") * 1000))).toBe(false);
    expect(sessionOpen(new Date(ny("11:00", "2026-11-21") * 1000))).toBe(false);   // Saturday
  });

  it("are today's from New York midnight", () => {
    expect(todayStartIso(new Date(ny("13:45") * 1000))).toBe("2026-11-18T05:00:00.000Z");
  });
});
