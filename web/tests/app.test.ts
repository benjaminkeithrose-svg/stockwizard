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
