import { describe, expect, it } from "vitest";
import { optionKitty, stockKitty } from "../src/data/kitty";

describe("the $5,000 kitty, 2% a trade", () => {
  it("sizes option trades by their worst case", () => {
    // $100 of risk allowed; each structure can lose $40, so 2 contracts.
    const k = optionKitty([{ pnl: 30, max_loss: 40 }]);
    expect(k.taken).toBe(1);
    expect(k.end).toBe(5060);
    expect(k.profit).toBe(60);
    expect(k.profitPct).toBeCloseTo(1.2, 6);
  });
  it("skips a trade whose one-contract worst case is over 2%", () => {
    const k = optionKitty([{ pnl: 50, max_loss: 450 }, { pnl: 50, max_loss: 450 }]);
    expect(k.taken).toBe(0);
    expect(k.skipped).toBe(2);
    expect(k.end).toBe(5000);
  });
  it("grows and shrinks with the balance, and tracks the lowest point and deepest drop", () => {
    // 2 contracts each time: -$100, -$100, then +$100.
    const k = optionKitty([{ pnl: -50, max_loss: 50 }, { pnl: -50, max_loss: 49 }, { pnl: 50, max_loss: 40 }]);
    expect(k.curve.map((c) => c.balance)).toEqual([5000, 4900, 4800, 4900]);
    expect(k.lowest).toBe(4800);
    expect(k.deepestDropPct).toBeCloseTo(-4, 6);
  });
  it("after a loss, 2% may no longer cover a trade, so it's skipped", () => {
    const k = optionKitty([{ pnl: -100, max_loss: 100 }, { pnl: 80, max_loss: 100 }]);
    expect(k.taken).toBe(1);
    expect(k.skipped).toBe(1);
    expect(k.end).toBe(4900);
  });
  it("sizes stock trades from the stop, or 10% without one", () => {
    // 2% of $5,000 at a 15% stop is a $666.67 position; +30% on it is +$200.
    expect(stockKitty([{ return_pct: 30 }], 15).end).toBeCloseTo(5200, 2);
    // No stop: 10% of $5,000 is $500; -20% on it is -$100.
    expect(stockKitty([{ return_pct: -20 }], null).end).toBe(4900);
    expect(stockKitty([{ return_pct: null }], 15).taken).toBe(0);
  });
});
