import { describe, expect, it } from "vitest";
import { madeUpCandles, nyParts } from "../src/data/candles";
import type { Candles } from "../src/data/candles";
import type { OptionPosition } from "../src/data/options";
import { COMMISSION, shapeOf, SLIPPAGE, summarise, testHistory, testShape, weekdaysBetween } from "../src/data/history";
import { blackScholes } from "../src/data/pricing";

const lastDate = (c: Candles) => nyParts(c.time[c.time.length - 1]).date;
/** The date `n` weekdays after `from`. */
function weekdaysOn(from: string, n: number): string {
  const d = new Date(`${from}T12:00:00Z`);
  while (n > 0) { d.setUTCDate(d.getUTCDate() + 1); if (d.getUTCDay() % 6) n--; }
  return d.toISOString().slice(0, 10);
}
const flat = (count: number): Candles => {
  const c = madeUpCandles("1d", count, 5);
  return { ...c, open: c.time.map(() => 100), high: c.time.map((_, i) => 100 + (i % 2 ? 1 : 0.5)), low: c.time.map(() => 99), close: c.time.map(() => 100) };
};
const position = (c: Candles, legs: OptionPosition["legs"], sessions = 5): OptionPosition => ({
  id: "t", symbol: "XYZ", structure: "iron_condor", expiry: weekdaysOn(lastDate(c), sessions), legs, status: "planned", note: null,
});

describe("weekdays to expiry", () => {
  it("counts the sessions after today up to and including the expiry", () => {
    expect(weekdaysBetween("2026-11-13", "2026-11-20")).toBe(5);   // Friday to the next Friday
    expect(weekdaysBetween("2026-11-20", "2026-11-20")).toBe(0);
  });
});

describe("testing a structure against history", () => {
  it("places the same shape each day and holds it to the expiry close", () => {
    const c = madeUpCandles("1d", 400, 3);
    const p = position(c, [{ right: "C", side: "buy", strike: c.close[c.close.length - 1], qty: 1 }]);
    const r = testHistory(p, c, null);
    expect(r.sessions).toBe(5);
    expect(r.trades.length).toBeGreaterThan(300);
    for (const t of r.trades) expect(weekdaysBetween(t.date, t.expiry)).toBeGreaterThanOrEqual(5);
    // an at-the-money call: settles at what the price gained, less what it cost
    const t = r.trades[50];
    expect(t.pnl).toBeCloseTo(Math.max(0, t.spotOut - t.spot) * 100 - t.entry - SLIPPAGE * 100 - COMMISSION, 1);
  });

  it("loses the premium and costs when nothing moves (worked by hand)", () => {
    const c = flat(120);
    const vix: Candles = { ...c, close: c.close.map(() => 20) };
    const p = { ...position(c, [{ right: "C", side: "buy", strike: 100, qty: 1 }]), symbol: "SPY" };
    const r = testHistory(p, c, vix);
    expect(r.trades.length).toBeGreaterThan(50);
    const premium = blackScholes("C", 100, 100, 5 / 252, 0.2).price * 100;
    for (const t of r.trades) expect(t.pnl).toBeCloseTo(-premium - SLIPPAGE * 100 - COMMISSION, 1);
  });

  it("never looks past each trade's expiry close", () => {
    const c = madeUpCandles("1d", 300, 9);
    const p = position(c, [{ right: "P", side: "sell", strike: c.close[c.close.length - 1] * 0.97, qty: 1 }, { right: "P", side: "buy", strike: c.close[c.close.length - 1] * 0.95, qty: 1 }]);
    const shape = shapeOf(p, c);
    const before = testShape(shape, 5, "XYZ", c, null).trades;
    // change every candle after trade 100's expiry: its result mustn't move
    const k = before[100];
    const idx = c.time.findIndex((t) => nyParts(t).date === k.expiry);
    const later = (v: number, i: number) => (i > idx ? v * 1.3 : v);
    const changed: Candles = { ...c, open: c.open.map(later), high: c.high.map(later), low: c.low.map(later), close: c.close.map(later) };
    const after = testShape(shape, 5, "XYZ", changed, null).trades;
    expect(after[100]).toEqual(k);
  });

  it("keeps only days like today", () => {
    const c = madeUpCandles("1d", 400, 3);
    const vix = madeUpCandles("1d", 400, 4);
    const p = position(c, [{ right: "C", side: "buy", strike: c.close[c.close.length - 1], qty: 1 }]);
    const all = testHistory(p, c, null).trades.length;
    const like = testHistory(p, c, null, { vix: { candles: vix, within: 0.2 }, trends: [{ symbol: "QQQ", candles: madeUpCandles("1d", 400, 7) }] });
    expect(like.trades.length).toBeLessThan(all);
    expect(like.skipped.notLike).toBeGreaterThan(0);
    expect(like.today.vix).toBe(vix.close[vix.close.length - 1]);
    expect([1, -1]).toContain(like.today.trends.QQQ);
  });

  it("sums up: chance, average, middle, worst and best", () => {
    const s = summarise([10, -20, 30, 40].map((pnl, i) => ({ date: `d${i}`, expiry: "", spot: 0, spotOut: 0, vol: 0, entry: 0, pnl })))!;
    expect(s.chance).toBe(0.75);
    expect(s.average).toBe(15);
    expect(s.median).toBe(20);
    expect(s.worst.pnl).toBe(-20);
    expect(s.best.pnl).toBe(40);
    expect(summarise([])).toBeNull();
  });
});
