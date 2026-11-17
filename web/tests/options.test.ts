import { describe, expect, it } from "vitest";
import type { Candles } from "../src/data/candles";
import {
  defaultLegs, expiryChoices, moveLeg, newPosition, placementBasis, problems, sessions, widestWing,
} from "../src/data/options";
import { DEFAULT_FAVOURITES, sameIndicator } from "../src/data/model";

const day = (d: string, h = 14.5) => Date.parse(`${d}T00:00:00Z`) / 1000 + h * 3600;
function candles(rows: [number, number, number, number, number][]): Candles {
  return {
    time: rows.map((r) => r[0]), open: rows.map((r) => r[1]), high: rows.map((r) => r[2]), low: rows.map((r) => r[3]), close: rows.map((r) => r[4]),
    volume: rows.map(() => 1000), source: "made-up",
  } as unknown as Candles;
}

describe("placement", () => {
  it("groups intraday candles into New York sessions", () => {
    const c = candles([
      [day("2026-11-16", 14.5), 600, 602, 599, 601],
      [day("2026-11-16", 15), 601, 605, 600, 604],
      [day("2026-11-17", 14.5), 604, 606, 598, 600],
    ]);
    const s = sessions(c);
    expect(s.map((x) => x.date)).toEqual(["2026-11-16", "2026-11-17"]);
    expect(s[0]).toMatchObject({ high: 605, low: 599, close: 604, n: 2 });
  });

  it("uses the latest session's mean and Wilder's ATR of daily ranges", () => {
    // 20 days, each range 6 with no gaps: ATR is 6.
    const rows: [number, number, number, number, number][] = [];
    for (let i = 0; i < 20; i++) rows.push([day(`2026-10-${String(i + 1).padStart(2, "0")}`), 600, 603, 597, 600]);
    const b = placementBasis(candles(rows))!;
    expect(b.atr).toBeCloseTo(6, 9);
    expect(b.mean).toBeCloseTo(600, 9);
  });

  it("places an iron condor one daily range out, wings $5 beyond, on $1 strikes", () => {
    const legs = defaultLegs("iron_condor", 600.4, 6.3);
    expect(legs.map((l) => [l.right, l.side, l.strike])).toEqual([
      ["P", "buy", 589], ["P", "sell", 594], ["C", "sell", 606], ["C", "buy", 611],
    ]);
  });

  it("gives every structure defined legs", () => {
    for (const s of ["iron_condor", "iron_fly", "bull_put", "bear_call", "bull_call", "bear_put", "call", "put"] as const) {
      const p = newPosition("SPY", s, { mean: 600, atr: 6 }, "2026-11-20");
      expect(p.legs.length).toBeGreaterThan(0);
      expect(problems(p)).toEqual([]);
      expect(p.status).toBe("planned");
    }
  });

  it("uses 50c strikes under $25", () => {
    expect(defaultLegs("call", 12.3, 0.4)[0].strike).toBe(12.5);
  });
});

describe("moving", () => {
  const ic = newPosition("SPY", "iron_condor", { mean: 600, atr: 6 }, "2026-11-20"); // 589 594 606 611
  it("moves the whole structure", () => {
    expect(moveLeg(ic, 1, 597.2, "whole").legs.map((l) => l.strike)).toEqual([592, 597, 609, 614]);
  });
  it("moves one side: the put spread keeps its width", () => {
    expect(moveLeg(ic, 0, 585, "side").legs.map((l) => l.strike)).toEqual([585, 590, 606, 611]);
  });
  it("moves one leg: a wing in or out", () => {
    expect(moveLeg(ic, 3, 615, "leg").legs.map((l) => l.strike)).toEqual([589, 594, 606, 615]);
  });
  it("flags crossed legs", () => {
    expect(problems(moveLeg(ic, 1, 608, "leg"))).toContain("The short put is above the short call.");
    expect(problems(moveLeg(ic, 0, 596, "leg"))).toContain("The put wing should be below the short put.");
  });
  it("returns the same object when nothing moves", () => {
    expect(moveLeg(ic, 0, 589.2, "leg")).toBe(ic);
  });
});

describe("risk and expiries", () => {
  it("gives the widest wing for defined-risk structures, none for naked shorts", () => {
    const ic = newPosition("SPY", "iron_condor", { mean: 600, atr: 6 }, "2026-11-20");
    expect(widestWing(ic)).toBe(500);
    expect(widestWing(moveLeg(ic, 3, 616, "leg"))).toBe(1000);
    expect(widestWing({ ...ic, legs: ic.legs.filter((l) => l.side === "sell") })).toBeNull();
    expect(widestWing(newPosition("SPY", "call", { mean: 600, atr: 6 }, "2026-11-20"))).toBeNull();
  });
  it("lists weekdays only, starting today when today is one", () => {
    expect(expiryChoices("2026-11-20", 3)).toEqual(["2026-11-20", "2026-11-23", "2026-11-24"]); // Fri, Mon, Tue
    expect(expiryChoices("2026-11-21", 1)).toEqual(["2026-11-23"]); // Saturday → Monday
  });
});

describe("favourites", () => {
  it("matches an indicator with the same settings, defaults filled in", () => {
    expect(sameIndicator({ name: "ema", params: { length: 21 } }, { name: "ema", params: { length: 21 } })).toBe(true);
    expect(sameIndicator({ name: "ema", params: { length: 21 } }, { name: "ema", params: { length: 50 } })).toBe(false);
    expect(sameIndicator({ name: "squeeze", params: {} }, DEFAULT_FAVOURITES.find((f) => f.kind === "indicator" && f.name === "squeeze") as never)).toBe(true);
  });
});
