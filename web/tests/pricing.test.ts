import { describe, expect, it } from "vitest";
import { analyse, blackScholes, decayCurve, expiryTime, historicalVol, normCdf, pnlCurve, positionAt } from "../src/data/pricing";
import { newPosition } from "../src/data/options";
import type { Candles } from "../src/data/candles";

describe("Black-Scholes", () => {
  it("matches the textbook values (S=100, K=100, 1 year, 5%, 20%)", () => {
    expect(blackScholes("C", 100, 100, 1, 0.2, 0.05).price).toBeCloseTo(10.4506, 3);
    expect(blackScholes("P", 100, 100, 1, 0.2, 0.05).price).toBeCloseTo(5.5735, 3);
    expect(blackScholes("C", 100, 100, 1, 0.2, 0.05).delta).toBeCloseTo(0.6368, 3);
  });
  it("keeps put-call parity", () => {
    const c = blackScholes("C", 600, 590, 0.1, 0.18).price, p = blackScholes("P", 600, 590, 0.1, 0.18).price;
    expect(c - p).toBeCloseTo(600 - 590 * Math.exp(-0.04 * 0.1), 6);
  });
  it("is worth its intrinsic value at expiry", () => {
    expect(blackScholes("C", 105, 100, 0, 0.2).price).toBe(5);
    expect(blackScholes("P", 105, 100, 0, 0.2).price).toBe(0);
  });
  it("has a sound normal distribution", () => {
    expect(normCdf(0)).toBeCloseTo(0.5, 7);
    expect(normCdf(1.96)).toBeCloseTo(0.975, 3);
  });
});

describe("an iron condor", () => {
  const ic = newPosition("SPY", "iron_condor", { mean: 600, atr: 6 }, "2026-12-18"); // 589 594 606 611
  const now = expiryTime("2026-12-18") - 30 * 86400;
  const a = analyse(ic, 600, 0.15, now);
  it("is a credit, with risk capped at the wing less the credit", () => {
    expect(a.credit).toBe(true);
    expect(a.maxProfit!).toBeCloseTo(-a.entry, 6);
    expect(a.maxLoss!).toBeCloseTo(500 - a.maxProfit!, 6);
  });
  it("breaks even outside the short strikes", () => {
    expect(a.breakevens.length).toBe(2);
    expect(a.breakevens[0]).toBeLessThan(594);
    expect(a.breakevens[0]).toBeGreaterThan(589);
    expect(a.breakevens[1]).toBeGreaterThan(606);
    expect(a.pop).toBeGreaterThan(0.2);
    expect(a.pop).toBeLessThan(0.9);
  });
  it("starts at zero today and decays towards the credit at expiry if the price stays put", () => {
    const d = decayCurve(ic, 600, a.entry, 0.15, now);
    expect(d[0].pnl).toBeCloseTo(0, 6);
    expect(d[d.length - 1].pnl).toBeCloseTo(a.maxProfit!, 6);
    expect(d[30].pnl).toBeGreaterThan(0);
  });
  it("is short theta and roughly delta neutral", () => {
    expect(a.greeks.theta).toBeGreaterThan(0); // a credit position earns time decay
    expect(Math.abs(a.greeks.delta)).toBeLessThan(10);
  });
  it("draws today's line through zero at the current price", () => {
    expect(pnlCurve(ic, a.entry, [600], now, 0.15)[0]).toBeCloseTo(0, 6);
    expect(positionAt(ic, 600, now, 0.15).price).toBeCloseTo(a.entry, 9);
  });
});

describe("other structures", () => {
  it("a long call has unlimited profit and loses at most what it cost", () => {
    const c = newPosition("SPY", "call", { mean: 600, atr: 6 }, "2026-12-18");
    const a = analyse(c, 600, 0.2, expiryTime("2026-12-18") - 10 * 86400);
    expect(a.maxProfit).toBeNull();
    expect(a.maxLoss!).toBeCloseTo(a.entry, 6);
    expect(a.breakevens[0]).toBeGreaterThan(600);
  });
});

describe("historical volatility", () => {
  it("annualises daily moves", () => {
    const n = 30, day = 86400;
    const close = Array.from({ length: n }, (_, i) => 100 * Math.exp((i % 2 ? 1 : -1) * 0.01));
    const c = { time: close.map((_, i) => 1.7e9 + i * day), open: close, high: close, low: close, close, volume: close.map(() => 1), source: "made-up" } as Candles;
    expect(historicalVol(c)!).toBeCloseTo(0.02 * Math.sqrt(252) * Math.sqrt(20 / 19), 2);
  });
});
