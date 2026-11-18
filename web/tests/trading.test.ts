import { describe, expect, it } from "vitest";
import type { BotStrategy, PaperOrder } from "../src/data/model";
import { autoSymbols, byTab, openCash, openValue, results, tabsOf } from "../src/data/trading";

const order = (o: Partial<PaperOrder>): PaperOrder => ({
  id: 1, created_at: "2026-11-10T15:00:00Z", symbol: "SPY", structure: "bull_put", expiry: "2026-12-18",
  legs: [{ right: "P", side: "sell", strike: 580, qty: 1 }, { right: "P", side: "buy", strike: 575, qty: 1 }],
  quantity: 1, limit_price: 1.2, price_kind: "credit", max_loss: 380, status: "filled", refusals: [], reason: null, pnl: null, ...o,
});

describe("orders as a broker lists them", () => {
  it("sorts each status into its tab, and a position being closed shows under Working and Filled", () => {
    expect(tabsOf(order({ status: "proposed" }))).toEqual(["working"]);
    expect(tabsOf(order({ status: "sent" }))).toEqual(["working"]);
    expect(tabsOf(order({ status: "filled" }))).toEqual(["filled"]);
    expect(tabsOf(order({ status: "filled", close_broker_id: "42", close_price: null }))).toEqual(["working", "filled"]);
    expect(tabsOf(order({ status: "closed", pnl: 40 }))).toEqual(["closed"]);
    for (const s of ["refused", "rejected", "cancelled", "failed"] as const) expect(tabsOf(order({ status: s }))).toEqual(["nottraded"]);
    const t = byTab([order({ id: 1, status: "proposed" }), order({ id: 2, status: "filled" }), order({ id: 3, status: "refused" })]);
    expect([t.working.length, t.filled.length, t.closed.length, t.nottraded.length]).toEqual([1, 1, 0, 1]);
  });
});

describe("results from closed trades", () => {
  it("adds them up in the order they closed, overall and by strategy", () => {
    const r = results([
      order({ id: 1, status: "closed", pnl: 40, updated_at: "2026-11-12T20:00:00Z", strategy_id: "a" }),
      order({ id: 2, status: "closed", pnl: -100, updated_at: "2026-11-11T20:00:00Z", strategy_id: "a" }),
      order({ id: 3, status: "closed", pnl: 30, updated_at: "2026-11-13T20:00:00Z" }),
      order({ id: 4, status: "filled" }),
    ], { a: "Weekly condor" });
    expect(r.trades).toBe(3);
    expect(r.total).toBe(-30);
    expect(r.curve.map((c) => c[1])).toEqual([-100, -60, -30]);
    expect(r.winRate).toBeCloseTo(66.67, 1);
    expect([r.best, r.worst, r.avgLoss]).toEqual([40, -100, -100]);
    expect(r.byStrategy[0]).toMatchObject({ label: "Weekly condor", trades: 2, total: -60 });
    expect(r.byStrategy[1]).toMatchObject({ label: "From the chart (by hand)", trades: 1, total: 30 });
  });
});

describe("where automated trading is", () => {
  it("marks the symbols of strategies switched on and of open or working positions", () => {
    const strat = (id: string, enabled: boolean, instrument: string) =>
      ({ id, label: id, enabled, config: { instrument, structure: "iron_condor", entry: "10:00", short_delta: 0.15, width: 5 } } as BotStrategy);
    const syms = autoSymbols([strat("a", true, "SPY"), strat("b", false, "IWM")],
      [order({ symbol: "QQQ", status: "filled" }), order({ symbol: "DIA", status: "closed", pnl: 1 })]);
    expect([...syms].sort()).toEqual(["QQQ", "SPY"]);
  });
});

describe("an open position's value now", () => {
  it("a credit spread far out of the money is worth almost all of its credit", () => {
    expect(openCash(order({ fill_price: 1.2 }))).toBeCloseTo(120);
    const { pnl, value } = openValue(order({ fill_price: 1.2, quantity: 2 }), 700, 0.15, Date.parse("2026-12-17T15:00:00Z"));
    expect(value).toBeLessThanOrEqual(0);
    expect(value).toBeGreaterThan(-1);
    expect(pnl).toBeGreaterThan(239);
    expect(pnl).toBeLessThanOrEqual(240);
  });
});
